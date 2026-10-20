using System.Globalization;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Api.Work;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Domain.Finance;
using Humo.Domain.Maintenance;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Maintenance;

// The shapes match the app's maintenance ports (maintenance-data-sources.ts, job.ts, supplier.ts).
public sealed record PerformanceDto(int JobsCompleted, int OnTimeRate, decimal AvgVariance, int VerifiedRate);
public sealed record SupplierDto(string Id, int Version, string? PartyId, string Name, List<string> Trades, string ContactName, string Phone, string Email, string BankAccount,
    bool BankVerified, int? BbbeeLevel, List<string> SchemeIds, List<SupplierDocument> Documents, PerformanceDto Performance, string Status);
public sealed record SupplierSummaryDto(SupplierDto Supplier, List<SchemeDto> Schemes, string Compliance, int OpenJobs, decimal Spend12m);
public sealed record JobSummaryDto(Job Job, SchemeDto Scheme, UnitDto? Unit, SupplierDto? Supplier, string AssigneeName);
public sealed record SupplierInvoiceDto(string Id, int Version, string Number, string SupplierId, string SchemeId, string? JobId, string Description, decimal Amount, string ReceivedAt,
    string DueAt, decimal? ApprovedAmount, string Status, string? ApprovalWorkItemId, string? BatchId, string? PaidAt);
public sealed record InvoiceViewDto(SupplierInvoiceDto Invoice, SupplierDto Supplier, SchemeDto Scheme, Job? Job, decimal? Variance);
public sealed record SupplierDetailDto(SupplierDto Supplier, List<SchemeDto> Schemes, string Compliance, int OpenJobs, decimal Spend12m, List<JobSummaryDto> Jobs, List<InvoiceViewDto> Invoices);
public sealed record JobDetailDto(Job Job, SchemeDto Scheme, UnitDto? Unit, SupplierDto? Supplier, string AssigneeName, Dictionary<string, SupplierDto> Suppliers, List<SupplierDto> Candidates,
    InvoiceViewDto? Invoice, object? Batch, WorkItemDto? ApprovalItem, WorkItemDto? InvoiceApprovalItem);

/// <summary>
/// Maintenance on the API (slice 3a): jobs from report to invoice, and the agency's suppliers. Approvals land in My work:
/// quotes above the delegated limit go to the trustees; an invoice over the approved quote (or with none) is re-approved.
/// Payment batches follow with payables (3b); budgets aren't on the API yet, so approval cards carry no budget line.
/// </summary>
public sealed class MaintenanceService(HumoDbContext db, TimeProvider clock)
{
    public DateTimeOffset Now => clock.GetUtcNow();
    public string NowText => Now.ToString("O");
    public DateOnly Today => DateOnly.FromDateTime(Now.ToOffset(TimeSpan.FromHours(2)).DateTime);

    public static Job Read(JobRow row) => JsonSerializer.Deserialize<Job>(row.Json, Json.Options)!;

    public static void Write(JobRow row, Job job)
    {
        row.Stage = job.Stage;
        row.Title = job.Title;
        row.Version = job.Version;
        row.SupplierId = Guid.TryParse(job.SupplierId, out var s) ? s : null;
        row.Json = JsonSerializer.Serialize(job, Json.Options);
    }

    public static List<T> List<T>(string json) => JsonSerializer.Deserialize<List<T>>(json, Json.Options) ?? [];

    // ---------------------------------------------------------------- Suppliers

    public async Task<Dictionary<Guid, PerformanceDto>> PerformanceAsync(IReadOnlyCollection<Guid> supplierIds, CancellationToken ct)
    {
        var jobs = (await db.Jobs.Where(j => j.SupplierId != null && supplierIds.Contains(j.SupplierId.Value)).ToListAsync(ct)).Select(r => (r.SupplierId!.Value, Job: Read(r))).ToList();
        var invoices = await db.SupplierInvoices.Where(i => supplierIds.Contains(i.SupplierId) && i.ApprovedAmount != null).ToListAsync(ct);
        return supplierIds.ToDictionary(id => id, id =>
        {
            var done = jobs.Where(j => j.Value == id && j.Job.Completion is not null).Select(j => j.Job).ToList();
            var onTime = done.Count(j => j.WorkOrder is { } w && DateTimeOffset.Parse(j.Completion!.CompletedAt, CultureInfo.InvariantCulture) <= DateTimeOffset.Parse(w.ScheduledFor, CultureInfo.InvariantCulture).AddDays(1));
            var verified = done.Where(j => j.Verification is not null).ToList();
            var firstTime = verified.Count(j => j.Verification!.Outcome == "fixed" && !j.Events.Any(e => e.Text.StartsWith("Reported as NOT fixed", StringComparison.Ordinal)));
            var variances = invoices.Where(i => i.SupplierId == id && i.ApprovedAmount > 0).Select(i => (i.Amount - i.ApprovedAmount!.Value) / i.ApprovedAmount.Value * 100).ToList();
            return new PerformanceDto(done.Count, done.Count == 0 ? 0 : (int)Math.Round(onTime * 100.0 / done.Count), variances.Count == 0 ? 0 : Math.Round(variances.Average(), 1),
                verified.Count == 0 ? 0 : (int)Math.Round(firstTime * 100.0 / verified.Count));
        });
    }

    public static SupplierDto ToDto(SupplierRow s, PerformanceDto? p) => new(s.Id.ToString(), s.Version, s.PartyId, s.Name, List<string>(s.Trades), s.ContactName, s.Phone, s.Email,
        s.BankAccount, s.BankVerified, s.BbbeeLevel, List<string>(s.SchemeIds), List<SupplierDocument>(s.Documents), p ?? new PerformanceDto(0, 0, 0, 0), s.Status);

    public async Task<List<SupplierSummaryDto>> SummariesAsync(List<SupplierRow> suppliers, CancellationToken ct)
    {
        var ids = suppliers.Select(s => s.Id).ToList();
        var perf = await PerformanceAsync(ids, ct);
        var schemeIds = suppliers.SelectMany(s => List<string>(s.SchemeIds)).Distinct().Select(Guid.Parse).ToList();
        var schemes = (await SchemeEndpoints.ToDtos(await db.Schemes.Where(x => schemeIds.Contains(x.Id)).ToListAsync(ct), db, ct)).ToDictionary(x => x.Id);
        var open = (await db.Jobs.Where(j => j.SupplierId != null && ids.Contains(j.SupplierId.Value) && j.Stage != JobStages.Paid && j.Stage != JobStages.Closed && j.Stage != JobStages.Cancelled)
            .Select(j => j.SupplierId!.Value).ToListAsync(ct)).GroupBy(x => x).ToDictionary(g => g.Key, g => g.Count());
        var yearAgo = Now.AddYears(-1);
        var paid = (await db.SupplierInvoices.Where(i => ids.Contains(i.SupplierId) && i.Status == "paid").ToListAsync(ct)).Where(i => (i.PaidAt ?? i.ReceivedAt) > yearAgo)
            .GroupBy(i => i.SupplierId).ToDictionary(g => g.Key, g => Ledger.Round2(g.Sum(i => i.Amount)));
        return [.. suppliers.Select(s => new SupplierSummaryDto(ToDto(s, perf[s.Id]), [.. List<string>(s.SchemeIds).Where(schemes.ContainsKey).Select(x => schemes[x])],
            JobRules.Compliance(List<SupplierDocument>(s.Documents), Today), open.GetValueOrDefault(s.Id), paid.GetValueOrDefault(s.Id)))];
    }

    /// <summary>Why this supplier can't be asked for quotes or booked on this job, or null.</summary>
    public static string? Block(SupplierRow? s, Guid schemeId) => s switch
    {
        null => "Choose one of your suppliers.",
        { Status: "on-hold" } => $"{s.Name} is on hold: no new work.",
        { Status: "archived" } => $"{s.Name} is archived.",
        _ when !List<string>(s.SchemeIds).Contains(schemeId.ToString()) => $"{s.Name} doesn’t work at this scheme. Add the scheme on their supplier record first.",
        _ => null,
    };

    /// <summary>Their site-work documents that are missing or expired, in words.</summary>
    public List<string> VettingProblems(SupplierRow s) =>
        [.. List<SupplierDocument>(s.Documents).Where(d => d.Type != "B-BBEE certificate").Select(d => (d.Type, Status: JobRules.DocStatus(d, Today)))
            .Where(x => x.Status is "missing" or "expired").Select(x => $"{x.Type} is {x.Status}")];

    // ---------------------------------------------------------------- Jobs

    /// <summary>A new job (from a report, or an Inbox conversation), in the team's queue for triage. Returns its reference.</summary>
    public async Task<string> NewJobAsync(Scheme scheme, Guid? unitId, string? location, string title, string? description, string category, string priority, ReportedBy reportedBy,
        IEnumerable<string>? photoCaptions, string by, CancellationToken ct)
    {
        var refs = await db.Jobs.Where(x => x.OrganisationId == scheme.OrganisationId).Select(x => x.Ref).ToListAsync(ct);
        refs.AddRange(db.Jobs.Local.Where(x => x.OrganisationId == scheme.OrganisationId).Select(x => x.Ref));
        var next = refs.Select(x => int.TryParse(x.AsSpan(3), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0).DefaultIfEmpty(1000).Max() + 1;
        var reference = $"MR-{next}";
        var id = Guid.CreateVersion7();
        var job = new Job
        {
            Id = id.ToString(), Ref = reference, SchemeId = scheme.Id.ToString(), UnitId = unitId?.ToString(), Location = (location ?? "").Trim(), Title = title,
            Description = (description ?? "").Trim(), Category = category, Priority = priority, ReportedBy = reportedBy, ReportedAt = NowText,
            Photos = [.. (photoCaptions ?? []).Where(c => !string.IsNullOrWhiteSpace(c)).Select((c, i) => new JobPhoto { Id = $"{reference}-p{i + 1}", Caption = c.Trim(), TakenAt = NowText, By = reportedBy.Name, Stage = "report" })],
            BudgetCategory = $"Maintenance — {category.ToLowerInvariant()}",
        };
        JobRules.Log(job, "stage", $"Reported by {reportedBy.Name}{(reportedBy.Role != "staff" ? $" ({reportedBy.Role})" : "")}", by, NowText);
        var row = new JobRow
        {
            Id = id, OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, Ref = reference, UnitId = unitId, ReportedAt = Now,
            ReportedByPersonId = Guid.TryParse(reportedBy.PersonId, out var rp) ? rp : null,
        };
        Write(row, job);
        db.Jobs.Add(row);
        var unit = unitId is { } x ? await db.Units.FirstOrDefaultAsync(y => y.Id == x, ct) : null;
        db.WorkItems.Add(new WorkItemRow
        {
            Id = Guid.CreateVersion7(), OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, Ref = reference, Kind = "task", Type = "maintenance-triage", Title = $"New: {title}",
            Detail = $"{(unit is null ? job.Location : $"Unit {unit.Number}")}{(reportedBy.Role != "staff" ? $" · {reportedBy.Name}" : "")}: {job.Description}",
            CreatedAt = Now, DueAt = Now.AddHours(priority == "urgent" ? 4 : 24), Route = $"/maintenance/{reference}", SourceId = id,
        });
        return reference;
    }

    public async Task<List<JobSummaryDto>> JobSummariesAsync(List<JobRow> rows, CancellationToken ct)
    {
        if (rows.Count == 0) return [];
        var jobs = rows.Select(Read).ToList();
        var schemeIds = rows.Select(r => r.SchemeId).Distinct().ToList();
        var schemes = (await SchemeEndpoints.ToDtos(await db.Schemes.Where(s => schemeIds.Contains(s.Id)).ToListAsync(ct), db, ct)).ToDictionary(s => s.Id);
        var unitIds = rows.Where(r => r.UnitId != null).Select(r => r.UnitId!.Value).ToList();
        var units = await db.Units.Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id.ToString(), ct);
        var supplierIds = rows.Where(r => r.SupplierId != null).Select(r => r.SupplierId!.Value).Distinct().ToList();
        var suppliers = await db.Suppliers.Where(s => supplierIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id.ToString(), ct);
        var names = await NamesAsync(jobs.Select(j => j.AssigneeId), ct);
        return [.. jobs.Select(j => new JobSummaryDto(j, schemes[j.SchemeId], j.UnitId is { } u && units.TryGetValue(u, out var unit) ? PortfolioReads.ToDto(unit) : null,
            j.SupplierId is { } s && suppliers.TryGetValue(s, out var sup) ? ToDto(sup, null) : null, j.AssigneeId is { } a ? names.GetValueOrDefault(a, "Unassigned") : "Unassigned"))];
    }

    public async Task<Dictionary<string, string>> NamesAsync(IEnumerable<string?> ids, CancellationToken ct)
    {
        var keys = ids.Where(x => Guid.TryParse(x, out _)).Select(x => Guid.Parse(x!)).Distinct().ToList();
        return await db.Users.Where(u => keys.Contains(u.Id)).ToDictionaryAsync(u => u.Id.ToString(), u => u.Name, ct);
    }

    public async Task<JobDetailDto> DetailAsync(JobRow row, CancellationToken ct)
    {
        var summary = (await JobSummariesAsync([row], ct))[0];
        var job = summary.Job;
        var quoted = job.Quotes.Select(q => Guid.TryParse(q.SupplierId, out var g) ? g : Guid.Empty).Distinct().ToList();
        var suppliers = await db.Suppliers.Where(s => quoted.Contains(s.Id)).ToListAsync(ct);
        var candidates = (await db.Suppliers.Where(s => s.OrganisationId == row.OrganisationId && s.Status != "archived").ToListAsync(ct))
            .Where(s => List<string>(s.Trades).Contains(job.Category) && List<string>(s.SchemeIds).Contains(job.SchemeId)).ToList();
        var perf = await PerformanceAsync([.. suppliers.Concat(candidates).Select(s => s.Id).Distinct()], ct);
        var invoice = Guid.TryParse(job.InvoiceId, out var invId) ? await db.SupplierInvoices.FirstOrDefaultAsync(i => i.Id == invId, ct) : null;
        var approval = Guid.TryParse(job.Approval?.WorkItemId, out var w) ? await db.WorkItems.FirstOrDefaultAsync(x => x.Id == w, ct) : null;
        var invoiceApproval = invoice?.ApprovalWorkItemId is { } iw ? await db.WorkItems.FirstOrDefaultAsync(x => x.Id == iw, ct) : null;
        return new JobDetailDto(job, summary.Scheme, summary.Unit, summary.Supplier, summary.AssigneeName, suppliers.ToDictionary(s => s.Id.ToString(), s => ToDto(s, perf[s.Id])),
            [.. candidates.Select(s => ToDto(s, perf[s.Id]))], invoice is null ? null : (await InvoiceViewsAsync([invoice], ct))[0], null,
            approval is null ? null : WorkItemEndpoints.ToDto(approval), invoiceApproval is null ? null : WorkItemEndpoints.ToDto(invoiceApproval));
    }

    public static SupplierInvoiceDto ToDto(SupplierInvoiceRow i) => new(i.Id.ToString(), i.Version, i.Number, i.SupplierId.ToString(), i.SchemeId.ToString(), i.JobId?.ToString(), i.Description,
        i.Amount, i.ReceivedAt.ToString("O"), i.DueOn.ToString("yyyy-MM-dd"), i.ApprovedAmount, i.Status, i.ApprovalWorkItemId?.ToString(), i.BatchId?.ToString(), i.PaidAt?.ToString("O"));

    public async Task<List<InvoiceViewDto>> InvoiceViewsAsync(List<SupplierInvoiceRow> invoices, CancellationToken ct)
    {
        var supplierIds = invoices.Select(i => i.SupplierId).Distinct().ToList();
        var suppliers = await db.Suppliers.Where(s => supplierIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, ct);
        var schemeIds = invoices.Select(i => i.SchemeId).Distinct().ToList();
        var schemes = (await SchemeEndpoints.ToDtos(await db.Schemes.Where(s => schemeIds.Contains(s.Id)).ToListAsync(ct), db, ct)).ToDictionary(s => s.Id);
        var jobIds = invoices.Where(i => i.JobId != null).Select(i => i.JobId!.Value).ToList();
        var jobs = (await db.Jobs.Where(j => jobIds.Contains(j.Id)).ToListAsync(ct)).ToDictionary(j => j.Id, Read);
        return [.. invoices.Select(i => new InvoiceViewDto(ToDto(i), ToDto(suppliers[i.SupplierId], null), schemes[i.SchemeId.ToString()],
            i.JobId is { } j && jobs.TryGetValue(j, out var job) ? job : null, i.ApprovedAmount is { } a ? Ledger.Round2(i.Amount - a) : null))];
    }

    public async Task CloseWorkAsync(Guid jobId, string[] types, string by, CancellationToken ct)
    {
        foreach (var w in await db.WorkItems.Where(x => x.SourceId == jobId && types.Contains(x.Type) && x.Status == "open").ToListAsync(ct))
        {
            w.Status = "done";
            w.DecidedBy = by;
            w.DecidedAt = Now;
        }
    }

    /// <summary>Who approves a quote: agency managers up to the delegated limit; trustees (and agency managers) above it.</summary>
    public static string[] QuoteApprovers(decimal amount) =>
        amount > JobRules.DelegatedLimit ? [Roles.AgencyAdmin, Roles.PortfolioManager, Roles.Trustee] : [Roles.AgencyAdmin, Roles.PortfolioManager];
}

/// <summary>A quote decided in My work › Approvals: approved, the job moves to its work order; rejected, back to quotes.</summary>
public sealed class QuoteApprovalHandler(HumoDbContext db, MaintenanceService maintenance) : IApprovalHandler
{
    public string Type => "quote-approval";

    public Task<string?> RefuseAsync(WorkItemRow item, Actor actor, bool approve, CancellationToken ct) => Task.FromResult<string?>(null);

    public async Task DecidedAsync(WorkItemRow item, Actor actor, bool approve, string? comment, CancellationToken ct)
    {
        if (item.SourceId is not { } id || await db.Jobs.FirstOrDefaultAsync(j => j.Id == id, ct) is not { } row) return;
        var job = MaintenanceService.Read(row);
        if (job.Approval?.WorkItemId != item.Id.ToString() || job.Stage != JobStages.Approval) return;
        var by = actor.Human.Name;
        var q = job.Quotes.FirstOrDefault(x => x.Recommended);
        var supplier = q is null ? null : await db.Suppliers.FirstOrDefaultAsync(s => s.Id == Guid.Parse(q.SupplierId), ct);
        job.Approval = new JobApproval { Status = approve ? "approved" : "rejected", WorkItemId = job.Approval.WorkItemId, DecidedBy = by, DecidedAt = maintenance.NowText, Comment = comment };
        if (approve)
        {
            job.SupplierId = q?.SupplierId;
            job.Stage = JobStages.Approved;
            JobRules.Log(job, "approval", $"Approved by {by}: {supplier?.Name}, {BillingRules.Rand(q?.Amount ?? 0)}", by, maintenance.NowText);
        }
        else
        {
            job.Stage = JobStages.Quoting;
            JobRules.Log(job, "approval", $"Rejected by {by}{(comment is null ? "" : $": “{comment}”")}", by, maintenance.NowText);
        }
        job.Version++;
        MaintenanceService.Write(row, job);
    }
}

/// <summary>A supplier invoice over the approved quote (or with none), decided in My work: approved, it's ready to pay.</summary>
public sealed class InvoiceApprovalHandler(HumoDbContext db, MaintenanceService maintenance) : IApprovalHandler
{
    public string Type => "invoice-approval";

    public Task<string?> RefuseAsync(WorkItemRow item, Actor actor, bool approve, CancellationToken ct) => Task.FromResult<string?>(null);

    public async Task DecidedAsync(WorkItemRow item, Actor actor, bool approve, string? comment, CancellationToken ct)
    {
        if (await db.SupplierInvoices.FirstOrDefaultAsync(i => i.ApprovalWorkItemId == item.Id, ct) is not { Status: "awaiting-approval" } inv) return;
        inv.Status = approve ? "approved" : "rejected";
        inv.Version++;
        if (inv.JobId is { } jobId && await db.Jobs.FirstOrDefaultAsync(j => j.Id == jobId, ct) is { } row)
        {
            var job = MaintenanceService.Read(row);
            JobRules.Log(job, "invoice", $"Invoice {inv.Number} {(approve ? "approved" : "rejected")} by {actor.Human.Name}{(comment is null ? "" : $": “{comment}”")}", actor.Human.Name, maintenance.NowText);
            job.Version++;
            MaintenanceService.Write(row, job);
        }
    }
}
