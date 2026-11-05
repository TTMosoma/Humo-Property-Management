using System.Globalization;
using Humo.Api.Commands;
using Humo.Api.Finance;
using Humo.Api.Maintenance;
using Humo.Domain.Finance;
using Humo.Domain.Maintenance;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Portfolio;

// The shapes match the app's report model (domain/models/report.ts).
public sealed record ReportDefDto(string Id, string Title, string Category, string Description, string Permission, string Feature, bool? Period = null);
public sealed record ReportColumnDto(string Key, string Label, string Kind, bool Total = false);
public sealed record ReportResultDto(ReportDefDto Def, string GeneratedAt, string Scope, List<ReportColumnDto> Columns, List<Dictionary<string, object?>> Rows, List<string?>? Links,
    Dictionary<string, object?>? Totals, List<string> Notes);

/// <summary>
/// Each scheme's vital signs, from its records: collections, arrears, accounts 90 days and more, open and overdue jobs.
/// Compliance isn't on the API yet, so it reads as not applicable. The dashboard, the scheme pages and the scheme
/// health report all use this, so they agree.
/// </summary>
public sealed class SchemeHealth(HumoDbContext db, TimeProvider clock)
{
    public async Task<List<SchemeHealthDto>> ForAsync(IReadOnlyCollection<Guid> ids, CancellationToken ct)
    {
        var rolls = await db.Units.Where(u => ids.Contains(u.SchemeId)).GroupBy(u => u.SchemeId).Select(g => new { g.Key, Roll = g.Sum(u => u.MonthlyLevy) }).ToDictionaryAsync(x => x.Key, x => x.Roll, ct);
        var accounts = await db.LevyAccounts.Where(a => ids.Contains(a.SchemeId)).ToListAsync(ct);
        var jobs = await db.Jobs.Where(j => ids.Contains(j.SchemeId) && j.Stage != JobStages.Closed && j.Stage != JobStages.Cancelled && j.Stage != JobStages.Paid).ToListAsync(ct);
        var now = clock.GetUtcNow();
        return [.. ids.Select(id =>
        {
            var roll = rolls.GetValueOrDefault(id);
            var mine = accounts.Where(a => a.SchemeId == id).ToList();
            // Collected ≈ 1 − unpaid from the last three months ÷ three months' charges.
            var recentUnpaid = mine.Sum(a => Math.Max(0, a.AgeingCurrent) + Math.Max(0, a.AgeingD30) + Math.Max(0, a.AgeingD60));
            var rate = roll > 0 ? Math.Round(Math.Max(0, 1 - (double)(recentUnpaid / (3 * roll))) * 100, 1) : 100;
            var arrears = Ledger.Round2(mine.Sum(a => Math.Max(0, a.AgeingD30) + Math.Max(0, a.AgeingD60) + Math.Max(0, a.AgeingD90) + Math.Max(0, a.AgeingD120)));
            var ninety = mine.Count(a => a.AgeingD90 > 0 || a.AgeingD120 > 0);
            var open = jobs.Where(j => j.SchemeId == id).Select(MaintenanceService.Read).ToList();
            var overdue = open.Count(j => j.Stage is JobStages.Quoting or JobStages.Scheduled or JobStages.InProgress && j.DueAt is { } d
                && DateTimeOffset.TryParse(d, CultureInfo.InvariantCulture, out var due) && due < now);
            var rating = rate < 85 ? "at-risk" : rate < 95 || ninety > 0 || overdue > 0 ? "watch" : "good";
            return new SchemeHealthDto(id.ToString(), rate, arrears, ninety, roll, open.Count, overdue, "not-applicable", 0, rating);
        })];
    }
}

/// <summary>
/// Reports (review finding F7) on the API: one catalogue, each report a table worked out from live records in the
/// person's schemes. Reports.View, plus each report's own permission and plan feature. Compliance status waits for
/// compliance on the API, so it's not in the catalogue yet.
/// </summary>
public static class ReportEndpoints
{
    private static readonly ReportDefDto[] Catalogue =
    [
        new("levy-roll", "Levy roll", "financial", "Each scheme’s units and monthly levies.", "Finance.View", "reporting-basic"),
        new("billing-summary", "Billing summary", "financial", "Every billing run: period, accounts, total and where it stands.", "Billing.View", "reporting-financial", true),
        new("receipts", "Receipts", "financial", "Payments received per scheme: allocated, still to allocate, in suspense.", "Finance.View", "reporting-financial", true),
        new("supplier-payments", "Supplier payments", "financial", "What each supplier was paid, by scheme.", "Finance.View", "reporting-financial", true),
        new("age-analysis", "Age analysis", "arrears", "Arrears per scheme: current, 30, 60, 90 and 120+ days.", "Finance.View", "reporting-basic"),
        new("debtors", "Debtors list", "arrears", "Every account in arrears with its age and collection stage.", "Accounts.View", "reporting-financial"),
        new("collections", "Collection pipeline", "arrears", "How many accounts sit at each collection stage, per scheme.", "Billing.View", "credit-control"),
        new("jobs-by-stage", "Jobs by stage", "maintenance", "Open maintenance jobs per scheme, by stage, with what’s overdue.", "Maintenance.Browse", "reporting-basic"),
        new("supplier-performance", "Supplier performance", "maintenance", "Jobs, on-time rate, invoice vs quote and spend per supplier.", "Suppliers.View", "reporting-basic"),
        new("resolutions", "Resolutions register", "governance", "Every resolution with its outcome and the progress of its actions.", "Resolutions.View", "governance"),
        new("scheme-health", "Scheme health", "portfolio", "Collections, arrears, jobs and rating for every scheme.", "Portfolio.View", "reporting-basic"),
        new("occupancy", "Units & occupancy", "portfolio", "Owner-occupied, tenanted and vacant units per scheme.", "Portfolio.View", "reporting-basic"),
    ];

    private static readonly string[] OpenStages =
        [JobStages.Reported, JobStages.Quoting, JobStages.Approval, JobStages.Approved, JobStages.Scheduled, JobStages.InProgress, JobStages.Completed, JobStages.Verified, JobStages.Invoiced, JobStages.Paid];

    public static void MapReports(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/reports").RequireAuthorization();
        g.MapGet("", List);
        g.MapGet("/{id}", Run);
    }

    private static async Task<List<ReportDefDto>> AllowedAsync(Actor actor, Commercial.CommercialRecords commercial, CancellationToken ct)
    {
        if (actor.OrganisationId is not { } org || !actor.Can("Reports.View")) return [];
        var allowed = new List<ReportDefDto>();
        foreach (var r in Catalogue)
            if (actor.Can(r.Permission) && await commercial.EntitledAsync(org, r.Feature, ct)) allowed.Add(r);
        return allowed;
    }

    private static async Task<IResult> List(CurrentActor current, Commercial.CommercialRecords commercial, CancellationToken ct) =>
        await current.GetAsync(ct) is not { } actor ? Results.Unauthorized() : Results.Ok(await AllowedAsync(actor, commercial, ct));

    private static ReportColumnDto Col(string key, string label, string kind = "text", bool total = false) => new(key, label, kind, total);

    private static async Task<IResult> Run(string id, string[]? schemeIds, int? months, CurrentActor current, HumoDbContext db, Commercial.CommercialRecords commercial,
        SchemeHealth health, MaintenanceService maintenance, CreditControl collections, Governance.Governance governance, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if ((await AllowedAsync(actor, commercial, ct)).FirstOrDefault(r => r.Id == id) is not { } def) return Problems.NotFound();
        var wanted = (schemeIds ?? []).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).ToHashSet();
        var schemes = (await SchemeEndpoints.Visible(actor, db).ToListAsync(ct)).Where(s => wanted.Contains(s.Id)).OrderBy(s => s.Name).ToList();
        var ids = schemes.Select(s => s.Id).ToList();
        var period = def.Period == true ? Math.Clamp(months ?? 3, 1, 24) : (int?)null;
        var now = clock.GetUtcNow();
        var since = period is { } m ? now.AddDays(-30 * m) : DateTimeOffset.MinValue;
        var sinceDay = DateOnly.FromDateTime(since.ToOffset(TimeSpan.FromHours(2)).DateTime);
        var scope = $"{ids.Count} scheme{(ids.Count == 1 ? "" : "s")}{(period is { } p ? $" · last {p} month{(p == 1 ? "" : "s")}" : "")}";

        List<ReportColumnDto> columns;
        List<Dictionary<string, object?>> rows;
        List<string?>? links = null;
        List<string> notes = [];
        switch (id)
        {
            case "levy-roll":
            {
                var units = await db.Units.Where(u => ids.Contains(u.SchemeId)).ToListAsync(ct);
                columns = [Col("scheme", "Scheme"), Col("type", "Type"), Col("units", "Units", "number", true), Col("roll", "Monthly levies", "money", true), Col("average", "Average per unit", "money"), Col("annual", "Annual", "money", true)];
                rows = [.. schemes.Select(s =>
                {
                    var us = units.Where(u => u.SchemeId == s.Id).ToList();
                    var roll = us.Sum(u => u.MonthlyLevy);
                    return Row(("scheme", s.Name), ("type", s.Type), ("units", us.Count), ("roll", roll), ("average", us.Count == 0 ? 0 : Math.Round(roll / us.Count, 0)), ("annual", roll * 12));
                })];
                links = [.. schemes.Select(s => (string?)$"/schemes/{s.Id}/overview")];
                notes.Add("Ordinary levies only; special levies and utilities are billed separately.");
                break;
            }
            case "billing-summary":
            {
                var runs = (await db.BillingRuns.Where(r => ids.Contains(r.SchemeId)).ToListAsync(ct)).Select(r => (Row: r, Run: LevyBilling.Read(r)))
                    .Where(x => DateTimeOffset.Parse(x.Run.CreatedAt, CultureInfo.InvariantCulture) >= since || (x.Run.Posted?.At is { } at && DateTimeOffset.Parse(at, CultureInfo.InvariantCulture) >= since))
                    .OrderByDescending(x => x.Run.Period).ToList();
                var stages = new Dictionary<string, string> { ["preview"] = "Preparing", ["awaiting-approval"] = "Awaiting approval", ["approved"] = "Approved", ["posted"] = "Posted", ["sent"] = "Statements sent", ["cancelled"] = "Cancelled" };
                columns = [Col("run", "Run"), Col("scheme", "Scheme"), Col("period", "Period"), Col("stage", "Stage"), Col("accounts", "Accounts", "number"), Col("total", "Total", "money", true), Col("posted", "Posted", "date")];
                rows = [.. runs.Select(x => Row(("run", x.Run.Ref), ("scheme", schemes.First(s => s.Id == x.Row.SchemeId).Name), ("period", x.Run.Period), ("stage", stages.GetValueOrDefault(x.Row.Stage, x.Row.Stage)),
                    ("accounts", x.Run.Lines.Count(l => !l.Excluded)), ("total", x.Row.Stage == "cancelled" ? 0 : BillingRules.Total(x.Run)), ("posted", x.Run.Posted?.At)))];
                links = [.. runs.Select(x => (string?)$"/finance/billing/{x.Run.Id}")];
                notes.Add("Cancelled runs show a total of R 0: nothing was posted.");
                break;
            }
            case "receipts":
            {
                var receipts = await db.Receipts.Where(r => ids.Contains(r.SchemeId) && r.Date >= sinceDay).ToListAsync(ct);
                columns = [Col("scheme", "Scheme"), Col("count", "Payments", "number", true), Col("total", "Received", "money", true), Col("allocated", "Allocated", "money", true), Col("unallocated", "To allocate", "money", true), Col("suspense", "Suspense", "money", true)];
                rows = [.. schemes.Select(s =>
                {
                    var rs = receipts.Where(r => r.SchemeId == s.Id).ToList();
                    decimal Sum(string? st) => rs.Where(r => st is null || r.Status == st).Sum(r => r.Amount);
                    return Row(("scheme", s.Name), ("count", rs.Count), ("total", Sum(null)), ("allocated", Sum("allocated")), ("unallocated", Sum("unallocated")), ("suspense", Sum("suspense")));
                }).Where(r => (int)r["count"]! > 0)];
                notes.Add("From the trust accounts’ bank imports, and card payments through each scheme’s Payfast account.");
                break;
            }
            case "supplier-payments":
            {
                var paid = (await db.SupplierInvoices.Where(i => ids.Contains(i.SchemeId) && i.Status == "paid").ToListAsync(ct)).Where(i => (i.PaidAt ?? i.ReceivedAt) >= since).ToList();
                var supplierIds = paid.Select(i => i.SupplierId).Distinct().ToList();
                var names = await db.Suppliers.Where(s => supplierIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name, ct);
                var groups = paid.GroupBy(i => i.SupplierId).OrderByDescending(g => g.Sum(i => i.Amount)).ToList();
                columns = [Col("supplier", "Supplier"), Col("schemes", "Schemes"), Col("count", "Invoices", "number", true), Col("total", "Paid", "money", true)];
                rows = [.. groups.Select(g => Row(("supplier", names.GetValueOrDefault(g.Key, "?")), ("schemes", string.Join(", ", g.Select(i => schemes.First(s => s.Id == i.SchemeId).Code).Distinct().Order())),
                    ("count", g.Count()), ("total", Ledger.Round2(g.Sum(i => i.Amount)))))];
                links = [.. groups.Select(g => (string?)$"/suppliers/{g.Key}")];
                notes.Add("Released payment batches only.");
                break;
            }
            case "age-analysis":
            {
                var accounts = await db.LevyAccounts.Where(a => ids.Contains(a.SchemeId)).ToListAsync(ct);
                columns = [Col("scheme", "Scheme"), Col("current", "Current", "money", true), Col("d30", "30 days", "money", true), Col("d60", "60 days", "money", true), Col("d90", "90 days", "money", true),
                    Col("d120", "120+ days", "money", true), Col("total", "Owed", "money", true)];
                rows = [.. schemes.Select(s =>
                {
                    var a = accounts.Where(x => x.SchemeId == s.Id).ToList();
                    return Row(("scheme", s.Name), ("current", Ledger.Round2(a.Sum(x => x.AgeingCurrent))), ("d30", Ledger.Round2(a.Sum(x => x.AgeingD30))), ("d60", Ledger.Round2(a.Sum(x => x.AgeingD60))),
                        ("d90", Ledger.Round2(a.Sum(x => x.AgeingD90))), ("d120", Ledger.Round2(a.Sum(x => x.AgeingD120))), ("total", Ledger.Round2(a.Sum(x => Math.Max(0, x.Balance)))));
                })];
                notes.Add("Ageing as at today, from each account’s transactions.");
                break;
            }
            case "debtors":
            {
                var views = (await collections.ListAsync(ids, ct)).OrderByDescending(v => v.OverdueAmount).ToList();
                columns = [Col("account", "Account"), Col("unit", "Unit"), Col("holder", "Owner"), Col("scheme", "Scheme"), Col("overdue", "Overdue", "money", true), Col("days", "Days", "number"), Col("stage", "Stage"), Col("phone", "Phone")];
                rows = [.. views.Select(v => Row(("account", v.Account.AccountNo), ("unit", v.Unit.Number), ("holder", v.Holder.DisplayName), ("scheme", v.Scheme.Name), ("overdue", v.OverdueAmount),
                    ("days", v.DaysInArrears), ("stage", CollectionStages.Labels.GetValueOrDefault(v.Case.Stage, v.Case.Stage)), ("phone", v.Holder.Phone)))];
                links = [.. views.Select(v => (string?)$"/finance/credit-control/{v.Account.Id}")];
                notes.Add("Contains personal information: export only what you need, and keep it safe.");
                break;
            }
            case "collections":
            {
                var views = await collections.ListAsync(ids, ct);
                var stages = CollectionStages.Labels.Keys.ToList();
                columns = [Col("scheme", "Scheme"), .. stages.Select(st => Col(st, CollectionStages.Labels[st].Replace(" sent", ""), "number", true)), Col("overdue", "Overdue", "money", true)];
                rows = [.. schemes.Select(s =>
                {
                    var v = views.Where(x => x.Scheme.Id == s.Id.ToString()).ToList();
                    var row = Row(("scheme", s.Name));
                    foreach (var st in stages) row[st] = v.Count(x => x.Case.Stage == st);
                    row["overdue"] = Ledger.Round2(v.Sum(x => x.OverdueAmount));
                    return row;
                }).Where(r => (decimal)r["overdue"]! > 0)];
                break;
            }
            case "jobs-by-stage":
            {
                var jobs = (await db.Jobs.Where(j => ids.Contains(j.SchemeId) && j.Stage != JobStages.Closed && j.Stage != JobStages.Cancelled).ToListAsync(ct)).Select(MaintenanceService.Read).ToList();
                columns = [Col("scheme", "Scheme"), .. OpenStages.Select(st => Col(st, JobStages.Labels[st], "number", true)), Col("total", "Open", "number", true), Col("overdue", "Overdue", "number", true)];
                rows = [.. schemes.Select(s =>
                {
                    var js = jobs.Where(j => j.SchemeId == s.Id.ToString()).ToList();
                    var row = Row(("scheme", s.Name));
                    foreach (var st in OpenStages) row[st] = js.Count(j => j.Stage == st);
                    row["total"] = js.Count;
                    row["overdue"] = js.Count(j => j.Stage is JobStages.Quoting or JobStages.Scheduled or JobStages.InProgress && j.DueAt is { } d
                        && DateTimeOffset.TryParse(d, CultureInfo.InvariantCulture, out var due) && due < now);
                    return row;
                }).Where(r => (int)r["total"]! > 0)];
                notes.Add("Overdue: past the stage’s due date while quoting, scheduled or in progress.");
                break;
            }
            case "supplier-performance":
            {
                var org = actor.OrganisationId!.Value;
                var keys = ids.Select(i => i.ToString()).ToHashSet();
                var suppliers = (await db.Suppliers.Where(s => s.OrganisationId == org && s.Status != "archived").ToListAsync(ct))
                    .Where(s => MaintenanceService.List<string>(s.SchemeIds).Any(keys.Contains)).OrderBy(s => s.Name).ToList();
                var summaries = await maintenance.SummariesAsync(suppliers, ct);
                columns = [Col("supplier", "Supplier"), Col("trades", "Trades"), Col("jobs", "Jobs done", "number", true), Col("onTime", "On time", "percent"), Col("variance", "Invoice vs quote", "percent"),
                    Col("verified", "Fixed first time", "percent"), Col("spend", "Spend (12 months)", "money", true)];
                rows = [.. summaries.Select(x => Row(("supplier", x.Supplier.Name), ("trades", string.Join(", ", x.Supplier.Trades)), ("jobs", x.Supplier.Performance.JobsCompleted),
                    ("onTime", x.Supplier.Performance.OnTimeRate), ("variance", x.Supplier.Performance.AvgVariance), ("verified", x.Supplier.Performance.VerifiedRate), ("spend", x.Spend12m)))];
                links = [.. summaries.Select(x => (string?)$"/suppliers/{x.Supplier.Id}")];
                notes.Add("With this agency only.");
                break;
            }
            case "scheme-health":
            {
                var h = (await health.ForAsync(ids, ct)).ToDictionary(x => x.SchemeId);
                var ratings = new Dictionary<string, string> { ["good"] = "Healthy", ["watch"] = "Watch", ["at-risk"] = "At risk" };
                columns = [Col("scheme", "Scheme"), Col("rating", "Health"), Col("collected", "Collected", "percent"), Col("arrears", "Arrears", "money", true), Col("ninety", "90+ days", "number", true),
                    Col("open", "Open jobs", "number", true), Col("overdue", "Overdue jobs", "number", true)];
                rows = [.. schemes.Select(s => h[s.Id.ToString()]).Select(x => Row(("scheme", schemes.First(s => s.Id.ToString() == x.SchemeId).Name), ("rating", ratings[x.Rating]),
                    ("collected", x.CollectionRate), ("arrears", x.Arrears), ("ninety", x.Accounts90Plus), ("open", x.OpenJobs), ("overdue", x.OverdueJobs)))];
                links = [.. schemes.Select(s => (string?)$"/schemes/{s.Id}/overview")];
                notes.Add("Collected ≈ 1 − unpaid from the last 3 months ÷ 3 months’ levies.");
                notes.Add("Ratings: at risk when collections are under 85%; watch when under 95%, or with accounts 90+ days or overdue jobs. Compliance joins the rating when it’s on Humo Property Management.");
                break;
            }
            case "resolutions":
            {
                var views = (await governance.ResolutionViewsAsync(await db.Resolutions.Where(r => ids.Contains(r.SchemeId)).ToListAsync(ct), ct))
                    .OrderByDescending(v => v.Resolution.ProposedAt).ToList();
                var outcomes = new Dictionary<string, string> { ["passed"] = "Passed", ["not-passed"] = "Not passed", ["withdrawn"] = "Withdrawn" };
                var progress = new Dictionary<string, string>
                {
                    ["awaiting-decision"] = "Awaiting trustees", ["not-passed"] = "Not passed", ["withdrawn"] = "Withdrawn", ["no-actions"] = "Passed", ["in-progress"] = "Actions open", ["completed"] = "Completed",
                };
                columns = [Col("ref", "Ref"), Col("title", "Resolution"), Col("scheme", "Scheme"), Col("outcome", "Outcome"), Col("actions", "Actions done"), Col("progress", "Progress")];
                rows = [.. views.Select(v => Row(("ref", v.Resolution.Ref), ("title", v.Resolution.Title), ("scheme", v.Scheme.Name), ("outcome", outcomes.GetValueOrDefault(v.Resolution.Outcome, "Awaiting trustees")),
                    ("actions", v.Actions.Count == 0 ? "—" : $"{v.Actions.Count(x => x.Status == "done")} of {v.Actions.Count}"), ("progress", progress[v.Progress])))];
                links = [.. views.Select(v => (string?)(v.Meeting is { } m ? $"/governance/meetings/{m.Id}" : "/governance/resolutions"))];
                break;
            }
            case "occupancy":
            {
                var units = await db.Units.Where(u => ids.Contains(u.SchemeId)).ToListAsync(ct);
                var accounts = await db.LevyAccounts.Where(a => ids.Contains(a.SchemeId)).ToListAsync(ct);
                columns = [Col("scheme", "Scheme"), Col("units", "Units", "number", true), Col("owner", "Owner-occupied", "number", true), Col("tenanted", "Tenanted", "number", true),
                    Col("vacant", "Vacant", "number", true), Col("arrears", "In arrears", "number", true)];
                rows = [.. schemes.Select(s =>
                {
                    var us = units.Where(u => u.SchemeId == s.Id).ToList();
                    return Row(("scheme", s.Name), ("units", us.Count), ("owner", us.Count(u => u.Occupancy == "owner-occupied")), ("tenanted", us.Count(u => u.Occupancy == "tenanted")),
                        ("vacant", us.Count(u => u.Occupancy == "vacant")), ("arrears", accounts.Count(a => a.SchemeId == s.Id && a.AgeingD30 + a.AgeingD60 + a.AgeingD90 + a.AgeingD120 > 0)));
                })];
                links = [.. schemes.Select(s => (string?)$"/schemes/{s.Id}/units")];
                break;
            }
            default:
                return Problems.NotFound();
        }
        return Results.Ok(new ReportResultDto(def, now.ToOffset(TimeSpan.FromHours(2)).ToString("O"), scope, columns, rows, links, Totals(columns, rows), notes));
    }

    private static Dictionary<string, object?> Row(params (string Key, object? Value)[] cells) => cells.ToDictionary(c => c.Key, c => c.Value);

    /// <summary>The totals row: the columns marked to total, summed.</summary>
    private static Dictionary<string, object?>? Totals(List<ReportColumnDto> columns, List<Dictionary<string, object?>> rows)
    {
        if (!columns.Any(c => c.Total) || rows.Count == 0) return null;
        var t = new Dictionary<string, object?> { [columns[0].Key] = "Total" };
        foreach (var c in columns.Where(x => x.Total)) t[c.Key] = Math.Round(rows.Sum(r => Convert.ToDecimal(r.GetValueOrDefault(c.Key) ?? 0m, CultureInfo.InvariantCulture)), 2);
        return t;
    }
}
