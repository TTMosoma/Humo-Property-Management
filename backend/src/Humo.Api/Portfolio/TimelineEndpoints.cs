using System.Globalization;
using Humo.Api.Commands;
using Humo.Api.Finance;
using Humo.Api.Platform;
using Humo.Domain.Access;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Files;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Portfolio;

/// <summary>As the frontend's <c>TimelineEvent</c> (pattern P4). <c>AllDay</c>: only the date is known, so no time is shown.</summary>
/// <param name="FileId">A file with the entry (e.g. a proof of payment), opened through <c>GET /files/{id}/link</c>.</param>
public sealed record TimelineEventDto(string Id, string At, string Kind, string Title, string? Detail = null, string? Actor = null, decimal? Amount = null, string? Link = null,
    bool? AllDay = null, string? FileId = null, string? FileName = null);
public sealed record NewNoteRequest(string? UnitId, string? PersonId, string? Kind, string? Text);
public sealed record PaymentReportRequest(string? Text);

/// <summary>
/// Timelines and notes: everything that happened to a unit or a person, in one stream. Built from the records
/// themselves (the ledger, issued statements, maintenance jobs, who owned or rented it) plus the notes and calls staff
/// log. Owners tell the agency they've paid from My account; that lands on the unit as a note and staff are told.
/// </summary>
public static class TimelineEndpoints
{
    public const int MaxNote = 2000;

    public static void MapTimeline(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("").RequireAuthorization();
        g.MapGet("/units/{id:guid}/timeline", ForUnit);
        g.MapGet("/people/{id:guid}/timeline", ForPerson);
        g.MapPost("/notes", AddNote);
        g.MapPost("/accounts/{id:guid}/payment-report", ReportPayment);
    }

    private static string Month(string period) =>
        new DateTime(int.Parse(period[..4], CultureInfo.InvariantCulture), int.Parse(period[5..7], CultureInfo.InvariantCulture), 1).ToString("MMMM yyyy", CultureInfo.InvariantCulture);

    private static readonly TimeSpan SouthAfrica = TimeSpan.FromHours(2);

    /// <summary>A calendar date with no time of day: the start of that day in South Africa, so it sorts below the day's timed events.</summary>
    private static string Day(DateOnly d) => new DateTimeOffset(d.ToDateTime(TimeOnly.MinValue), SouthAfrica).ToString("O");

    private static DateOnly DateOf(DateTimeOffset t) => DateOnly.FromDateTime(t.ToOffset(SouthAfrica).DateTime);

    /// <summary>
    /// When a ledger line happened: the moment it was posted, if that was on the day it's dated. A line posted on a later
    /// day (a payment allocated after it reached the bank, imported or opening history) shows on its own date, with no time.
    /// </summary>
    private static (string At, bool? AllDay) Posted(DateOnly date, DateTimeOffset postedAt) =>
        DateOf(postedAt) == date ? (postedAt.ToString("O"), null) : (Day(date), true);

    private static string Short(DateTimeOffset t) => t.ToOffset(SouthAfrica).ToString("d MMM yyyy, HH:mm", CultureInfo.InvariantCulture);

    private static TimelineEventDto FromNote(NoteRow n, IReadOnlyDictionary<Guid, string> files, string? prefix = null) =>
        new(n.Id.ToString(), n.At.ToString("O"), n.Kind, prefix + (n.Kind == "call" ? "Call logged" : "Note"), n.Text, n.Author,
            FileId: n.FileId?.ToString(), FileName: n.FileId is { } f && files.TryGetValue(f, out var name) ? name : null);

    /// <summary>The names of the files these notes carry.</summary>
    private static async Task<List<TimelineEventDto>> NotesAsync(HumoDbContext db, IQueryable<NoteRow> query, string? prefix, CancellationToken ct)
    {
        var notes = await query.AsNoTracking().ToListAsync(ct);
        var ids = notes.Where(n => n.FileId != null).Select(n => n.FileId!.Value).ToList();
        var files = ids.Count == 0 ? new Dictionary<Guid, string>() : await db.UploadedFiles.AsNoTracking().Where(f => ids.Contains(f.Id)).ToDictionaryAsync(f => f.Id, f => f.Name, ct);
        return [.. notes.Select(n => FromNote(n, files, prefix))];
    }

    private static async Task<List<TimelineEventDto>> UnitEventsAsync(HumoDbContext db, Unit unit, string prefix, CancellationToken ct)
    {
        var events = new List<TimelineEventDto>();
        var unitLink = $"/schemes/{unit.SchemeId}/units/{unit.Number}";
        if (await db.LevyAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.UnitId == unit.Id, ct) is { } account)
        {
            var accountLink = $"{unitLink}/account";
            var lines = await db.Ledger.AsNoTracking().Where(e => e.AccountId == account.Id).ToListAsync(ct);
            foreach (var e in lines.Where(e => e.Type is TransactionTypes.Payment or TransactionTypes.Adjustment or TransactionTypes.Reversal))
            {
                var (at, allDay) = Posted(e.Date, e.CreatedAt);
                var detail = e.Reference is { Length: > 0 } r ? $"Reference “{r}”" : e.Description;
                if (allDay is true && DateOf(e.CreatedAt) > e.Date) detail += $" · put on the account {Short(e.CreatedAt)}";
                events.Add(new($"ev-{e.Id}", at, "payment", prefix + (e.Type switch { TransactionTypes.Payment => "Payment received", TransactionTypes.Reversal => "Payment reversed", _ => "Adjustment" }),
                    detail, null, -e.Amount, accountLink, allDay));
            }
            foreach (var month in lines.Where(e => e.Type is not (TransactionTypes.Payment or TransactionTypes.Adjustment or TransactionTypes.Reversal)).GroupBy(e => e.Date.ToString("yyyy-MM", CultureInfo.InvariantCulture)))
            {
                var firstDate = month.Min(e => e.Date);
                var (at, allDay) = Posted(firstDate, month.Where(e => e.Date == firstDate).Min(e => e.CreatedAt));
                events.Add(new($"ev-charges-{account.Id}-{month.Key}", at, "charge", prefix + $"{Month(month.Key)} charges raised",
                    string.Join(" · ", month.Select(e => e.Description.Split(" — ")[0]).Distinct()), null, Ledger.Round2(month.Sum(e => e.Amount)), accountLink, allDay));
            }
            foreach (var s in await db.IssuedStatements.AsNoTracking().Where(s => s.AccountId == account.Id).ToListAsync(ct))
                events.Add(new($"ev-statement-{s.Id}", s.IssuedAt.ToString("O"), "statement", prefix + $"{Month(s.Period)} statement issued", null, s.IssuedBy, null,
                    $"{accountLink}/statements/{s.Period}"));
        }
        foreach (var j in await db.Jobs.AsNoTracking().Where(j => j.UnitId == unit.Id).ToListAsync(ct))
            events.Add(new($"ev-job-{j.Id}", j.ReportedAt.ToString("O"), "maintenance", prefix + $"{j.Ref} · {j.Title}", $"Now {j.Stage.Replace('-', ' ')}", null, null, $"/maintenance/{j.Ref}"));
        var rels = await db.Relationships.AsNoTracking().Where(r => r.UnitId == unit.Id && (r.Type == "owner" || r.Type == "tenant")).ToListAsync(ct);
        var names = await db.People.AsNoTracking().Where(p => rels.Select(r => r.PersonId).Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.DisplayName, ct);
        foreach (var r in rels)
        {
            var who = names.GetValueOrDefault(r.PersonId, "Someone");
            events.Add(new($"ev-rel-{r.Id}", Day(r.Since), "status", prefix + $"{who} became the {r.Type}", null, null, null, $"/people/{r.PersonId}", true));
            if (r.Until is { } until)
                events.Add(new($"ev-rel-end-{r.Id}", Day(until.AddDays(1)), "status", prefix + $"{who} is no longer the {r.Type}", r.EndReason, null, null, $"/people/{r.PersonId}", true));
        }
        events.AddRange(await NotesAsync(db, db.Notes.Where(n => n.UnitId == unit.Id), prefix, ct));
        return events;
    }

    private static List<TimelineEventDto> Newest(IEnumerable<TimelineEventDto> events) =>
        events.GroupBy(e => e.Id).Select(g => g.First()).OrderByDescending(e => DateTimeOffset.Parse(e.At, CultureInfo.InvariantCulture)).ToList();

    private static async Task<IResult> ForUnit(Guid id, CurrentActor current, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var unit = await db.Units.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct);
        if (unit is null || !(await reads.ReadableSchemes(actor, null, ct)).Any(s => s.Id == unit.SchemeId)) return Problems.NotFound();
        return Results.Ok(Newest(await UnitEventsAsync(db, unit, "", ct)));
    }

    /// <summary>Their units' timelines (as owner), each line marked with the unit, and the notes on the person.</summary>
    private static async Task<IResult> ForPerson(Guid id, CurrentActor current, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var schemes = await reads.ReadableSchemes(actor, null, ct);
        if ((await reads.People(schemes, q => q.Where(p => p.Id == id), ct)).Count == 0) return Problems.NotFound();
        var schemeIds = schemes.Select(s => s.Id).ToList();
        var codes = schemes.ToDictionary(s => s.Id, s => s.Code);
        var unitIds = await db.Relationships.AsNoTracking().Where(r => r.PersonId == id && r.Type == "owner" && r.UnitId != null && schemeIds.Contains(r.SchemeId))
            .Select(r => r.UnitId!.Value).Distinct().ToListAsync(ct);
        var events = new List<TimelineEventDto>();
        foreach (var unit in await db.Units.AsNoTracking().Where(u => unitIds.Contains(u.Id)).ToListAsync(ct))
            events.AddRange(await UnitEventsAsync(db, unit, $"{codes.GetValueOrDefault(unit.SchemeId)} {unit.Number} · ", ct));
        events.AddRange(await NotesAsync(db, db.Notes.Where(n => n.PersonId == id && n.UnitId == null), null, ct));
        return Results.Ok(Newest(events));
    }

    /// <summary>Staff log a note or a call on a unit or a person (Notes.Add, within their schemes).</summary>
    private static async Task<IResult> AddNote(NewNoteRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, PortfolioReads reads, TimeProvider clock,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var schemes = await reads.ReadableSchemes(me, null, ct);
        var unit = Guid.TryParse(body.UnitId, out var u) ? await db.Units.AsNoTracking().FirstOrDefaultAsync(x => x.Id == u, ct) : null;
        if (unit is not null && !schemes.Any(s => s.Id == unit.SchemeId)) unit = null;
        var personId = Guid.TryParse(body.PersonId, out var p) && (await reads.People(schemes, q => q.Where(x => x.Id == p), ct)).Count > 0 ? p : (Guid?)null;
        if (unit is null && personId is null) return Problems.NotFound();
        var text = (body.Text ?? "").Trim();
        var kind = body.Kind == "call" ? "call" : "note";
        var id = Guid.CreateVersion7();
        return await commands.RunAsync(new CommandSpec(kind == "call" ? "Logged a call" : "Logged a note", "Notes.Add")
        {
            Resource = "Note",
            ResourceId = id.ToString(),
            SchemeId = unit?.SchemeId,
            Validate = () => text.Length == 0 ? new() { ["text"] = "Write the note." } : text.Length > MaxNote ? new() { ["text"] = $"At most {MaxNote} characters." } : [],
        }, actor =>
        {
            db.Notes.Add(new NoteRow
            {
                Id = id, OrganisationId = actor.OrganisationId ?? Guid.Empty, UnitId = unit?.Id, PersonId = personId, Kind = kind, Text = text, Author = actor.Human.Name,
                AuthorId = actor.Human.Id, At = clock.GetUtcNow(),
            });
            return Task.FromResult(Results.Created($"/api/notes/{id}", new { id = id.ToString() }));
        }, ct);
    }

    /// <summary>
    /// "I've already paid": the account holder tells the agency, with their proof of payment if they have it (a PDF or a
    /// photo, checked like every upload and counted in the agency's storage). It lands on the unit as a note, with the
    /// file; finance and the administrators are told. JSON (text only) or a form (text and an optional file).
    /// </summary>
    private static async Task<IResult> ReportPayment(Guid id, HttpRequest request, CurrentActor current, CommandRunner commands, HumoDbContext db, Notices notices,
        TimeProvider clock, IFileStore store, IFileScanner scanner, IOptions<FilesOptions> options, Commercial.PackageLimits limits, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await AccountEndpoints.Readable(me, db, id, ct) is not { } account || me.User.PersonId != account.HolderPersonId?.ToString()) return Problems.NotFound();
        var unit = await db.Units.AsNoTracking().FirstAsync(u => u.Id == account.UnitId, ct);
        var scheme = await db.Schemes.AsNoTracking().FirstAsync(s => s.Id == account.SchemeId, ct);

        string text;
        (byte[] Bytes, string Name, string ContentType)? proof = null;
        if (request.HasFormContentType)
        {
            var form = await request.ReadFormAsync(ct);
            text = form["text"].ToString().Trim();
            if (form.Files.FirstOrDefault() is { Length: > 0 } upload)
            {
                // A PDF (a bank's proof of payment) or a photo or screenshot of one.
                var pdf = upload.ContentType == "application/pdf" || upload.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase);
                if (pdf)
                {
                    var (doc, refused) = await Files.PdfIntake.CheckAsync(upload, options.Value.MaxBytes, scanner, ct);
                    if (refused is not null) return refused;
                    proof = (doc!.Bytes, doc.Name, "application/pdf");
                }
                else
                {
                    // Not a PDF and not a photo by its content: say what is accepted, rather than "only photos".
                    var head = new byte[12];
                    await using (var peek = upload.OpenReadStream()) _ = await peek.ReadAtLeastAsync(head, head.Length, throwOnEndOfStream: false, ct);
                    var photo = head.AsSpan().StartsWith(new byte[] { 0xFF, 0xD8, 0xFF }) || head.AsSpan().StartsWith(new byte[] { 0x89, 0x50, 0x4E, 0x47 })
                        || (head.AsSpan(0, 4).SequenceEqual("RIFF"u8) && head.AsSpan(8, 4).SequenceEqual("WEBP"u8));
                    if (!photo) return Problems.Validation(new() { ["file"] = "Attach your proof of payment as a PDF, or a JPEG, PNG or WebP photo or screenshot." });
                    var (image, refused) = await Maintenance.ImageIntake.CheckAsync(upload, options.Value.MaxBytes, scanner, ct);
                    if (refused is not null) return refused;
                    proof = (image!.Bytes, image.Name, image.ContentType);
                }
                if (await limits.RefuseNewFileAsync(scheme.OrganisationId, proof.Value.Bytes.Length, ct) is { } full) return Problems.Validation(new() { ["file"] = full });
            }
        }
        else text = ((await request.ReadFromJsonAsync<PaymentReportRequest>(ct))?.Text ?? "").Trim();
        return await commands.RunAsync(new CommandSpec($"Reported a payment on {account.AccountNo}", "Account.ViewOwn")
        {
            Resource = "Account",
            ResourceId = id.ToString(),
            SchemeId = account.SchemeId,
            Validate = () => text.Length < 5 ? new() { ["text"] = "Say when, how much and from which account you paid." } : text.Length > MaxNote ? new() { ["text"] = $"At most {MaxNote} characters." } : [],
        }, async actor =>
        {
            Guid? fileId = null;
            if (proof is { } p)
            {
                fileId = Guid.CreateVersion7();
                db.UploadedFiles.Add(new UploadedFile
                {
                    Id = fileId.Value, OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, Name = p.Name, ContentType = p.ContentType, SizeBytes = p.Bytes.Length,
                    Sha256 = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(p.Bytes)), StorageKey = await store.SaveAsync(p.Bytes, ct), ScanResult = "clean",
                    UploadedBy = actor.Human.Name, UploadedAt = clock.GetUtcNow(),
                });
            }
            db.Notes.Add(new NoteRow
            {
                Id = Guid.CreateVersion7(), OrganisationId = scheme.OrganisationId, UnitId = unit.Id, PersonId = account.HolderPersonId, Kind = "note",
                Text = $"Owner reports payment: {text}", Author = actor.Human.Name, AuthorId = actor.Human.Id, At = clock.GetUtcNow(), FileId = fileId,
            });
            var link = $"/schemes/{scheme.Id}/units/{unit.Number}";
            foreach (var role in new[] { Roles.Finance, Roles.AgencyAdmin })
                notices.ToRole(role, actor.Human.Id, $"{account.AccountNo}: owner says they’ve paid{(proof is null ? "" : " (proof attached)")}", text, link, scheme.OrganisationId, "finance");
            // The storage warning at 80% (D20), counted with this file.
            if (proof is { } counted) await limits.NotifyAsync(scheme.OrganisationId, notices, actor.Human.Id, ct, extraBytes: counted.Bytes.Length);
            return Results.NoContent();
        }, ct);
    }
}
