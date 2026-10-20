using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Api.Work;
using Humo.Domain.Commercial;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Finance;

public sealed record BillingRunSummaryDto(BillingRun Run, SchemeDto Scheme, decimal Total, int Accounts, int OpenExceptions);
public sealed record LastPostedDto(string Period, decimal Total, string At);
public sealed record SchemeBillingStatusDto(SchemeDto Scheme, decimal LevyRoll, LastPostedDto? LastPosted, BillingRunSummaryDto? Current, string NextPeriod, bool RecoversWater);
public sealed record NewBillingRunRequest(string SchemeId, string Period);
public sealed record BillingActionRequest(BillingAction Action, int? ExpectedVersion);

/// <summary>
/// Levy billing runs on the API (slice 2b; docs/11 §1): one month's charges for one scheme, calculated by the API
/// (the client never sends amounts), exceptions decided by a person, approved in Approvals by someone other than
/// the preparer, then posted to the ledger and locked. Corrections after that are journal adjustments.
/// </summary>
public sealed class LevyBilling(HumoDbContext db, AccountLedger ledger, TimeProvider clock) : IApprovalHandler
{
    public string Type => "billing-run-approval";

    public string Now => clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).ToString("O");

    public static BillingRun Read(BillingRunRow row)
    {
        var run = JsonSerializer.Deserialize<BillingRun>(row.Document, Json.Options)!;
        run.Version = row.Version;
        run.Stage = row.Stage;
        return run;
    }

    public static void Write(BillingRunRow row, BillingRun run)
    {
        row.Stage = run.Stage;
        row.Version = run.Version;
        row.Document = JsonSerializer.Serialize(run, Json.Options);
    }

    /// <summary>The next period a scheme bills: after its last posted run, or next month for its first.</summary>
    public async Task<string> NextPeriodAsync(Guid schemeId, CancellationToken ct)
    {
        var last = (await db.BillingRuns.Where(r => r.SchemeId == schemeId && (r.Stage == "posted" || r.Stage == "sent")).Select(r => r.Period).ToListAsync(ct)).Max();
        return BillingRules.NextPeriod(last ?? CommercialRules.Day(clock.GetUtcNow())[..7]);
    }

    /// <summary>The API's calculation: each account's charges for the period, and what a person must decide.</summary>
    public async Task<BillingRun> PrepareAsync(Scheme scheme, string period, Actor by, CancellationToken ct)
    {
        var org = await db.Organisations.FirstAsync(o => o.Id == scheme.OrganisationId, ct);
        var units = (await db.Units.Where(u => u.SchemeId == scheme.Id).ToListAsync(ct)).OrderBy(u => int.TryParse(u.Number, out var n) ? n : int.MaxValue).ThenBy(u => u.Number).ToList();
        var accounts = await db.LevyAccounts.Where(a => a.SchemeId == scheme.Id).ToDictionaryAsync(a => a.UnitId, ct);
        var accountIds = accounts.Values.Select(a => a.Id).ToList();
        var lastLevies = (await db.Ledger.Where(e => accountIds.Contains(e.AccountId) && e.Type == TransactionTypes.Levy).Select(e => new { e.AccountId, e.Date, e.CreatedAt, e.Amount }).ToListAsync(ct))
            .GroupBy(e => e.AccountId).ToDictionary(g => g.Key, g => g.OrderBy(e => e.Date).ThenBy(e => e.CreatedAt).Last().Amount);
        var holders = await db.People.Where(p => accounts.Values.Select(a => a.HolderPersonId).Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.DisplayName, ct);
        var water = await db.WaterSettings.FirstOrDefaultAsync(w => w.SchemeId == scheme.Id, ct);
        var readings = water is null ? [] : await db.MeterReadings.Where(m => m.SchemeId == scheme.Id && string.Compare(m.Period, period) <= 0).ToListAsync(ct);

        var inputs = units.Where(u => accounts.ContainsKey(u.Id)).Select(u =>
        {
            var a = accounts[u.Id];
            Water? w = null;
            if (water is not null)
            {
                var (now, previous, usual) = Meters(readings.Where(r => r.UnitId == u.Id).ToList(), period);
                w = BillingRules.WaterCharge(u.Number, period, water.RatePerKl, now, previous, usual);
            }
            return new AccountForBilling(a.Id.ToString(), a.AccountNo, u.Number, a.HolderPersonId is { } h && holders.TryGetValue(h, out var name) ? name : null, u.MonthlyLevy,
                lastLevies.TryGetValue(a.Id, out var last) ? last : null, a.Balance, new Ageing(a.AgeingCurrent, a.AgeingD30, a.AgeingD60, a.AgeingD90, a.AgeingD120), a.Status, w);
        }).ToList();
        var (lines, exceptions) = BillingRules.Prepare(inputs, period, org.InterestPercentPerMonth);
        var previousTotal = (await db.BillingRuns.Where(r => r.SchemeId == scheme.Id && (r.Stage == "posted" || r.Stage == "sent")).ToListAsync(ct))
            .OrderByDescending(r => r.Period).Select(r => Read(r).Posted?.Total).FirstOrDefault();
        var run = new BillingRun
        {
            Id = Guid.CreateVersion7().ToString(), Ref = $"BR-{scheme.Code}-{period[2..4]}{period[5..7]}", SchemeId = scheme.Id.ToString(), Period = period, Stage = "preview",
            CreatedAt = Now, CreatedBy = by.Human.Name, CreatedById = by.Human.Id.ToString(), Lines = lines, Exceptions = exceptions, PreviousTotal = previousTotal,
        };
        BillingRules.Log(run, "stage", $"Prepared: {lines.Count} accounts, {BillingRules.Rand(BillingRules.Total(run))}, {exceptions.Count} exception{(exceptions.Count == 1 ? "" : "s")} to decide", by.Human.Name, Now);
        return run;
    }

    /// <summary>This month's reading, the latest before it, and the usual monthly consumption over the three months before (needs two readings).</summary>
    public static (decimal? Now, decimal? Previous, decimal? Usual) Meters(List<MeterReading> unitReadings, string period)
    {
        var now = unitReadings.FirstOrDefault(r => r.Period == period)?.Reading;
        var history = unitReadings.Where(r => string.CompareOrdinal(r.Period, period) < 0).OrderByDescending(r => r.Period).Take(4).ToList();
        decimal? usual = history.Count < 2 ? null : Ledger.Round2(Enumerable.Range(0, history.Count - 1).Average(i => history[i].Reading - history[i + 1].Reading));
        return (now, history.FirstOrDefault()?.Reading, usual);
    }

    /// <summary>To the approvers in Approvals: agency administrators and finance, never the person who prepared it.</summary>
    public async Task SendForApprovalAsync(BillingRun run, Scheme scheme, Actor by, CancellationToken ct)
    {
        var total = BillingRules.Total(run);
        var included = run.Lines.Count(l => !l.Excluded);
        var item = new WorkItemRow
        {
            Id = Guid.CreateVersion7(), OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, Ref = run.Ref, Kind = "approval", Type = Type,
            Title = $"{BillingRules.MonthName(run.Period)} billing — {scheme.Name}", Detail = $"{included} accounts · {run.Exceptions.Count} exception{(run.Exceptions.Count == 1 ? "" : "s")} decided",
            Amount = total, CreatedAt = clock.GetUtcNow(), DueAt = clock.GetUtcNow().AddDays(3), ApproverRoles = WorkItemEndpoints.Roles(Domain.Access.Roles.AgencyAdmin, Domain.Access.Roles.Finance),
            Evidence = JsonSerializer.Serialize(new[] { "Charges preview", $"Exceptions report ({run.Exceptions.Count} decided)", run.PreviousTotal is { } p ? $"Last month {BillingRules.Rand(p)}" : "First run in Humo Property Management" }),
            Route = $"/finance/billing/{run.Id}", SourceId = Guid.Parse(run.Id),
        };
        db.WorkItems.Add(item);
        run.ApprovalWorkItemId = item.Id.ToString();
        run.Stage = "awaiting-approval";
        BillingRules.Log(run, "approval", $"Sent for approval: {BillingRules.Rand(total)} across {included} accounts", by.Human.Name, Now);
        await Task.CompletedTask;
    }

    /// <summary>Writes the charges to the ledger, dated the 1st of the period. From here the run is locked.</summary>
    public async Task PostAsync(BillingRun run, Actor by, CancellationToken ct)
    {
        var date = DateOnly.ParseExact($"{run.Period}-01", "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var included = run.Lines.Where(l => !l.Excluded).ToList();
        foreach (var l in included)
        {
            var account = await db.LevyAccounts.FirstAsync(a => a.Id == Guid.Parse(l.AccountId), ct);
            foreach (var c in l.Charges) await ledger.PostAsync(account, date, c.Kind, c.Description, c.Amount, by.Human.Name, run.Ref, ct: ct);
        }
        var total = BillingRules.Total(run);
        run.Posted = new RunPosted(Now, by.Human.Name, included.Count, total);
        run.Stage = "posted";
        BillingRules.Log(run, "posting", $"Posted {BillingRules.Rand(total)} to {included.Count} accounts. The run is now locked.", by.Human.Name, Now);
    }

    // ---- Approvals decided in My work ----

    public async Task<string?> RefuseAsync(WorkItemRow item, Actor actor, bool approve, CancellationToken ct)
    {
        if (!approve || await db.BillingRuns.FirstOrDefaultAsync(r => r.Id == item.SourceId, ct) is not { } row) return null;
        // Segregation of duties (docs/11 §8): whoever prepared the run doesn't approve it.
        return Read(row).CreatedById == actor.Human.Id.ToString() ? "You prepared this billing run: someone else approves it." : null;
    }

    public async Task DecidedAsync(WorkItemRow item, Actor actor, bool approve, string? comment, CancellationToken ct)
    {
        if (await db.BillingRuns.FirstOrDefaultAsync(r => r.Id == item.SourceId, ct) is not { } row) return;
        var run = Read(row);
        if (run.Stage != "awaiting-approval") return;
        if (approve)
        {
            run.Stage = "approved";
            run.Approval = new RunApproval(Now, actor.Human.Name, comment);
            BillingRules.Log(run, "approval", $"Approved by {actor.Human.Name}", actor.Human.Name, Now);
        }
        else
        {
            run.Stage = "preview";
            run.ApprovalWorkItemId = null;
            BillingRules.Log(run, "approval", $"Sent back by {actor.Human.Name}{(comment is null ? "" : $": “{comment}”")}", actor.Human.Name, Now);
        }
        run.Version++;
        Write(row, run);
    }
}

public static class BillingRunEndpoints
{
    private const string Feature = "billing";

    public static void MapBillingRuns(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/billing").RequireAuthorization();
        g.MapGet("/status", Status);
        g.MapGet("/runs", List);
        g.MapGet("/runs/{id:guid}", Get);
        g.MapPost("/runs", Create);
        g.MapPost("/runs/{id:guid}/actions", Act);
    }

    private static async Task<IResult> Status(string[]? schemeIds, CurrentActor current, HumoDbContext db, PortfolioReads reads, LevyBilling billing, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Billing.View")) return Results.Ok(Array.Empty<SchemeBillingStatusDto>());
        var schemes = await reads.ReadableSchemes(actor, schemeIds, ct);
        var ids = schemes.Select(s => s.Id).ToList();
        var dtos = (await SchemeEndpoints.ToDtos(schemes, db, ct)).ToDictionary(s => s.Id);
        var runs = (await db.BillingRuns.Where(r => ids.Contains(r.SchemeId)).ToListAsync(ct)).ToLookup(r => r.SchemeId);
        var rolls = (await db.Units.Where(u => ids.Contains(u.SchemeId)).Select(u => new { u.SchemeId, u.MonthlyLevy }).ToListAsync(ct)).GroupBy(u => u.SchemeId).ToDictionary(g => g.Key, g => g.Sum(u => u.MonthlyLevy));
        var water = await db.WaterSettings.Where(w => ids.Contains(w.SchemeId)).Select(w => w.SchemeId).ToListAsync(ct);
        var result = new List<SchemeBillingStatusDto>();
        foreach (var s in schemes)
        {
            var list = runs[s.Id].Select(LevyBilling.Read).ToList();
            var done = list.Where(r => r.Stage is "posted" or "sent").OrderByDescending(r => r.Period).FirstOrDefault();
            var open = list.FirstOrDefault(r => BillingRules.Open.Contains(r.Stage));
            result.Add(new SchemeBillingStatusDto(dtos[s.Id.ToString()], Ledger.Round2(rolls.GetValueOrDefault(s.Id)), done?.Posted is { } p ? new LastPostedDto(done.Period, p.Total, p.At) : null,
                open is null ? null : Summary(open, dtos[s.Id.ToString()]), await billing.NextPeriodAsync(s.Id, ct), water.Contains(s.Id)));
        }
        return Results.Ok(result);
    }

    private static async Task<IResult> List(string[]? schemeIds, int? page, int? pageSize, CurrentActor current, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Billing.View")) return Results.Ok(PortfolioReads.Page(new List<BillingRunSummaryDto>(), page, pageSize));
        var schemes = await reads.ReadableSchemes(actor, schemeIds, ct);
        var ids = schemes.Select(s => s.Id).ToList();
        var dtos = (await SchemeEndpoints.ToDtos(schemes, db, ct)).ToDictionary(s => s.Id);
        var runs = (await db.BillingRuns.Where(r => ids.Contains(r.SchemeId)).ToListAsync(ct)).Select(LevyBilling.Read).OrderByDescending(r => r.Period).ThenByDescending(r => r.CreatedAt).ToList();
        return Results.Ok(PortfolioReads.Page(runs.Select(r => Summary(r, dtos[r.SchemeId])).ToList(), page, pageSize));
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await Visible(actor, db, id, ct) is not { } x) return Problems.NotFound();
        var dto = (await SchemeEndpoints.ToDtos([x.Scheme], db, ct))[0];
        return Results.Ok(Summary(LevyBilling.Read(x.Row), dto));
    }

    /// <summary>Prepares the scheme's next period. One run at a time per scheme; periods in order, once.</summary>
    private static async Task<IResult> Create(NewBillingRunRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, LevyBilling billing, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var schemeId = Guid.TryParse(body.SchemeId, out var g) ? g : Guid.Empty;
        var scheme = await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(s => s.Id == schemeId, ct);
        var open = scheme is null ? null : (await db.BillingRuns.Where(r => r.SchemeId == schemeId).ToListAsync(ct)).Select(LevyBilling.Read).FirstOrDefault(r => BillingRules.Open.Contains(r.Stage));
        var next = scheme is null ? "" : await billing.NextPeriodAsync(scheme.Id, ct);

        return await commands.RunAsync(new CommandSpec($"Prepared the {body.Period} billing run for {scheme?.Name ?? body.SchemeId}", "Billing.Run")
        {
            Resource = "Billing run",
            SchemeId = scheme?.Id,
            Feature = Feature,
            Validate = () =>
                scheme is null ? new() { ["schemeId"] = "Choose a scheme." }
                : open is not null ? new() { ["schemeId"] = $"{scheme.Name} already has a {BillingRules.MonthName(open.Period)} run in progress ({open.Ref}). Finish or cancel it first." }
                : body.Period != next ? new() { ["period"] = $"The next period to bill for {scheme.Name} is {BillingRules.MonthName(next)} {next[..4]}: periods are billed in order, once." }
                : [],
        }, async actor =>
        {
            var run = await billing.PrepareAsync(scheme!, body.Period, actor, ct);
            var row = new BillingRunRow { Id = Guid.Parse(run.Id), Ref = run.Ref, SchemeId = scheme!.Id, Period = run.Period };
            LevyBilling.Write(row, run);
            db.BillingRuns.Add(row);
            return Results.Created($"/api/billing/runs/{run.Id}", new { id = run.Id });
        }, ct);
    }

    private static async Task<IResult> Act(Guid id, BillingActionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, LevyBilling billing, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await Visible(me, db, id, ct) is not { } x) return Problems.NotFound();
        var run = LevyBilling.Read(x.Row);
        var a = body.Action ?? new BillingAction("");
        var what = a.Type switch
        {
            "decide" => $"Decided an exception on {run.Ref}",
            "send-for-approval" => $"Sent {run.Ref} for approval ({BillingRules.Rand(BillingRules.Total(run))})",
            "post" => $"Posted {run.Ref} ({BillingRules.Rand(BillingRules.Total(run))})",
            "cancel" => $"Cancelled {run.Ref} — {a.Reason?.Trim()}",
            "comment" => $"Commented on {run.Ref}",
            _ => $"{a.Type} on {run.Ref}",
        };

        return await commands.RunAsync(new CommandSpec(what, a.Type == "comment" ? "Billing.View" : "Billing.Run")
        {
            Resource = "Billing run",
            ResourceId = id.ToString(),
            SchemeId = x.Scheme.Id,
            Feature = Feature,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = run.Version,
            Validate = () => BillingRules.Check(run, a),
        }, async actor =>
        {
            var by = actor.Human.Name;
            switch (a.Type)
            {
                case "decide":
                    BillingRules.Decide(run, run.Exceptions.First(e => e.Id == a.ExceptionId), a.Decision!, by, a.Note, billing.Now);
                    break;
                case "send-for-approval":
                    await billing.SendForApprovalAsync(run, x.Scheme, actor, ct);
                    break;
                case "post":
                    await billing.PostAsync(run, actor, ct);
                    break;
                case "cancel":
                    if (run.ApprovalWorkItemId is { } w && await db.WorkItems.FirstOrDefaultAsync(i => i.Id == Guid.Parse(w), ct) is { Status: "open" } item)
                    {
                        item.Status = "done";
                        item.DecidedBy = by;
                        item.DecidedAt = DateTimeOffset.UtcNow;
                    }
                    run.Stage = "cancelled";
                    run.Cancelled = new RunCancelled(billing.Now, by, a.Reason!.Trim());
                    BillingRules.Log(run, "stage", $"Cancelled: {a.Reason.Trim()}", by, billing.Now);
                    break;
                case "comment":
                    BillingRules.Log(run, "comment", a.Text!.Trim(), by, billing.Now);
                    break;
            }
            run.Version++;
            LevyBilling.Write(x.Row, run);
            return Results.NoContent();
        }, ct);
    }

    private static async Task<(BillingRunRow Row, Scheme Scheme)?> Visible(Actor actor, HumoDbContext db, Guid id, CancellationToken ct)
    {
        if (!actor.Can("Billing.View")) return null;
        var row = await db.BillingRuns.FirstOrDefaultAsync(r => r.Id == id, ct);
        var scheme = row is null ? null : await SchemeEndpoints.Visible(actor, db).FirstOrDefaultAsync(s => s.Id == row.SchemeId, ct);
        return row is null || scheme is null ? null : (row, scheme);
    }

    internal static BillingRunSummaryDto Summary(BillingRun run, SchemeDto scheme) =>
        new(run, scheme, run.Posted?.Total ?? BillingRules.Total(run), run.Posted?.Accounts ?? run.Lines.Count(l => !l.Excluded), BillingRules.OpenExceptions(run).Count);
}
