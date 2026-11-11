using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Files;
using Humo.Domain.Commercial;
using Humo.Domain.Finance;
using Humo.Domain.Maintenance;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Files;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Maintenance;

public sealed record SupplierLinkPhotoDto(string Id, string Caption);
public sealed record SupplierQuoteDto(string Status, decimal? Amount, int? GuaranteeMonths, string? Notes, string? RejectedReason, bool HasFile);
public sealed record SupplierWorkOrderDto(string ScheduledFor, string? AccessNotes, string? ConfirmedAt, string? AskedFor);
/// <param name="Open">The supplier can still act through it; otherwise <paramref name="ClosedReason"/> says why.</param>
public sealed record SupplierLinkViewDto(string Kind, bool Open, string? ClosedReason, string Supplier, string Agency, string Scheme, string Area, string? Where,
    string JobRef, string Title, string Description, string Category, List<SupplierLinkPhotoDto> Photos, SupplierQuoteDto? Quote, SupplierWorkOrderDto? WorkOrder);
public sealed record SupplierDeclineRequest(string? Reason);
public sealed record SupplierRescheduleRequest(string? Date, string? Note);

/// <summary>
/// D38: quote requests and work orders reach the supplier by email, with a link to a page that needs no sign-in. The link
/// is a random code in the email only; the database keeps its SHA-256 fingerprint, so a copy of the database opens nothing.
/// One link per supplier per request; a newer one replaces it. A quote link works while quotes are being collected and that
/// quote isn't decided; a work order link until 30 days after the work is done.
/// </summary>
public sealed class SupplierLinks(HumoDbContext db, IEmailSender email, IOptions<AppOptions> app, TimeProvider clock, ILogger<SupplierLinks> logger)
{
    public const string Quote = "quote", WorkOrder = "work-order";
    public static readonly TimeSpan WorkOrderAfterDone = TimeSpan.FromDays(30);

    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public string Url(string kind, string token) => $"{app.Value.PublicUrl.TrimEnd('/')}/supplier/{(kind == Quote ? "q" : "w")}/{token}";

    /// <summary>A new link (the caller saves). Earlier links for the same quote or work order stop working.</summary>
    public async Task<string> IssueAsync(JobRow row, string supplierId, string kind, string? quoteId, IEnumerable<string>? excludedPhotos, CancellationToken ct)
    {
        var supplier = Guid.Parse(supplierId);
        foreach (var old in await db.SupplierLinks.Where(l => l.JobId == row.Id && l.SupplierId == supplier && l.Kind == kind && l.QuoteId == quoteId && l.RevokedAt == null).ToListAsync(ct))
            old.RevokedAt = clock.GetUtcNow();
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        db.SupplierLinks.Add(new SupplierLink
        {
            Id = Guid.CreateVersion7(), OrganisationId = row.OrganisationId, SchemeId = row.SchemeId, JobId = row.Id, SupplierId = supplier, Kind = kind, QuoteId = quoteId,
            TokenHash = Hash(token), ExcludedPhotos = JsonSerializer.Serialize(excludedPhotos?.ToList() ?? [], Json.Options), CreatedAt = clock.GetUtcNow(),
        });
        return token;
    }

    /// <summary>
    /// Emails the link once the change is saved. A failed email doesn't undo anything: the job says it wasn't sent, so
    /// staff can phone the supplier instead (docs/26 §8).
    /// </summary>
    public void SendAfterCommit(CommandRunner commands, Guid jobRowId, string to, string supplierName, string subject, string body, string kind, string token, CancellationToken ct) =>
        commands.AfterCommit(async () =>
        {
            string text;
            try
            {
                await email.SendAsync(new EmailMessage(to, subject, $"{body}\n\n{Url(kind, token)}\n\nNo account needed. This link is for {supplierName} only: please don’t forward it."), ct);
                text = $"{(kind == Quote ? "Quote request" : "Work order")} emailed to {supplierName} ({SmtpEmailSender.Mask(to)})";
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError(e, "Couldn't email a supplier link for job {Job}", jobRowId);
                text = $"Couldn’t email the {(kind == Quote ? "quote request" : "work order")} to {supplierName}: phone them, or try again";
            }
            var row = await db.Jobs.FirstAsync(j => j.Id == jobRowId, ct);
            var job = MaintenanceService.Read(row);
            JobRules.Log(job, "message", text, "Humo PM", clock.GetUtcNow().ToString("O"));
            MaintenanceService.Write(row, job);
            await db.SaveChangesAsync(ct);
        });

    public async Task<SupplierLink?> FindAsync(string token, CancellationToken ct)
    {
        var hash = Hash(token ?? "");
        return await db.SupplierLinks.FirstOrDefaultAsync(l => l.TokenHash == hash && l.RevokedAt == null, ct);
    }

    /// <summary>Why the supplier can't act through the link any more, or null while they can.</summary>
    public string? ClosedReason(SupplierLink link, Job job)
    {
        if (job.Stage == JobStages.Cancelled) return "This job was cancelled.";
        if (link.Kind == Quote)
        {
            var quote = job.Quotes.FirstOrDefault(q => q.Id == link.QuoteId);
            if (quote is null || quote.SupplierId != link.SupplierId.ToString()) return "This quote request is no longer open.";
            if (quote.Status == "declined") return "You declined to quote.";
            if (job.Stage != JobStages.Quoting) return quote.Recommended ? "Your quote has been decided." : "Quotes for this job have closed.";
            return quote.Status is "requested" or "received" or "revision-requested" ? null : "Your quote has been decided.";
        }
        if (job.WorkOrder is null || job.SupplierId != link.SupplierId.ToString()) return "This work order is no longer yours.";
        if (job.Completion is { } done && DateTimeOffset.Parse(done.CompletedAt, CultureInfo.InvariantCulture) + WorkOrderAfterDone < clock.GetUtcNow()) return "This work order has closed.";
        return null;
    }
}

/// <summary>
///   GET  /supplier-links/{token}                      the request, as the supplier may see it
///   GET  /supplier-links/{token}/photos/{photoId}     a photo on it
///   POST /supplier-links/{token}/quote                quote or revise (multipart: amount, guaranteeMonths, notes, optional PDF)
///   POST /supplier-links/{token}/decline              decline to quote
///   POST /supplier-links/{token}/confirm              confirm the booked date
///   POST /supplier-links/{token}/reschedule           ask for another date
/// No sign-in: the link is the key. Rate-limited like document links. What happens goes in the job's history and the audit log.
/// </summary>
public static class SupplierLinkEndpoints
{
    public static void MapSupplierLinks(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/supplier-links/{token}").AllowAnonymous().RequireRateLimiting(Auth.RateLimits.DocumentLinks);
        g.MapGet("", View);
        g.MapGet("/photos/{photoId}", Photo);
        g.MapPost("/quote", SubmitQuote).DisableAntiforgery();
        g.MapPost("/decline", Decline);
        g.MapPost("/confirm", Confirm);
        g.MapPost("/reschedule", Reschedule);
    }

    private sealed record Context(SupplierLink Link, JobRow Row, Job Job, SupplierRow Supplier, Scheme Scheme, string Agency, string? Closed);

    private static async Task<Context?> LoadAsync(string token, SupplierLinks links, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await links.FindAsync(token, ct) is not { } link) return null;
        var row = await db.Jobs.FirstOrDefaultAsync(j => j.Id == link.JobId, ct);
        var supplier = await db.Suppliers.FirstOrDefaultAsync(s => s.Id == link.SupplierId, ct);
        if (row is null || supplier is null) return null;
        var scheme = await db.Schemes.AsNoTracking().FirstAsync(s => s.Id == row.SchemeId, ct);
        var agency = await db.Organisations.AsNoTracking().Where(o => o.Id == row.OrganisationId).Select(o => o.ShortName).FirstAsync(ct);
        var job = MaintenanceService.Read(row);
        link.LastOpenedAt = clock.GetUtcNow();
        return new Context(link, row, job, supplier, scheme, agency, links.ClosedReason(link, job));
    }

    private static List<string> Excluded(SupplierLink link) => JsonSerializer.Deserialize<List<string>>(link.ExcludedPhotos, Json.Options) ?? [];

    private static async Task<IResult> View(string token, SupplierLinks links, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await LoadAsync(token, links, db, clock, ct) is not { } c) return Problems.NotFound();
        await db.SaveChangesAsync(ct);
        var job = c.Job;
        var quote = c.Link.Kind == SupplierLinks.Quote ? job.Quotes.FirstOrDefault(q => q.Id == c.Link.QuoteId) : null;
        var excluded = Excluded(c.Link);
        // D38: the address and access notes are for the booked supplier only, never in a quote request.
        string? where = null;
        if (c.Link.Kind == SupplierLinks.WorkOrder)
        {
            var unit = job.UnitId is { } u && Guid.TryParse(u, out var uid) ? await db.Units.AsNoTracking().Where(x => x.Id == uid).Select(x => x.Number).FirstOrDefaultAsync(ct) : null;
            where = $"{c.Scheme.Name}{(unit is null ? "" : $", unit {unit}")} — {job.Location}";
        }
        return Results.Ok(new SupplierLinkViewDto(c.Link.Kind, c.Closed is null, c.Closed, c.Supplier.Name, c.Agency, c.Scheme.Name, string.Join(", ", new[] { c.Scheme.Suburb, c.Scheme.City }.Where(x => x.Length > 0)),
            where, job.Ref, job.Title, job.Description, job.Category,
            [.. job.Photos.Where(p => p.FileId is not null && !excluded.Contains(p.Id)).Select(p => new SupplierLinkPhotoDto(p.Id, p.Caption))],
            quote is null ? null : new SupplierQuoteDto(quote.Status, quote.Status is "received" or "revision-requested" or "rejected" ? quote.Amount : null, quote.GuaranteeMonths, quote.Notes,
                quote.RejectedReason, quote.FileId is not null),
            c.Link.Kind == SupplierLinks.WorkOrder && job.WorkOrder is { } w ? new SupplierWorkOrderDto(w.ScheduledFor, w.AccessNotes, w.ConfirmedAt, w.AskedFor) : null));
    }

    private static async Task<IResult> Photo(string token, string photoId, SupplierLinks links, HumoDbContext db, IFileStore store, TimeProvider clock, HttpContext http, CancellationToken ct)
    {
        if (await LoadAsync(token, links, db, clock, ct) is not { Closed: null } c || Excluded(c.Link).Contains(photoId)) return Problems.NotFound();
        if (c.Job.Photos.FirstOrDefault(p => p.Id == photoId)?.FileId is not { } fid || !Guid.TryParse(fid, out var fileId)) return Problems.NotFound();
        var file = await db.UploadedFiles.AsNoTracking().FirstOrDefaultAsync(f => f.Id == fileId && f.SchemeId == c.Row.SchemeId, ct);
        if (file is null || file.ScanResult != "clean" || !file.ContentType.StartsWith("image/", StringComparison.Ordinal)) return Problems.NotFound();
        http.Response.Headers.CacheControl = "private, max-age=300";
        http.Response.Headers.XContentTypeOptions = "nosniff";
        http.Response.Headers["X-Robots-Tag"] = "noindex";
        return Results.Stream(await store.OpenAsync(file.StorageKey, ct), file.ContentType);
    }

    /// <summary>Saves what the supplier did: the job, its history, the audit log, and a notice to whoever runs the job.</summary>
    private static async Task SaveAsync(Context c, string text, HumoDbContext db, Audit.AuditLog audit, Platform.Notices notices, TimeProvider clock, CancellationToken ct)
    {
        var by = $"{c.Supplier.Name} (supplier)";
        JobRules.Log(c.Job, "quote", text, by, clock.GetUtcNow().ToString("O"));
        c.Job.Version++;
        MaintenanceService.Write(c.Row, c.Job);
        audit.Record($"{text} — {c.Job.Ref}, through the supplier’s link (D38)", "success", category: "maintenance", organisationId: c.Row.OrganisationId, schemeId: c.Row.SchemeId,
            resource: "Job", resourceId: c.Job.Ref, system: "Supplier link");
        if (Guid.TryParse(c.Job.AssigneeId, out var assignee)) notices.ToPerson(assignee, null, $"{c.Job.Ref}: {text}", c.Job.Title, $"/maintenance/{c.Job.Ref}");
        await db.SaveChangesAsync(ct);
        await notices.SendEmailsAsync(ct);
    }

    private static IResult Closed(string why) => Results.Problem(title: why, statusCode: StatusCodes.Status409Conflict, extensions: new Dictionary<string, object?> { ["code"] = "closed" });

    private static async Task<IResult> SubmitQuote(string token, HttpRequest request, SupplierLinks links, HumoDbContext db, IFileStore store, IFileScanner scanner, IOptions<FilesOptions> options,
        Commercial.PackageLimits limits, Audit.AuditLog audit, Platform.Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await LoadAsync(token, links, db, clock, ct) is not { } c || c.Link.Kind != SupplierLinks.Quote) return Problems.NotFound();
        if (c.Closed is { } why) return Closed(why);
        var form = await request.ReadFormAsync(ct);
        var amount = decimal.TryParse(form["amount"].ToString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var a) ? Ledger.Round2(a) : (decimal?)null;
        int? guarantee = int.TryParse(form["guaranteeMonths"].ToString(), out var g) ? g : null;
        var notes = form["notes"].ToString().Trim();
        var errors = new Dictionary<string, string>();
        if (amount is not > 0) errors["amount"] = "Enter your price for the work.";
        if (guarantee is < 0 or > 120) errors["guaranteeMonths"] = "Months of guarantee, 0 to 120.";
        if (notes.Length > 1000) errors["notes"] = "Keep the notes under 1 000 characters.";
        if (errors.Count > 0) return Problems.Validation(errors);
        Guid? fileId = null;
        if (form.Files.Count > 0)
        {
            var (accepted, refusal) = await PdfIntake.CheckAsync(form.Files.FirstOrDefault(), options.Value.MaxBytes, scanner, ct);
            if (refusal is not null) return refusal;
            if (await limits.RefuseNewFileAsync(c.Row.OrganisationId, accepted!.Bytes.Length, ct) is { } full) return Problems.Validation(new() { ["file"] = full });
            var key = await store.SaveAsync(accepted.Bytes, ct);
            fileId = Guid.CreateVersion7();
            db.UploadedFiles.Add(new UploadedFile
            {
                Id = fileId.Value, OrganisationId = c.Row.OrganisationId, SchemeId = c.Row.SchemeId, Name = accepted.Name, ContentType = "application/pdf", SizeBytes = accepted.Bytes.Length,
                Sha256 = Convert.ToHexStringLower(SHA256.HashData(accepted.Bytes)), StorageKey = key, ScanResult = "clean", UploadedBy = $"{c.Supplier.Name} (supplier)", UploadedAt = clock.GetUtcNow(),
            });
        }
        var quote = c.Job.Quotes.First(q => q.Id == c.Link.QuoteId);
        var now = clock.GetUtcNow();
        var first = quote.Status is "requested";
        var by = $"{c.Supplier.Name} (supplier)";
        if (quote.Status == "received" && quote.Versions.Count == 0) quote.Versions.Add(new QuoteVersion(quote.Amount, quote.ReceivedAt ?? now.ToString("O"), "", null));
        quote.Amount = amount!.Value;
        quote.Versions.Add(new QuoteVersion(quote.Amount, now.ToString("O"), by, first ? "Quoted through their link" : "Revised by the supplier"));
        quote.Status = "received";
        quote.ReceivedAt = now.ToString("O");
        quote.ValidUntil = now.AddDays(30).ToString("O");
        quote.GuaranteeMonths = guarantee;
        quote.Notes = notes.Length > 0 ? notes : null;
        quote.RejectedReason = null;
        if (fileId is not null) quote.FileId = fileId.ToString();
        await SaveAsync(c, $"{(first ? "Quote" : "Revised quote")} received from {c.Supplier.Name}: {BillingRules.Rand(quote.Amount)}", db, audit, notices, clock, ct);
        return Results.NoContent();
    }

    private static async Task<IResult> Decline(string token, SupplierDeclineRequest body, SupplierLinks links, HumoDbContext db, Audit.AuditLog audit, Platform.Notices notices, TimeProvider clock,
        CancellationToken ct)
    {
        if (await LoadAsync(token, links, db, clock, ct) is not { } c || c.Link.Kind != SupplierLinks.Quote) return Problems.NotFound();
        if (c.Closed is { } why) return Closed(why);
        var reason = (body.Reason ?? "").Trim();
        var quote = c.Job.Quotes.First(q => q.Id == c.Link.QuoteId);
        quote.Status = "declined";
        quote.Recommended = false;
        await SaveAsync(c, $"{c.Supplier.Name} declined to quote{(reason.Length > 0 ? $": {reason[..Math.Min(reason.Length, 300)]}" : "")}", db, audit, notices, clock, ct);
        return Results.NoContent();
    }

    private static async Task<IResult> Confirm(string token, SupplierLinks links, HumoDbContext db, Audit.AuditLog audit, Platform.Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await LoadAsync(token, links, db, clock, ct) is not { } c || c.Link.Kind != SupplierLinks.WorkOrder) return Problems.NotFound();
        if (c.Closed is { } why) return Closed(why);
        var w = c.Job.WorkOrder!;
        c.Job.WorkOrder = w with { ConfirmedAt = clock.GetUtcNow().ToString("O"), AskedFor = null };
        var when = DateTimeOffset.Parse(w.ScheduledFor, CultureInfo.InvariantCulture).ToOffset(TimeSpan.FromHours(2));
        await SaveAsync(c, $"{c.Supplier.Name} confirmed the booking for {when:ddd d MMM}", db, audit, notices, clock, ct);
        return Results.NoContent();
    }

    private static async Task<IResult> Reschedule(string token, SupplierRescheduleRequest body, SupplierLinks links, HumoDbContext db, Audit.AuditLog audit, Platform.Notices notices,
        TimeProvider clock, CancellationToken ct)
    {
        if (await LoadAsync(token, links, db, clock, ct) is not { } c || c.Link.Kind != SupplierLinks.WorkOrder) return Problems.NotFound();
        if (c.Closed is { } why) return Closed(why);
        if (!DateOnly.TryParseExact(body.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            return Problems.Validation(new() { ["date"] = "Choose the day you can come." });
        var note = (body.Note ?? "").Trim();
        c.Job.WorkOrder = c.Job.WorkOrder! with { AskedFor = body.Date, ConfirmedAt = null };
        await SaveAsync(c, $"{c.Supplier.Name} asks to come on {date:ddd d MMM} instead{(note.Length > 0 ? $": {note[..Math.Min(note.Length, 300)]}" : "")}", db, audit, notices, clock, ct);
        return Results.NoContent();
    }
}
