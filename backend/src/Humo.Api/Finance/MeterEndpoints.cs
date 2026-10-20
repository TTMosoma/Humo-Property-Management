using System.Globalization;
using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Finance;

public sealed record WaterSettingDto(string SchemeId, decimal RatePerKl, int Version, string? UpdatedBy, string? UpdatedAt);
public sealed record PreviousReadingDto(string Period, decimal Reading);
public sealed record MeterSheetRowDto(string UnitId, string UnitNumber, string AccountNo, PreviousReadingDto? Previous, decimal? Reading, decimal? Consumption, decimal? Usual, bool Unusual);
public sealed record MeterSheetDto(string SchemeId, string SchemeName, string Period, WaterSettingDto Setting, IReadOnlyList<MeterSheetRowDto> Rows, int Captured, string? RunStage);
public sealed record MeterEntryDto(string UnitNumber, decimal Reading);
public sealed record SaveReadingsRequest(string ReadOn, List<MeterEntryDto> Entries);
public sealed record WaterRateRequest(decimal RatePerKl, string Reason, int? ExpectedVersion);
public sealed record LevySettingDto(string SchemeId, string Method, int Version, string? UpdatedBy, string? UpdatedAt);
public sealed record LevyMethodRequest(string Method, string Reason, int? ExpectedVersion);

/// <summary>
/// Water meter readings and each scheme's rate (docs/22 §2), and how levies are set (D13, docs/22 §3).
/// Billing.Run, the billing entitlement, within the person's schemes. Readings change only while that
/// month's run is still being prepared; afterwards water is corrected with a journal.
/// </summary>
public static class MeterEndpoints
{
    /// <summary>Rand per kilolitre shown until a scheme sets its own (setting a rate is what switches water recovery on).</summary>
    public const decimal DefaultRatePerKl = 42.5m;

    public static void MapMetersAndLevies(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/schemes/{schemeId:guid}").RequireAuthorization();
        g.MapGet("/meter-readings/{period}", Sheet);
        g.MapPut("/meter-readings/{period}", Save);
        g.MapPut("/water-rate", SetRate);
        g.MapGet("/levy-setting", GetLevySetting);
        g.MapPut("/levy-setting", SetLevyMethod);
        g.MapGet("/levy-roll/proposal", Proposal);
        g.MapPost("/levy-roll/apply", Apply);
    }

    private static async Task<IResult> Sheet(Guid schemeId, string period, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Billing.View") || await SchemeEndpoints.Visible(actor, db).FirstOrDefaultAsync(s => s.Id == schemeId, ct) is not { } scheme) return Problems.NotFound();
        var setting = await db.WaterSettings.FirstOrDefaultAsync(w => w.SchemeId == schemeId, ct);
        var units = (await db.Units.Where(u => u.SchemeId == schemeId).ToListAsync(ct)).OrderBy(u => int.TryParse(u.Number, out var n) ? n : int.MaxValue).ThenBy(u => u.Number).ToList();
        var accounts = await db.LevyAccounts.Where(a => a.SchemeId == schemeId).ToDictionaryAsync(a => a.UnitId, a => a.AccountNo, ct);
        var readings = (await db.MeterReadings.Where(m => m.SchemeId == schemeId && string.Compare(m.Period, period) <= 0).ToListAsync(ct)).ToLookup(m => m.UnitId);
        var rows = units.Where(u => accounts.ContainsKey(u.Id)).Select(u =>
        {
            var list = readings[u.Id].ToList();
            var (now, previous, usual) = LevyBilling.Meters(list, period);
            var before = list.Where(r => string.CompareOrdinal(r.Period, period) < 0).OrderByDescending(r => r.Period).FirstOrDefault();
            decimal? used = now is { } a && previous is { } b ? Ledger.Round2(a - b) : null;
            return new MeterSheetRowDto(u.Id.ToString(), u.Number, accounts[u.Id], before is null ? null : new PreviousReadingDto(before.Period, before.Reading), now, used, usual,
                used is { } x && usual is > 0 && x > BillingRules.UnusualFactor * usual);
        }).ToList();
        var stage = (await db.BillingRuns.Where(r => r.SchemeId == schemeId && r.Period == period && r.Stage != "cancelled").Select(r => r.Stage).ToListAsync(ct)).FirstOrDefault();
        return Results.Ok(new MeterSheetDto(schemeId.ToString(), scheme.Name, period, ToDto(setting, schemeId), rows, rows.Count(r => r.Reading is not null), stage));
    }

    /// <summary>Saves readings (grid or CSV). Lower than last month is refused (meter replacement isn't supported yet). Re-prices a run that's still being prepared.</summary>
    private static async Task<IResult> Save(Guid schemeId, string period, SaveReadingsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, LevyBilling billing,
        TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(s => s.Id == schemeId, ct) is not { } scheme) return Problems.NotFound();
        var water = await db.WaterSettings.FirstOrDefaultAsync(w => w.SchemeId == schemeId, ct);
        var units = (await db.Units.Where(u => u.SchemeId == schemeId).ToListAsync(ct)).ToDictionary(u => u.Number.ToLowerInvariant());
        var previous = (await db.MeterReadings.Where(m => m.SchemeId == schemeId && string.Compare(m.Period, period) < 0).ToListAsync(ct))
            .GroupBy(m => m.UnitId).ToDictionary(g => g.Key, g => g.OrderByDescending(m => m.Period).First().Reading);
        var runRow = await db.BillingRuns.FirstOrDefaultAsync(r => r.SchemeId == schemeId && r.Period == period && r.Stage != "cancelled", ct);
        var entries = body.Entries ?? [];
        var today = DateOnly.FromDateTime(clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).DateTime);

        return await commands.RunAsync(new CommandSpec($"Captured {entries.Count} water meter reading{(entries.Count == 1 ? "" : "s")} for {scheme.Name}, {period}", "Billing.Run")
        {
            Resource = "Meter readings",
            ResourceId = $"{schemeId}|{period}",
            SchemeId = schemeId,
            Feature = "billing",
            Validate = () =>
            {
                if (water is null) return new() { ["schemeId"] = "This scheme doesn’t recover water from owners. Set its water rate first." };
                if (period.Length != 7 || !DateOnly.TryParseExact($"{period}-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) return new() { ["period"] = "Choose the month." };
                if (!DateOnly.TryParseExact(body.ReadOn ?? "", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var readOn) || readOn > today) return new() { ["readOn"] = "When were the meters read? Not in the future." };
                if (runRow is { Stage: not "preview" } r)
                    return new() { ["period"] = $"The {period} billing run is {(r.Stage == "awaiting-approval" ? "with the approvers" : "already approved or posted")}. Correct water with a journal, or send the run back to Preparing first." };
                if (entries.Count == 0) return new() { ["entries"] = "Enter at least one reading." };
                var e = new Dictionary<string, string>();
                var seen = new HashSet<Guid>();
                foreach (var x in entries)
                {
                    var key = $"unit-{x.UnitNumber}";
                    if (!units.TryGetValue((x.UnitNumber ?? "").ToLowerInvariant(), out var unit)) e[key] = $"There’s no unit {x.UnitNumber} in {scheme.Name}.";
                    else if (!seen.Add(unit.Id)) e[key] = $"Unit {x.UnitNumber} appears twice.";
                    else if (x.Reading < 0) e[key] = $"Unit {x.UnitNumber}: a reading can’t be negative.";
                    else if (previous.TryGetValue(unit.Id, out var before) && x.Reading < before) e[key] = $"Unit {x.UnitNumber}: {x.Reading} is lower than the last reading ({before}). Meter replacements aren’t supported yet.";
                }
                return e;
            },
        }, async actor =>
        {
            var readOn = DateOnly.ParseExact(body.ReadOn, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            var ids = entries.Select(x => units[x.UnitNumber.ToLowerInvariant()].Id).ToList();
            db.MeterReadings.RemoveRange(await db.MeterReadings.Where(m => ids.Contains(m.UnitId) && m.Period == period).ToListAsync(ct));
            foreach (var x in entries)
                db.MeterReadings.Add(new MeterReading
                {
                    Id = Guid.CreateVersion7(), UnitId = units[x.UnitNumber.ToLowerInvariant()].Id, SchemeId = schemeId, Period = period, Reading = Ledger.Round2(x.Reading), ReadOn = readOn,
                    CapturedBy = actor.Human.Name, CapturedAt = clock.GetUtcNow(),
                });
            await db.SaveChangesAsync(ct);
            // A run still being prepared is re-priced from the readings: water lines and their meter exceptions (other decisions stay).
            if (runRow is { Stage: "preview" })
            {
                var run = LevyBilling.Read(runRow);
                var fresh = await billing.PrepareAsync(scheme, period, actor, ct);
                foreach (var line in run.Lines)
                {
                    var redo = fresh.Lines.First(l => l.AccountId == line.AccountId);
                    line.Charges = [.. line.Charges.Where(c => c.Kind != "utility"), .. redo.Charges.Where(c => c.Kind == "utility")];
                    run.Exceptions.RemoveAll(e => e.AccountId == line.AccountId && e.Kind is "meter-missing" or "unusual-reading");
                    run.Exceptions.AddRange(fresh.Exceptions.Where(e => e.AccountId == line.AccountId && e.Kind is "meter-missing" or "unusual-reading"));
                    var decisions = run.Exceptions.Where(e => e.AccountId == line.AccountId && e.Decision is not null).Select(e => e.Decision).ToList();
                    line.Excluded = decisions.Contains("exclude");
                    line.Total = Ledger.Round2(line.Charges.Sum(c => c.Amount));
                }
                BillingRules.Log(run, "exception", "Meter readings updated: water recalculated", actor.Human.Name, billing.Now);
                run.Version++;
                LevyBilling.Write(runRow, run);
            }
            return Results.Ok(entries.Count);
        }, ct);
    }

    /// <summary>The scheme's flat rate per kilolitre. Setting it switches water recovery on for the scheme.</summary>
    private static async Task<IResult> SetRate(Guid schemeId, WaterRateRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(s => s.Id == schemeId, ct) is not { } scheme) return Problems.NotFound();
        var setting = await db.WaterSettings.FirstOrDefaultAsync(w => w.SchemeId == schemeId, ct);
        return await commands.RunAsync(new CommandSpec($"Set the water rate for {scheme.Name} to {BillingRules.Rand(body.RatePerKl)}/kl — {body.Reason?.Trim()}", "Billing.Run")
        {
            Resource = "Water rate",
            ResourceId = schemeId.ToString(),
            SchemeId = schemeId,
            Feature = "billing",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = setting?.Version ?? 0,
            Validate = () => !(body.RatePerKl > 0 && body.RatePerKl < 1000) ? new() { ["ratePerKl"] = "Enter the rate per kilolitre, in rand." }
                : (body.Reason ?? "").Trim().Length < 5 ? new() { ["reason"] = "Say why, in a few words. It goes in the audit log." } : [],
        }, actor =>
        {
            if (setting is null) db.WaterSettings.Add(setting = new WaterSetting { SchemeId = schemeId, Version = 0 });
            setting.RatePerKl = Ledger.Round2(body.RatePerKl);
            setting.Version++;
            setting.UpdatedBy = actor.Human.Name;
            setting.UpdatedAt = clock.GetUtcNow();
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> GetLevySetting(Guid schemeId, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Billing.View") || !await SchemeEndpoints.Visible(actor, db).AnyAsync(s => s.Id == schemeId, ct)) return Problems.NotFound();
        var s = await db.LevySettings.FirstOrDefaultAsync(x => x.SchemeId == schemeId, ct);
        return Results.Ok(new LevySettingDto(schemeId.ToString(), s?.Method ?? "manual", s?.Version ?? 0, s?.UpdatedBy, s?.UpdatedAt?.ToString("O")));
    }

    /// <summary>Entered per unit (default) or derived from the approved budget (D13). Switching back keeps the current amounts.</summary>
    private static async Task<IResult> SetLevyMethod(Guid schemeId, LevyMethodRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(s => s.Id == schemeId, ct) is not { } scheme) return Problems.NotFound();
        var setting = await db.LevySettings.FirstOrDefaultAsync(x => x.SchemeId == schemeId, ct);
        var label = body.Method == "budget" ? "derived from the approved budget" : "entered per unit";
        return await commands.RunAsync(new CommandSpec($"Set how {scheme.Name}’s levies are set: {label} — {body.Reason?.Trim()}", "Billing.Run")
        {
            Resource = "Levy setting",
            ResourceId = schemeId.ToString(),
            SchemeId = schemeId,
            Feature = "billing",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = setting?.Version ?? 0,
            Validate = () => body.Method is not ("manual" or "budget") ? new() { ["method"] = "Entered per unit, or derived from the approved budget." }
                : body.Method == (setting?.Method ?? "manual") ? new() { ["method"] = "That’s already how this scheme’s levies are set." }
                : (body.Reason ?? "").Trim().Length < 5 ? new() { ["reason"] = "Say why, in a few words. It goes in the audit log." } : [],
        }, actor =>
        {
            if (setting is null) db.LevySettings.Add(setting = new LevySetting { SchemeId = schemeId, Version = 0 });
            setting.Method = body.Method;
            setting.Version++;
            setting.UpdatedBy = actor.Human.Name;
            setting.UpdatedAt = clock.GetUtcNow();
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>Budgets aren't on the API yet: there's no approved budget to derive a roll from.</summary>
    private static async Task<IResult> Proposal(Guid schemeId, CurrentActor current, CancellationToken ct) =>
        await current.GetAsync(ct) is null ? Results.Unauthorized() : Problems.NotFound();

    private static async Task<IResult> Apply(Guid schemeId, CurrentActor current, CancellationToken ct) =>
        await current.GetAsync(ct) is null ? Results.Unauthorized()
            : Problems.Validation(new() { ["budgetId"] = "There’s no approved budget to derive levies from yet: budgets arrive on Humo’s API in a later slice." });

    private static WaterSettingDto ToDto(WaterSetting? w, Guid schemeId) =>
        new(schemeId.ToString(), w?.RatePerKl ?? DefaultRatePerKl, w?.Version ?? 0, w?.UpdatedBy, w?.UpdatedAt?.ToString("O"));
}
