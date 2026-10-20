using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Api.Settings;
using Humo.Api.Work;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Domain.Finance;
using Humo.Domain.Maintenance;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Maintenance;

public sealed record NewJobRequest(string? SchemeId, string? UnitId, string? Location, string? Title, string? Description, string? Category, string? Priority, ReportedBy? ReportedBy,
    List<string>? PhotoCaptions);
public sealed record JobActionRequest(JobAction? Action, int? ExpectedVersion);
public sealed record SupplierRequest(string? Name, List<string>? Trades, string? ContactName, string? Phone, string? Email, List<string>? SchemeIds, int? BbbeeLevel, int? ExpectedVersion);
public sealed record SupplierStatusRequest(string? Status, string? Reason, int? ExpectedVersion);
public sealed record DocumentRequest(string? Type);

/// <summary>
/// Jobs (Maintenance.View to read, Maintenance.Log to report, Maintenance.Manage to run them; residents report and confirm their own
/// with Resident.Requests) and suppliers (Suppliers.View / Suppliers.Manage), within the person's schemes.
/// </summary>
public static partial class MaintenanceEndpoints
{
    private static readonly Dictionary<string, string> Verbs = new()
    {
        ["triage"] = "Triaged", ["request-quotes"] = "Requested quotes for", ["record-quote"] = "Recorded a quote on", ["send-for-approval"] = "Sent for approval:",
        ["approve-within-delegation"] = "Approved within delegated authority:", ["issue-work-order"] = "Issued a work order for", ["start-work"] = "Started work on",
        ["complete"] = "Completed", ["verify"] = "Confirmed the outcome of", ["capture-invoice"] = "Captured the invoice for", ["close"] = "Closed", ["comment"] = "Commented on",
        ["cancel"] = "Cancelled",
    };

    public static void MapMaintenance(this IEndpointRouteBuilder api)
    {
        var j = api.MapGroup("/jobs").RequireAuthorization();
        j.MapGet("", List);
        j.MapGet("/search", Search);
        j.MapGet("/{reference}", Get);
        j.MapPost("", Create);
        j.MapPost("/{reference}/actions", Act);
        api.MapGet("/me/jobs", Mine).RequireAuthorization();
        var s = api.MapGroup("/suppliers").RequireAuthorization();
        s.MapGet("", Suppliers);
        s.MapGet("/search", SearchSuppliers);
        s.MapGet("/{id:guid}", Supplier);
        s.MapPost("", CreateSupplier);
        s.MapPut("/{id:guid}", UpdateSupplier);
        s.MapPost("/{id:guid}/status", SetStatus);
        s.MapPost("/{id:guid}/documents/request", RequestDocument);
        s.MapPost("/{id:guid}/bank-details", ChangeBankDetails);
        s.MapPost("/link-party", LinkParty);
    }

    private static async Task<List<Guid>> SchemesAsync(Actor actor, HumoDbContext db, string[]? schemeIds, CancellationToken ct)
    {
        var wanted = (schemeIds ?? []).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).ToHashSet();
        return [.. (await SchemeEndpoints.Visible(actor, db).Select(x => x.Id).ToListAsync(ct)).Where(wanted.Contains)];
    }

    private static async Task<JobRow?> VisibleJobAsync(Actor actor, HumoDbContext db, string reference, CancellationToken ct)
    {
        if (actor.OrganisationId is not { } org) return null;
        var row = await db.Jobs.FirstOrDefaultAsync(x => x.OrganisationId == org && x.Ref == reference, ct);
        return row is not null && await SchemeEndpoints.Visible(actor, db).AnyAsync(x => x.Id == row.SchemeId, ct) ? row : null;
    }

    // ---------------------------------------------------------------- Jobs: reads

    private static async Task<IResult> List(string[]? schemeIds, int? page, int? pageSize, CurrentActor current, HumoDbContext db, MaintenanceService m, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Maintenance.View")) return Results.Ok(PortfolioReads.Page(new List<JobSummaryDto>(), page, pageSize));
        var ids = await SchemesAsync(actor, db, schemeIds, ct);
        var rows = (await db.Jobs.Where(x => ids.Contains(x.SchemeId)).ToListAsync(ct)).OrderByDescending(x => x.ReportedAt).ToList();
        return Results.Ok(PortfolioReads.Page(await m.JobSummariesAsync(rows, ct), page, pageSize));
    }

    private static async Task<IResult> Search(string? q, string[]? schemeIds, int? limit, CurrentActor current, HumoDbContext db, MaintenanceService m, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var needle = (q ?? "").Trim().ToLowerInvariant();
        if (!actor.Can("Maintenance.View") || needle.Length < 2) return Results.Ok(Array.Empty<JobSummaryDto>());
        var ids = await SchemesAsync(actor, db, schemeIds, ct);
        var rows = (await db.Jobs.Where(x => ids.Contains(x.SchemeId)).ToListAsync(ct))
            .Where(x => $"{x.Ref} {x.Title}".ToLowerInvariant().Contains(needle) || MaintenanceService.Read(x).Location.ToLowerInvariant().Contains(needle))
            .OrderByDescending(x => x.ReportedAt).Take(Math.Clamp(limit ?? 5, 1, 20)).ToList();
        return Results.Ok(await m.JobSummariesAsync(rows, ct));
    }

    private static async Task<IResult> Get(string reference, CurrentActor current, HumoDbContext db, MaintenanceService m, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Maintenance.View") || await VisibleJobAsync(actor, db, reference, ct) is not { } row) return Problems.NotFound();
        return Results.Ok(await m.DetailAsync(row, ct));
    }

    /// <summary>A resident's own requests: the ones they reported, and their unit's.</summary>
    private static async Task<IResult> Mine(CurrentActor current, HumoDbContext db, MaintenanceService m, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Resident.Requests") || !Guid.TryParse(actor.User.PersonId, out var personId)) return Results.Ok(Array.Empty<JobSummaryDto>());
        var units = await db.Relationships.Where(r => r.PersonId == personId && r.UnitId != null && (r.Type == "owner" || r.Type == "tenant")).Select(r => r.UnitId!.Value).ToListAsync(ct);
        var rows = (await db.Jobs.Where(x => x.ReportedByPersonId == personId || (x.UnitId != null && units.Contains(x.UnitId.Value))).ToListAsync(ct))
            .OrderByDescending(x => x.ReportedAt).ToList();
        return Results.Ok(await m.JobSummariesAsync(rows, ct));
    }

    // ---------------------------------------------------------------- Jobs: commands

    /// <summary>Staff log a job (for common property, a unit, or on someone's behalf); residents report their own. It lands in the team's queue for triage.</summary>
    private static async Task<IResult> Create(NewJobRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, MaintenanceService m, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var resident = me.Assignment.Role is Roles.Owner or Roles.Tenant;
        var schemeId = Guid.TryParse(resident ? me.Assignment.SchemeIds.FirstOrDefault() : body.SchemeId, out var sid) ? sid : Guid.Empty;
        var scheme = await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(x => x.Id == schemeId, ct);
        var person = Guid.TryParse(me.User.PersonId, out var pid) ? await db.People.FirstOrDefaultAsync(p => p.Id == pid, ct) : null;
        Guid? unitId = Guid.TryParse(body.UnitId, out var u) ? u : null;
        if (resident && unitId is null && person is not null)
            unitId = await db.Relationships.Where(r => r.PersonId == person.Id && r.SchemeId == schemeId && r.UnitId != null && (r.Type == "owner" || r.Type == "tenant")).Select(r => r.UnitId).FirstOrDefaultAsync(ct);
        var unitOk = unitId is null || await db.Units.AnyAsync(x => x.Id == unitId && x.SchemeId == schemeId, ct);
        var title = (body.Title ?? "").Trim();
        var category = JobRules.Trades.Contains(body.Category) ? body.Category! : "Building";
        var priority = JobRules.Priorities.Contains(body.Priority) ? body.Priority! : "normal";
        var reportedBy = resident
            ? new ReportedBy(person?.DisplayName ?? me.User.Name, me.Assignment.Role, person?.Id.ToString())
            : body.ReportedBy is { Role: "owner" or "tenant" or "trustee" } r && !string.IsNullOrWhiteSpace(r.Name) ? r with { Name = r.Name.Trim() } : new ReportedBy(me.Human.Name, "staff");

        return await commands.RunAsync(new CommandSpec("Logged a maintenance request", resident ? "Resident.Requests" : "Maintenance.Log")
        {
            Resource = "Job",
            SchemeId = scheme?.Id,
            Feature = "maintenance-basic",
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (scheme is null) e["schemeId"] = "Choose the scheme.";
                if (title.Length < 4) e["title"] = "Use a few words, e.g. “Geyser leaking”.";
                else if (title.Length > 80) e["title"] = "Keep the title under 80 characters; put the detail in the description.";
                if (unitId is null && string.IsNullOrWhiteSpace(body.Location)) e["location"] = "Say where on the property it is.";
                if (!unitOk) e["unit"] = "That unit isn’t in this scheme.";
                return e;
            },
        }, async actor =>
        {
            var reference = await m.NewJobAsync(scheme!, unitId, body.Location, title, body.Description, category, priority, reportedBy, body.PhotoCaptions, actor.Human.Name, ct);
            return Results.Created($"/api/jobs/{reference}", new { id = reference });
        }, ct);
    }

    private static async Task<IResult> Act(string reference, JobActionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, MaintenanceService m, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var a = body.Action ?? new JobAction("");
        var residentVerify = a.Type == "verify" && a.OnBehalf != true;
        if (!(me.Can("Maintenance.View") || residentVerify) || await VisibleJobAsync(me, db, reference, ct) is not { } row) return Problems.NotFound();
        var job = MaintenanceService.Read(row);
        // Residents only ever confirm their own requests.
        var ownRequest = Guid.TryParse(me.User.PersonId, out var personId) && (job.ReportedBy.PersonId == personId.ToString()
            || (row.UnitId is { } unit && await db.Relationships.AnyAsync(r => r.PersonId == personId && r.UnitId == unit, ct)));
        if (residentVerify && !me.Can("Maintenance.Manage") && !ownRequest) return Problems.NotFound();

        var suppliers = await db.Suppliers.Where(s => s.OrganisationId == row.OrganisationId).ToDictionaryAsync(s => s.Id.ToString(), ct);
        var chosen = job.SupplierId is { } sid ? suppliers.GetValueOrDefault(sid) : null;
        var problems = a.Type == "issue-work-order" && chosen is not null ? m.VettingProblems(chosen) : [];
        var assigneeOk = a.Type != "triage" || (Guid.TryParse(a.AssigneeId, out var who) && await db.RoleAssignments.AnyAsync(r => r.UserId == who && r.OrganisationId == row.OrganisationId && r.Status == AssignmentStatuses.Active, ct));
        var duplicateInvoice = a.Type == "capture-invoice" && chosen is not null && await db.SupplierInvoices.AnyAsync(i => i.SupplierId == chosen.Id && i.Number == (a.InvoiceNo ?? "").Trim(), ct);
        var permission = residentVerify && !me.Can("Maintenance.Manage") ? "Resident.Requests" : "Maintenance.Manage";
        var amount = a.Type is "record-quote" or "capture-invoice" ? $" ({BillingRules.Rand(a.Amount ?? 0)})" : "";

        return await commands.RunAsync(new CommandSpec($"{Verbs.GetValueOrDefault(a.Type, a.Type)} {reference}: {job.Title}{amount}", permission)
        {
            Resource = "Job",
            ResourceId = reference,
            SchemeId = row.SchemeId,
            Feature = JobRules.Advanced.Contains(a.Type) && !residentVerify ? "maintenance-advanced" : "maintenance-basic",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = job.Version,
            Validate = () =>
            {
                var e = JobRules.Check(job, a, s => MaintenanceService.Block(suppliers.GetValueOrDefault(s), row.SchemeId), problems, m.Today);
                if (e.Count == 0 && !assigneeOk) e["assigneeId"] = "Choose someone in your team.";
                if (e.Count == 0 && duplicateInvoice) e["invoiceNo"] = "That invoice from this supplier is already captured.";
                return e;
            },
        }, async actor =>
        {
            await ApplyAsync(row, job, a, actor, suppliers, problems, db, m, ct);
            job.Version++;
            MaintenanceService.Write(row, job);
            return Results.NoContent();
        }, ct);
    }

    private static async Task ApplyAsync(JobRow row, Job job, JobAction a, Actor actor, Dictionary<string, SupplierRow> suppliers, List<string> problems, HumoDbContext db,
        MaintenanceService m, CancellationToken ct)
    {
        var by = actor.Human.Name;
        var now = m.NowText;
        string Name(string? id) => id is not null && suppliers.TryGetValue(id, out var s) ? s.Name : "the supplier";
        var quote = a.QuoteId is null ? null : job.Quotes.First(q => q.Id == a.QuoteId);
        switch (a.Type)
        {
            case "triage":
                job.AssigneeId = a.AssigneeId;
                job.Priority = a.Priority!;
                job.Category = a.Category!;
                var assignee = await db.Users.Where(u => u.Id == Guid.Parse(a.AssigneeId!)).Select(u => u.Name).FirstAsync(ct);
                JobRules.Log(job, "stage", $"Triaged: {a.Priority} priority, {a.Category}, assigned to {assignee}", by, now);
                await m.CloseWorkAsync(row.Id, ["maintenance-triage"], by, ct);
                break;
            case "request-quotes":
                foreach (var supplierId in a.SupplierIds!.Distinct())
                {
                    if (job.Quotes.Any(q => q.SupplierId == supplierId)) continue;
                    job.Quotes.Add(new JobQuote { Id = $"{job.Ref}-q{job.Quotes.Count + 1}", SupplierId = supplierId, Status = "requested" });
                    JobRules.Log(job, "quote", $"Quote requested from {Name(supplierId)}", by, now);
                }
                job.Stage = JobStages.Quoting;
                await m.CloseWorkAsync(row.Id, ["maintenance-triage"], by, ct);
                break;
            case "record-quote":
                quote!.Amount = Ledger.Round2(a.Amount!.Value);
                quote.Status = "received";
                quote.ReceivedAt = now;
                quote.ValidUntil = m.Now.AddDays(30).ToString("O");
                quote.GuaranteeMonths = a.GuaranteeMonths;
                quote.Notes = string.IsNullOrWhiteSpace(a.Notes) ? null : a.Notes.Trim();
                JobRules.Log(job, "quote", $"Quote received from {Name(quote.SupplierId)}: {BillingRules.Rand(quote.Amount)}", by, now);
                break;
            case "approve-within-delegation":
                job.Quotes.ForEach(q => q.Recommended = q.Id == quote!.Id);
                job.SupplierId = quote!.SupplierId;
                job.Approval = new JobApproval { Status = "approved", DecidedBy = by, DecidedAt = now, WithinDelegation = true };
                job.Stage = JobStages.Approved;
                JobRules.Log(job, "approval", $"Approved {Name(quote.SupplierId)} at {BillingRules.Rand(quote.Amount)} within delegated authority (up to {BillingRules.Rand(JobRules.DelegatedLimit)})", by, now);
                break;
            case "send-for-approval":
            {
                job.Quotes.ForEach(q => q.Recommended = q.Id == quote!.Id);
                var received = job.Quotes.Count(q => q.Status == "received");
                var item = new WorkItemRow
                {
                    Id = Guid.CreateVersion7(), OrganisationId = row.OrganisationId, SchemeId = row.SchemeId, Ref = job.Ref, Kind = "approval", Type = "quote-approval", Title = job.Title,
                    Detail = $"{received} {(received == 1 ? "quote" : "quotes")} compared. Recommended: {Name(quote!.SupplierId)}{(quote.GuaranteeMonths is { } g ? $" ({g}-month guarantee)" : "")}.",
                    Amount = quote.Amount, CreatedAt = m.Now, DueAt = m.Now.AddDays(3), ApproverRoles = WorkItemEndpoints.Roles(MaintenanceService.QuoteApprovers(quote.Amount)),
                    Evidence = JsonSerializer.Serialize(new[] { $"{received} quotes compared", $"Recommendation by {by}" }.Concat(job.Photos.Count > 0 ? [$"Photos ({job.Photos.Count})"] : [])),
                    Route = $"/maintenance/{job.Ref}", SourceId = row.Id,
                };
                db.WorkItems.Add(item);
                job.Approval = new JobApproval { Status = "pending", WorkItemId = item.Id.ToString() };
                job.Stage = JobStages.Approval;
                JobRules.Log(job, "approval", $"Sent for {(quote.Amount > JobRules.DelegatedLimit ? "trustee" : "agency")} approval: {Name(quote.SupplierId)}, {BillingRules.Rand(quote.Amount)}", by, now);
                break;
            }
            case "issue-work-order":
            {
                var when = DateTimeOffset.Parse(a.ScheduledFor!, CultureInfo.InvariantCulture);
                job.WorkOrder = new WorkOrder(now, when.ToString("O"), string.IsNullOrWhiteSpace(a.AccessNotes) ? null : a.AccessNotes.Trim());
                job.Stage = JobStages.Scheduled;
                job.DueAt = when.AddHours(8).ToString("O");
                JobRules.Log(job, "stage", $"Work order issued to {Name(job.SupplierId)} for {when.ToOffset(TimeSpan.FromHours(2)):ddd d MMM}", by, now);
                if (problems.Count > 0) JobRules.Log(job, "comment", $"Issued despite vetting: {string.Join("; ", problems)}. {by} will get the documents.", by, now);
                if (job.ReportedBy.Role != "staff") JobRules.Log(job, "message", $"{job.ReportedBy.Name} notified of the booking", "Humo PM", now);
                break;
            }
            case "start-work":
                job.Stage = JobStages.InProgress;
                JobRules.Log(job, "stage", "Supplier on site — work in progress", by, now);
                break;
            case "complete":
                job.Completion = new JobCompletion(now, a.Notes!.Trim());
                job.Photos.Add(new JobPhoto { Id = $"{job.Ref}-c{job.Photos.Count + 1}", Caption = "Completed work", TakenAt = now, By = job.SupplierId is null ? by : Name(job.SupplierId), Stage = "completion" });
                job.Stage = JobStages.Completed;
                JobRules.Log(job, "stage", $"Completed: {job.Completion.Notes}", by, now);
                if (job.ReportedBy.Role != "staff") JobRules.Log(job, "message", $"Asked {job.ReportedBy.Name} to confirm it’s fixed", "Humo PM", now);
                break;
            case "verify":
            {
                var who = a.OnBehalf == true ? $"{by} (on behalf of resident)" : by;
                job.Verification = new JobVerification(now, who, a.Outcome!, string.IsNullOrWhiteSpace(a.Comment) ? null : a.Comment.Trim());
                if (a.Outcome == "fixed")
                {
                    job.Stage = JobStages.Verified;
                    JobRules.Log(job, "stage", $"Verified as fixed by {who}", by, now);
                }
                else
                {
                    job.Stage = job.WorkOrder is null ? JobStages.Reported : JobStages.Scheduled;
                    job.Completion = null;
                    JobRules.Log(job, "stage", $"Reported as NOT fixed{(job.Verification.Comment is { } c ? $": “{c}”" : "")} — supplier to return", by, now);
                }
                break;
            }
            case "capture-invoice":
            {
                var approved = job.Quotes.FirstOrDefault(q => q.Recommended)?.Amount;
                var invoiceAmount = Ledger.Round2(a.Amount!.Value);
                decimal? variance = approved is { } q ? Ledger.Round2(invoiceAmount - q) : null;
                var needsApproval = variance is null || variance > 0;
                var supplier = suppliers[job.SupplierId!];
                var invoice = new SupplierInvoiceRow
                {
                    Id = Guid.CreateVersion7(), OrganisationId = row.OrganisationId, SchemeId = row.SchemeId, SupplierId = supplier.Id, JobId = row.Id, Number = a.InvoiceNo!.Trim(),
                    Description = job.Title, Amount = invoiceAmount, ApprovedAmount = approved, ReceivedAt = m.Now, DueOn = m.Today.AddDays(30), Status = needsApproval ? "awaiting-approval" : "approved",
                };
                if (needsApproval)
                {
                    var item = new WorkItemRow
                    {
                        Id = Guid.CreateVersion7(), OrganisationId = row.OrganisationId, SchemeId = row.SchemeId, Ref = invoice.Number, Kind = "approval", Type = "invoice-approval",
                        Title = $"{supplier.Name} — {job.Title}",
                        Detail = variance is { } v ? $"Invoice is {BillingRules.Rand(v)} above the approved quote. Re-approval needed." : "No approved quote on file.",
                        Amount = invoiceAmount, CreatedAt = m.Now, DueAt = m.Now.AddDays(3), ApproverRoles = WorkItemEndpoints.Roles(Roles.AgencyAdmin, Roles.PortfolioManager, Roles.Trustee),
                        Evidence = JsonSerializer.Serialize(new[] { approved is { } x ? $"Approved quote {BillingRules.Rand(x)}" : "No quote", variance is { } y ? $"Variance: + {BillingRules.Rand(y)}" : "Matches quote" }),
                        Route = $"/maintenance/{job.Ref}", SourceId = row.Id,
                    };
                    db.WorkItems.Add(item);
                    invoice.ApprovalWorkItemId = item.Id;
                }
                db.SupplierInvoices.Add(invoice);
                job.InvoiceId = invoice.Id.ToString();
                job.Stage = JobStages.Invoiced;
                JobRules.Log(job, "invoice", needsApproval
                    ? $"Invoice {invoice.Number} captured: {BillingRules.Rand(invoiceAmount)}{(variance is { } over ? $" — {BillingRules.Rand(over)} over the approved quote" : " — no approved quote")}, sent for re-approval"
                    : $"Invoice {invoice.Number} captured: {BillingRules.Rand(invoiceAmount)} — matches the approved quote, ready to pay", by, now);
                break;
            }
            case "close":
                job.Stage = JobStages.Closed;
                JobRules.Log(job, "stage", "Job closed", by, now);
                break;
            case "comment":
                JobRules.Log(job, "comment", a.Text!.Trim(), by, now);
                break;
            case "cancel":
                job.Stage = JobStages.Cancelled;
                JobRules.Log(job, "stage", $"Cancelled: {a.Reason!.Trim()}", by, now);
                await m.CloseWorkAsync(row.Id, ["maintenance-triage", "quote-approval"], by, ct);
                break;
        }
    }

    // ---------------------------------------------------------------- Suppliers

    private static async Task<IQueryable<SupplierRow>?> SuppliersOf(Actor actor, CancellationToken ct, HumoDbContext db)
    {
        await Task.CompletedTask;
        return actor.OrganisationId is { } org && actor.Can("Suppliers.View") ? db.Suppliers.Where(s => s.OrganisationId == org) : null;
    }

    private static async Task<IResult> Suppliers(string[]? schemeIds, CurrentActor current, HumoDbContext db, MaintenanceService m, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await SuppliersOf(actor, ct, db) is not { } all) return Results.Ok(Array.Empty<SupplierSummaryDto>());
        var ids = (await SchemesAsync(actor, db, schemeIds, ct)).Select(x => x.ToString()).ToHashSet();
        var rows = (await all.ToListAsync(ct)).Where(s => MaintenanceService.List<string>(s.SchemeIds).Any(ids.Contains)).OrderBy(s => s.Name).ToList();
        return Results.Ok(await m.SummariesAsync(rows, ct));
    }

    private static async Task<IResult> SearchSuppliers(string? q, int? limit, CurrentActor current, HumoDbContext db, MaintenanceService m, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var needle = (q ?? "").Trim().ToLowerInvariant();
        if (await SuppliersOf(actor, ct, db) is not { } all || needle.Length < 2) return Results.Ok(Array.Empty<SupplierSummaryDto>());
        var rows = (await all.ToListAsync(ct)).Where(s => $"{s.Name} {string.Join(' ', MaintenanceService.List<string>(s.Trades))} {s.ContactName}".ToLowerInvariant().Contains(needle))
            .Take(Math.Clamp(limit ?? 5, 1, 20)).ToList();
        return Results.Ok(await m.SummariesAsync(rows, ct));
    }

    private static async Task<IResult> Supplier(Guid id, CurrentActor current, HumoDbContext db, MaintenanceService m, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await SuppliersOf(actor, ct, db) is not { } all || await all.FirstOrDefaultAsync(s => s.Id == id, ct) is not { } row) return Problems.NotFound();
        var summary = (await m.SummariesAsync([row], ct))[0];
        var visible = await SchemeEndpoints.Visible(actor, db).Select(x => x.Id).ToListAsync(ct);
        var jobs = (await db.Jobs.Where(j => visible.Contains(j.SchemeId)).ToListAsync(ct))
            .Where(j => j.SupplierId == id || MaintenanceService.Read(j).Quotes.Any(q => q.SupplierId == id.ToString())).OrderByDescending(j => j.ReportedAt).ToList();
        var invoices = (await db.SupplierInvoices.Where(i => i.SupplierId == id && visible.Contains(i.SchemeId)).ToListAsync(ct)).OrderByDescending(i => i.ReceivedAt).ToList();
        return Results.Ok(new SupplierDetailDto(summary.Supplier, summary.Schemes, summary.Compliance, summary.OpenJobs, summary.Spend12m, await m.JobSummariesAsync(jobs, ct),
            await m.InvoiceViewsAsync(invoices, ct)));
    }

    private static Dictionary<string, string> CheckSupplier(SupplierRequest d, IEnumerable<SupplierRow> others, IReadOnlyCollection<Guid> schemes)
    {
        var e = new Dictionary<string, string>();
        var name = (d.Name ?? "").Trim();
        if (name.Length < 2) e["name"] = "Enter the business name.";
        else if (others.Any(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase))) e["name"] = "You already have a supplier with this name.";
        if (d.Trades is not { Count: > 0 } || d.Trades.Any(t => !JobRules.Trades.Contains(t))) e["trades"] = "Choose what they do.";
        if ((d.ContactName ?? "").Trim().Length < 2) e["contactName"] = "Who do you deal with there?";
        if (!Phone().IsMatch((d.Phone ?? "").Trim())) e["phone"] = "Enter a phone number, e.g. 082 555 0142.";
        if (!SettingsEndpoints.IsEmail(d.Email)) e["email"] = "Enter an email address for work orders and remittances.";
        if (d.SchemeIds is not { Count: > 0 }) e["schemeIds"] = "Choose at least one scheme they work at.";
        else if (d.SchemeIds.Any(x => !Guid.TryParse(x, out var g) || !schemes.Contains(g))) e["schemeIds"] = "Choose from your schemes.";
        if (d.BbbeeLevel is < 1 or > 8) e["bbbeeLevel"] = "B-BBEE levels run from 1 to 8.";
        return e;
    }

    [GeneratedRegex(@"^[+\d][\d\s]{8,}$")]
    private static partial Regex Phone();

    private static void Apply(SupplierRow row, SupplierRequest d)
    {
        row.Name = d.Name!.Trim();
        row.Trades = JsonSerializer.Serialize(d.Trades!.Distinct(), Json.Options);
        row.ContactName = d.ContactName!.Trim();
        row.Phone = d.Phone!.Trim();
        row.Email = d.Email!.Trim();
        row.SchemeIds = JsonSerializer.Serialize(d.SchemeIds!.Distinct(), Json.Options);
        row.BbbeeLevel = d.BbbeeLevel;
    }

    /// <summary>A supplier the agency vets itself: every vetting document starts as missing.</summary>
    private static async Task<IResult> CreateSupplier(SupplierRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org } me) return Problems.NotFound();
        var others = await db.Suppliers.Where(s => s.OrganisationId == org).ToListAsync(ct);
        var schemes = await SchemeEndpoints.Visible(me, db).Select(x => x.Id).ToListAsync(ct);
        return await commands.RunAsync(new CommandSpec($"Added supplier {body.Name?.Trim()}", "Suppliers.Manage")
        {
            Resource = "Supplier",
            Feature = "suppliers",
            Validate = () => CheckSupplier(body, others, schemes),
        }, actor =>
        {
            var row = new SupplierRow
            {
                Id = Guid.CreateVersion7(), OrganisationId = org, CreatedAt = clock.GetUtcNow(),
                Documents = JsonSerializer.Serialize(JobRules.VettingDocuments.Select(t => new SupplierDocument(t, null, false)), Json.Options),
            };
            Apply(row, body);
            db.Suppliers.Add(row);
            return Task.FromResult(Results.Created($"/api/suppliers/{row.Id}", new { id = row.Id.ToString() }));
        }, ct);
    }

    private static async Task<IResult> UpdateSupplier(Guid id, SupplierRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org } me) return Problems.NotFound();
        if (await db.Suppliers.FirstOrDefaultAsync(s => s.Id == id && s.OrganisationId == org, ct) is not { } row) return Problems.NotFound();
        var others = await db.Suppliers.Where(s => s.OrganisationId == org && s.Id != id).ToListAsync(ct);
        var schemes = await SchemeEndpoints.Visible(me, db).Select(x => x.Id).ToListAsync(ct);
        return await commands.RunAsync(new CommandSpec($"Updated supplier details for {body.Name?.Trim()}", "Suppliers.Manage")
        {
            Resource = "Supplier",
            ResourceId = id.ToString(),
            Feature = "suppliers",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = row.Version,
            Validate = () => CheckSupplier(body, others, schemes),
        }, _ =>
        {
            Apply(row, body);
            row.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>On hold: no new work orders. Archived: no longer used (kept for history and payments). Active again: restored.</summary>
    private static async Task<IResult> SetStatus(Guid id, SupplierStatusRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org }) return Problems.NotFound();
        if (await db.Suppliers.FirstOrDefaultAsync(s => s.Id == id && s.OrganisationId == org, ct) is not { } row) return Problems.NotFound();
        var openJobs = await db.Jobs.AnyAsync(j => j.SupplierId == id && j.Stage != JobStages.Closed && j.Stage != JobStages.Cancelled && j.Stage != JobStages.Paid, ct);
        var verb = body.Status == "on-hold" ? "Put on hold" : body.Status == "archived" ? "Archived" : row.Status == "archived" ? "Restored" : "Released hold on";
        return await commands.RunAsync(new CommandSpec($"{verb} {row.Name} — {body.Reason?.Trim()}", "Suppliers.Manage")
        {
            Resource = "Supplier",
            ResourceId = id.ToString(),
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = row.Version,
            Validate = () => body.Status is not ("active" or "on-hold" or "archived") ? new() { ["status"] = "Active, on hold or archived." }
                : row.Status == body.Status ? new() { ["status"] = $"It’s already {body.Status.Replace('-', ' ')}." }
                : body.Status == "archived" && openJobs ? new() { ["status"] = "They still have open jobs. Finish or reassign them first." }
                : (body.Reason ?? "").Trim().Length < 5 ? new() { ["reason"] = "Say why, in a few words. It goes in the audit log." } : [],
        }, _ =>
        {
            row.Status = body.Status!;
            row.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>Recorded in the audit log. Receiving the document itself comes with file uploads on the API.</summary>
    private static async Task<IResult> RequestDocument(Guid id, DocumentRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org }) return Problems.NotFound();
        if (await db.Suppliers.FirstOrDefaultAsync(s => s.Id == id && s.OrganisationId == org, ct) is not { } row) return Problems.NotFound();
        return await commands.RunAsync(new CommandSpec($"Requested {body.Type} from {row.Name}", "Suppliers.Manage")
        {
            Resource = "Supplier",
            ResourceId = id.ToString(),
            Validate = () => !JobRules.VettingDocuments.Contains(body.Type) ? new() { ["type"] = "Choose a vetting document." } : [],
        }, _ => Task.FromResult(Results.NoContent()), ct);
    }

    /// <summary>Sensitive: a fresh passkey, and payments to the supplier are held until the new account is verified.</summary>
    private static async Task<IResult> ChangeBankDetails(Guid id, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org }) return Problems.NotFound();
        if (await db.Suppliers.FirstOrDefaultAsync(s => s.Id == id && s.OrganisationId == org, ct) is not { } row) return Problems.NotFound();
        return await commands.RunAsync(new CommandSpec($"Started a bank details change for {row.Name}: payments held until the new account is verified", "Suppliers.ChangeBankDetails")
        {
            Resource = "Supplier",
            ResourceId = id.ToString(),
            Category = "security",
            StepUp = true,
        }, _ =>
        {
            row.BankVerified = false;
            row.BankAccount = "Change pending verification";
            row.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> LinkParty(CurrentActor current, CancellationToken ct) =>
        await current.GetAsync(ct) is null ? Results.Unauthorized()
            : Problems.Validation(new() { ["partyId"] = "Humo Contractor businesses aren’t on Humo’s API yet: add the supplier yourself." });
}
