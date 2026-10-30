using System.Globalization;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Maintenance;
using Humo.Api.Portfolio;
using Humo.Domain.Commercial;
using Humo.Domain.Finance;
using Humo.Domain.Maintenance;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Finance;

// The shapes match the app's budget model (domain/models/budget.ts).
public sealed record BudgetLine(string Category, string Kind, decimal Annual);
public sealed record BudgetApproval(string At, string ResolutionRef, string? MeetingId = null, string? RecordedBy = null);
public sealed record BroughtForward(string To, Dictionary<string, decimal> Amounts);
public sealed record BudgetDto(string Id, int Version, string SchemeId, string Year, string From, string To, string Status, List<BudgetLine> Lines, string CreatedBy, string UpdatedAt,
    BudgetApproval? Approved, BroughtForward? BroughtForward, BudgetAgm? Agm = null);
/// <summary>While proposed: the AGM and its agenda item; the resolution passed on that item approves the budget.</summary>
public sealed record BudgetAgm(string MeetingId, string MeetingRef, string AgendaItemId);
public sealed record BudgetLineViewDto(BudgetLine Line, decimal ToDate, decimal? Actual, decimal Committed, decimal? Variance);
public sealed record BudgetTotalsDto(decimal Income, decimal Expense, decimal Surplus, decimal IncomeActual, decimal ExpenseActual);
public sealed record BudgetViewDto(BudgetDto Budget, SchemeDto Scheme, double Elapsed, List<BudgetLineViewDto> Lines, BudgetTotalsDto Totals, List<string> Overspent);
/// <summary>For approval cards: this year's approved line for a job's category, with what's been spent and committed.</summary>
public sealed record BudgetLineSpendDto(string Category, decimal Annual, decimal Spent);
public sealed record NewBudgetRequest(string? SchemeId, decimal? IncreasePct, string? Year, int? FinancialYearEnd);
public sealed record BudgetAction(string? Type, string? Category, string? Kind, decimal? Annual, string? MeetingId, string? ApprovedOn, string? ResolutionRef, string? To,
    Dictionary<string, decimal>? Amounts);
public sealed record BudgetActionRequest(BudgetAction? Action, int? ExpectedVersion);

/// <summary>
/// Budgets on the API (D28): each scheme's budget for a financial year, with actuals from Humo PM's own records — levies
/// billed (the ledger) and supplier invoices paid or approved, by category. The owners approve it at the AGM; until
/// meetings are on the API, the agency records that approval by hand. A year captured part-way carries the spending
/// before Humo PM, so actuals are right from day one.
/// </summary>
public sealed class Budgets(HumoDbContext db, TimeProvider clock)
{
    /// <summary>Expense categories and their share of the levy roll in a typical scheme budget.</summary>
    private static readonly (string Category, decimal Share)[] Expenses =
    [
        ("Insurance", 0.17m), ("Security services", 0.14m), ("Garden services", 0.05m), ("Utilities (common property)", 0.11m), ("Management fees", 0.08m),
        ("Audit & administration", 0.02m), ("Maintenance — building", 0.07m), ("Maintenance — plumbing", 0.03m), ("Maintenance — electrical", 0.02m),
        ("Maintenance — security", 0.02m), ("Maintenance — other", 0.03m), ("Reserve fund contribution", 0.1m),
    ];

    public const int DefaultYearEnd = 2;

    public static readonly string[] Months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    public DateTimeOffset Now => clock.GetUtcNow();
    public DateOnly Today => DateOnly.FromDateTime(Now.ToOffset(TimeSpan.FromHours(2)).DateTime);

    public static string Day(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>The financial year containing the date (offset 0), or the one after (1).</summary>
    public static (DateOnly From, DateOnly To, string Label) Year(int endMonth, DateOnly today, int offset = 0)
    {
        var end = new DateOnly(today.Year, endMonth, DateTime.DaysInMonth(today.Year, endMonth));
        if (end < today) end = end.AddYears(1);
        end = new DateOnly(end.Year + offset, endMonth, DateTime.DaysInMonth(end.Year + offset, endMonth));
        var from = end.AddDays(1).AddYears(-1);
        return (from, end, endMonth == 12 ? $"{end.Year}" : $"{end.Year - 1}/{end.Year % 100:00}");
    }

    /// <summary>The budget line a supplier invoice counts against: its job's category, or the supplier's trade.</summary>
    public static string CategoryFor(string category)
    {
        var c = category.ToLowerInvariant();
        if (c.Contains("plumbing")) return "Maintenance — plumbing";
        if (c.Contains("electrical")) return "Maintenance — electrical";
        if (c.Contains("security") || c.Contains("gate")) return "Maintenance — security";
        if (c.Contains("building") || c.Contains("roof") || c.Contains("paint")) return "Maintenance — building";
        return "Maintenance — other";
    }

    /// <summary>Categories Humo PM records spending for (supplier invoices); insurance, municipal and audit aren't tracked yet.</summary>
    public static bool Tracked(string category) => category.StartsWith("Maintenance", StringComparison.Ordinal) || category.EndsWith("services", StringComparison.Ordinal);

    public static List<BudgetLine> Lines(BudgetRow b) => JsonSerializer.Deserialize<List<BudgetLine>>(b.Lines, Json.Options) ?? [];
    public static BroughtForward? Opening(BudgetRow b) => b.BroughtForward is null ? null : JsonSerializer.Deserialize<BroughtForward>(b.BroughtForward, Json.Options);

    public static BudgetDto ToDto(BudgetRow b) => new(b.Id.ToString(), b.Version, b.SchemeId.ToString(), b.Year, Day(b.From), Day(b.To), b.Status, Lines(b), b.CreatedBy,
        b.UpdatedAt.ToString("O"), b.Approved is null ? null : JsonSerializer.Deserialize<BudgetApproval>(b.Approved, Json.Options), Opening(b),
        b.Agm is null ? null : JsonSerializer.Deserialize<BudgetAgm>(b.Agm, Json.Options));

    private static decimal Whole(decimal n) => Math.Round(n, 0, MidpointRounding.AwayFromZero);

    /// <summary>The scheme's levy roll for a year, and a typical budget from it.</summary>
    public async Task<List<BudgetLine>> DefaultLinesAsync(Guid schemeId, CancellationToken ct)
    {
        var roll = (await db.Units.Where(u => u.SchemeId == schemeId).Select(u => u.MonthlyLevy).ToListAsync(ct)).Sum() * 12;
        decimal Round(decimal n) => Math.Round(n / 1000, 0, MidpointRounding.AwayFromZero) * 1000;
        return [new("Levies", "income", Round(roll)), new("Interest & other income", "income", Round(roll * 0.01m)), .. Expenses.Select(e => new BudgetLine(e.Category, "expense", Round(roll * e.Share)))];
    }

    /// <summary>Supplier invoices of the scheme by budget category: paid in the range, and approved but not yet paid.</summary>
    private async Task<Dictionary<string, (decimal Paid, decimal Committed)>> SpendAsync(Guid schemeId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var invoices = await db.SupplierInvoices.Where(i => i.SchemeId == schemeId && (i.Status == "paid" || i.Status == "approved" || i.Status == "in-batch")).ToListAsync(ct);
        var jobIds = invoices.Where(i => i.JobId != null).Select(i => i.JobId!.Value).Distinct().ToList();
        var jobs = (await db.Jobs.Where(j => jobIds.Contains(j.Id)).ToListAsync(ct)).ToDictionary(j => j.Id, j => MaintenanceService.Read(j).Category);
        var supplierIds = invoices.Select(i => i.SupplierId).Distinct().ToList();
        var trades = (await db.Suppliers.Where(s => supplierIds.Contains(s.Id)).ToListAsync(ct)).ToDictionary(s => s.Id, s => MaintenanceService.List<string>(s.Trades).FirstOrDefault() ?? "");
        var day = (DateTimeOffset t) => DateOnly.FromDateTime(t.ToOffset(TimeSpan.FromHours(2)).DateTime);
        var spend = new Dictionary<string, (decimal Paid, decimal Committed)>();
        foreach (var i in invoices)
        {
            var category = i.JobId is { } j && jobs.TryGetValue(j, out var c) ? CategoryFor(c)
                : trades.GetValueOrDefault(i.SupplierId) switch { "Security" => "Security services", "Gardens" => "Garden services", var t => CategoryFor(t ?? "") };
            var (paid, committed) = spend.GetValueOrDefault(category);
            if (i.Status == "paid" && day(i.PaidAt ?? i.ReceivedAt) is var p && p >= from && p <= to) paid += i.Amount;
            else if (i.Status != "paid" && day(i.ReceivedAt) is var r && r >= from && r <= to) committed += i.Amount;
            spend[category] = (paid, committed);
        }
        return spend;
    }

    public async Task<BudgetViewDto> ViewAsync(BudgetRow b, SchemeDto scheme, CancellationToken ct)
    {
        var sa = TimeSpan.FromHours(2);
        var start = new DateTimeOffset(b.From.ToDateTime(TimeOnly.MinValue), sa);
        var end = new DateTimeOffset(b.To.ToDateTime(new TimeOnly(23, 59, 59)), sa);
        var elapsed = Math.Clamp((Now - start).TotalSeconds / (end - start).TotalSeconds, 0, 1);
        // Levies are billed monthly in advance: the months whose first day has passed.
        var monthsBilled = Math.Clamp(Today.Year * 12 + Today.Month - (b.From.Year * 12 + b.From.Month) + 1, 0, 12);
        var opening = Opening(b);
        var since = opening is null ? b.From : DateOnly.ParseExact(opening.To, "yyyy-MM-dd", CultureInfo.InvariantCulture).AddDays(1);
        var spend = await SpendAsync(b.SchemeId, since, b.To, ct);
        var accounts = await db.LevyAccounts.Where(a => a.SchemeId == b.SchemeId).Select(a => a.Id).ToListAsync(ct);
        var levies = (await db.Ledger.Where(e => accounts.Contains(e.AccountId) && e.Type == TransactionTypes.Levy && e.Date >= since && e.Date <= b.To).Select(e => e.Amount).ToListAsync(ct)).Sum();
        var lines = Lines(b).Select(line =>
        {
            var isLevies = line.Kind == "income" && line.Category == "Levies";
            var toDate = Whole(isLevies ? line.Annual * monthsBilled / 12 : line.Annual * (decimal)elapsed);
            decimal? actual = null;
            decimal committed = 0;
            decimal? before = opening is not null && opening.Amounts.TryGetValue(line.Category, out var b4) ? b4 : null;
            if (isLevies) actual = Whole(levies + (before ?? 0));
            else if (line.Kind == "expense" && (spend.ContainsKey(line.Category) || Tracked(line.Category) || before is not null))
            {
                var s = spend.GetValueOrDefault(line.Category);
                actual = Whole(s.Paid + (before ?? 0));
                committed = Whole(s.Committed);
            }
            else if (before is not null) actual = Whole(before.Value);
            return new BudgetLineViewDto(line, toDate, actual, committed, actual is null ? null : actual - toDate);
        }).ToList();
        decimal Sum(string kind, Func<BudgetLineViewDto, decimal> f) => lines.Where(l => l.Line.Kind == kind).Sum(f);
        var income = Sum("income", l => l.Line.Annual);
        var expense = Sum("expense", l => l.Line.Annual);
        return new BudgetViewDto(ToDto(b), scheme, elapsed, lines, new BudgetTotalsDto(income, expense, income - expense, Sum("income", l => l.Actual ?? 0), Sum("expense", l => l.Actual ?? 0)),
            [.. lines.Where(l => l.Line.Kind == "expense" && l.Actual is not null && l.ToDate > 0 && l.Actual + l.Committed > l.ToDate * 1.1m).Select(l => l.Line.Category)]);
    }

    public async Task<List<BudgetViewDto>> ViewsAsync(List<BudgetRow> budgets, CancellationToken ct)
    {
        var ids = budgets.Select(b => b.SchemeId).Distinct().ToList();
        var schemes = (await SchemeEndpoints.ToDtos(await db.Schemes.Where(s => ids.Contains(s.Id)).ToListAsync(ct), db, ct)).ToDictionary(s => s.Id);
        var views = new List<BudgetViewDto>();
        foreach (var b in budgets) views.Add(await ViewAsync(b, schemes[b.SchemeId.ToString()], ct));
        return views;
    }

    /// <summary>For approval cards: this year's approved budget line for a job's category, with paid and committed spending.</summary>
    public async Task<BudgetLineSpendDto?> LineForAsync(Guid schemeId, string jobCategory, CancellationToken ct)
    {
        var scheme = await db.Schemes.FirstOrDefaultAsync(s => s.Id == schemeId, ct);
        if (scheme is null) return null;
        var year = Year(scheme.FinancialYearEnd ?? DefaultYearEnd, Today);
        var b = await db.Budgets.FirstOrDefaultAsync(x => x.SchemeId == schemeId && x.From == year.From && x.Status == "approved", ct);
        var category = CategoryFor(jobCategory);
        if (b is null || Lines(b).FirstOrDefault(l => l.Category == category) is not { } line) return null;
        var opening = Opening(b);
        var since = opening is null ? b.From : DateOnly.ParseExact(opening.To, "yyyy-MM-dd", CultureInfo.InvariantCulture).AddDays(1);
        var s = (await SpendAsync(schemeId, since, b.To, ct)).GetValueOrDefault(category);
        return new BudgetLineSpendDto(category, line.Annual, Whole(s.Paid + s.Committed + (opening?.Amounts.GetValueOrDefault(category) ?? 0)));
    }
}

/// <summary>
/// Finance › Budgets (D28): reading needs Finance.View within the person's schemes; drafting, editing and recording the
/// owners' approval need Budgets.Manage on a plan with budgets.
/// </summary>
public static class BudgetEndpoints
{
    public static void MapBudgets(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/budgets").RequireAuthorization();
        g.MapGet("", List);
        g.MapGet("/{id:guid}", Get);
        g.MapPost("", Create);
        g.MapPost("/{id:guid}/actions", Act);
    }

    private static async Task<IResult> List(string[]? schemeIds, CurrentActor current, HumoDbContext db, Budgets budgets, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.OrganisationId is not { } org || !actor.Can("Finance.View")) return Results.Ok(Array.Empty<BudgetViewDto>());
        var wanted = (schemeIds ?? []).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).ToHashSet();
        var visible = (await SchemeEndpoints.Visible(actor, db).Select(s => s.Id).ToListAsync(ct)).Where(wanted.Contains).ToList();
        var rows = (await db.Budgets.Where(b => b.OrganisationId == org && visible.Contains(b.SchemeId)).ToListAsync(ct)).OrderBy(b => b.From).ToList();
        return Results.Ok(await budgets.ViewsAsync(rows, ct));
    }

    private static async Task<BudgetRow?> VisibleAsync(Actor actor, HumoDbContext db, Guid id, CancellationToken ct)
    {
        if (actor.OrganisationId is not { } org || !actor.Can("Finance.View")) return null;
        var row = await db.Budgets.FirstOrDefaultAsync(b => b.Id == id && b.OrganisationId == org, ct);
        return row is not null && await SchemeEndpoints.Visible(actor, db).AnyAsync(s => s.Id == row.SchemeId, ct) ? row : null;
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, Budgets budgets, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        return await VisibleAsync(actor, db, id, ct) is { } row ? Results.Ok((await budgets.ViewsAsync([row], ct))[0]) : Problems.NotFound();
    }

    /// <summary>
    /// Next year's draft, from this year's budget increased by a percentage (or a typical budget from the levy roll); or
    /// this year's, captured part-way, to record as approved with the spending before Humo PM. The scheme's year end is
    /// asked for the first time.
    /// </summary>
    private static async Task<IResult> Create(NewBudgetRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Budgets budgets, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var scheme = Guid.TryParse(body.SchemeId, out var sid) ? await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(s => s.Id == sid, ct) : null;
        var current_ = body.Year == "current";
        var endMonth = scheme?.FinancialYearEnd ?? body.FinancialYearEnd ?? Budgets.DefaultYearEnd;
        var year = Budgets.Year(endMonth, budgets.Today, current_ ? 0 : 1);
        var exists = scheme is not null && await db.Budgets.AnyAsync(b => b.SchemeId == scheme.Id && b.From == year.From, ct);
        var pct = body.IncreasePct ?? 0;
        return await commands.RunAsync(new CommandSpec($"{(current_ ? "Captured this year’s" : "Drafted next year’s")} budget ({year.Label}) for {scheme?.Name ?? "a scheme"}{(current_ ? "" : $" ({(pct >= 0 ? "+" : "")}{pct}%)")}", "Budgets.Manage")
        {
            Resource = "Budget",
            SchemeId = scheme?.Id,
            Feature = "budgets",
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (scheme is null) return new() { ["schemeId"] = "Choose a scheme." };
                if (body.Year is not ("current" or "next")) e["year"] = "This year’s or next year’s.";
                if (scheme.FinancialYearEnd is { } set && body.FinancialYearEnd is { } asked && asked != set)
                    e["financialYearEnd"] = $"{scheme.Name}’s year ends in {Budgets.Months[set - 1]}. Change it in Settings › Levies & billing first.";
                else if (body.FinancialYearEnd is { } m && (m < 1 || m > 12)) e["financialYearEnd"] = "Choose a month.";
                if (exists) e["schemeId"] = $"There’s already a {year.Label} budget for {scheme.Name}.";
                if (!current_ && pct is < -20 or > 30) e["increasePct"] = "Between −20% and 30%.";
                return e;
            },
        }, async actor =>
        {
            scheme!.FinancialYearEnd ??= endMonth;
            var lines = await budgets.DefaultLinesAsync(scheme.Id, ct);
            if (!current_)
            {
                var thisYear = Budgets.Year(endMonth, budgets.Today);
                if (await db.Budgets.FirstOrDefaultAsync(b => b.SchemeId == scheme.Id && b.From == thisYear.From, ct) is { } basis)
                    lines = [.. Budgets.Lines(basis).Select(l => l with { Annual = Math.Round(l.Annual * (1 + pct / 100) / 100, 0, MidpointRounding.AwayFromZero) * 100 })];
            }
            var row = new BudgetRow
            {
                Id = Guid.CreateVersion7(), OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, Year = year.Label, From = year.From, To = year.To, Status = "draft",
                Lines = JsonSerializer.Serialize(lines, Json.Options), CreatedBy = actor.Human.Name, UpdatedAt = budgets.Now,
            };
            // This year, captured part-way: spending before Humo PM is entered next, up to yesterday by default.
            if (current_) row.BroughtForward = JsonSerializer.Serialize(new BroughtForward(Budgets.Day(budgets.Today.AddDays(-1) < year.From ? year.From : budgets.Today.AddDays(-1)), []), Json.Options);
            db.Budgets.Add(row);
            return Results.Created($"/api/budgets/{row.Id}", new { id = row.Id.ToString() });
        }, ct);
    }

    private static async Task<IResult> Act(Guid id, BudgetActionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Budgets budgets, Governance.Governance governance,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await VisibleAsync(me, db, id, ct) is not { } b) return Problems.NotFound();
        var scheme = await db.Schemes.FirstAsync(s => s.Id == b.SchemeId, ct);
        var a = body.Action ?? new BudgetAction(null, null, null, null, null, null, null, null, null);
        var lines = Budgets.Lines(b);
        var category = (a.Category ?? "").Trim();
        var approvedOn = DateOnly.TryParseExact(a.ApprovedOn, "yyyy-MM-dd", out var on) ? on : (DateOnly?)null;
        var openingTo = DateOnly.TryParseExact(a.To, "yyyy-MM-dd", out var t) ? t : (DateOnly?)null;
        // Proposing: this scheme's AGM whose agenda is still open, and the agenda items other budgets already hold.
        var agmRow = a.Type == "propose" && Guid.TryParse(a.MeetingId, out var mid) ? await db.Meetings.FirstOrDefaultAsync(x => x.Id == mid && x.SchemeId == b.SchemeId, ct) : null;
        var taken = agmRow is null ? [] : (await db.Budgets.Where(x => x.Id != b.Id && x.Agm != null).Select(x => x.Agm!).ToListAsync(ct))
            .Select(x => JsonSerializer.Deserialize<BudgetAgm>(x, Json.Options)!).Where(x => x.MeetingId == agmRow.Id.ToString()).Select(x => x.AgendaItemId).ToList();
        var what = a.Type switch
        {
            "set-line" => $"Set {category} to {BillingRules.Rand(a.Annual ?? 0)} in",
            "remove-line" => $"Removed {category} from",
            "record-approval" => $"Recorded the owners’ approval ({(a.ResolutionRef ?? "").Trim()}, {a.ApprovedOn}) of",
            "set-opening" => $"Set the spending before Humo Property Management (to {a.To}) for",
            "propose" => $"Put on the agenda of {agmRow?.Ref ?? "an AGM"}",
            _ => "Changed",
        };
        return await commands.RunAsync(new CommandSpec($"{what} the {b.Year} budget for {scheme.Name}", "Budgets.Manage")
        {
            Resource = "Budget",
            ResourceId = id.ToString(),
            SchemeId = b.SchemeId,
            Feature = "budgets",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = b.Version,
            // Recording the owners' approval fixes the figures everyone is held to: a fresh passkey, and in the security log.
            StepUp = a.Type == "record-approval",
            Category = a.Type == "record-approval" ? "security" : "activity",
            Validate = () =>
            {
                if (a.Type is "set-line" or "remove-line" && b.Status != "draft")
                    return new() { ["id"] = b.Status == "approved" ? "An approved budget can’t change: the owners approved these figures." : "It’s on the AGM agenda: the figures are what the owners will vote on." };
                switch (a.Type)
                {
                    case "set-line":
                        if (category.Length < 3) return new() { ["category"] = "Name the category." };
                        if (a.Kind is not ("income" or "expense")) return new() { ["kind"] = "Income or expense." };
                        return a.Annual is not >= 0 ? new() { ["annual"] = "An amount of R 0 or more." } : [];
                    case "remove-line":
                        return lines.Any(l => l.Category == category) ? [] : new() { ["category"] = "No such line." };
                    case "propose":
                        if (agmRow is null || agmRow.Type != "agm") return new() { ["meetingId"] = "Choose this scheme’s AGM." };
                        if (agmRow.Stage != "draft") return new() { ["meetingId"] = "Notice has gone out: the agenda is fixed. Propose it at the next AGM, or at an SGM." };
                        return b.Status == "proposed" ? new() { ["id"] = "Already on an AGM agenda." } : [];
                    case "record-approval":
                        if (b.Status == "approved") return new() { ["id"] = "It’s already approved." };
                        if (lines.Count == 0) return new() { ["id"] = "Add the budget’s lines first." };
                        if (approvedOn is null || approvedOn > budgets.Today) return new() { ["approvedOn"] = "The date of the meeting, today or earlier." };
                        return (a.ResolutionRef ?? "").Trim().Length < 3 ? new() { ["resolutionRef"] = "The resolution’s number or the minutes’ reference, e.g. AGM 2025 resolution 4." } : [];
                    case "set-opening":
                        if (b.From > budgets.Today) return new() { ["id"] = "The year hasn’t started: there’s no spending before Humo Property Management to enter." };
                        if (openingTo is null || openingTo < b.From || openingTo > budgets.Today) return new() { ["to"] = "A date in the year, up to today." };
                        if ((a.Amounts ?? []).Any(x => x.Value < 0)) return new() { ["amounts"] = "Amounts of R 0 or more." };
                        return (a.Amounts ?? []).Keys.All(k => lines.Any(l => l.Category == k)) ? [] : new() { ["amounts"] = "Only the budget’s own lines." };
                    default:
                        return new() { ["type"] = "Not something a budget can do." };
                }
            },
        }, actor =>
        {
            switch (a.Type)
            {
                case "set-line":
                    var line = new BudgetLine(category, a.Kind!, Math.Round(a.Annual!.Value, 0, MidpointRounding.AwayFromZero));
                    var i = lines.FindIndex(l => l.Category == category);
                    if (i >= 0) lines[i] = line;
                    else lines.Add(line);
                    break;
                case "remove-line":
                    lines.RemoveAll(l => l.Category == category);
                    break;
                case "record-approval":
                    b.Status = "approved";
                    b.Approved = JsonSerializer.Serialize(new BudgetApproval(Budgets.Day(approvedOn!.Value), a.ResolutionRef!.Trim(), null, actor.Human.Name), Json.Options);
                    break;
                case "propose":
                {
                    var m = Governance.Governance.Read(agmRow!);
                    var expense = lines.Where(l => l.Kind == "expense").Sum(l => l.Annual);
                    var notes = $"The {b.Year} budget: expenses of {BillingRules.Rand(expense)} for the year from {Budgets.Day(b.From)}. A resolution on this item approves it.";
                    var itemId = Governance.GovernanceEndpoints.PlaceOnAgenda(m, governance, x => x.Contains("budget", StringComparison.OrdinalIgnoreCase), $"Approve the {b.Year} budget", notes,
                        actor.Human.Name, taken);
                    Governance.Governance.Write(agmRow!, m);
                    b.Agm = JsonSerializer.Serialize(new BudgetAgm(m.Id, m.Ref, itemId), Json.Options);
                    b.Status = "proposed";
                    break;
                }
                case "set-opening":
                    b.BroughtForward = JsonSerializer.Serialize(new BroughtForward(Budgets.Day(openingTo!.Value),
                        (a.Amounts ?? []).Where(x => x.Value > 0).ToDictionary(x => x.Key, x => Math.Round(x.Value, 2))), Json.Options);
                    break;
            }
            b.Lines = JsonSerializer.Serialize(lines, Json.Options);
            b.UpdatedAt = budgets.Now;
            b.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }
}
