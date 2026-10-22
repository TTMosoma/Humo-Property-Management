using Humo.Api.Commands;
using Humo.Api.Files;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Files;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Documents;

public sealed record LibraryLinkDto(string Kind, string Id, string Label, string Route);
public sealed record ArchivedDto(string At, string By, string Reason);
public sealed record LibraryDocumentDto(string Id, int Version, string Title, string FileName, string MimeType, long SizeBytes, string Category,
    List<string> SchemeIds, List<LibraryLinkDto> Links, string Visibility, string UploadedAt, string UploadedBy, string? ExpiresAt, string? Notes, ArchivedDto? Archived);
public sealed record LibraryActionRequest(string Type, int ExpectedVersion, string? Title, string? Category, string? Visibility, string? ExpiresAt, string? Notes, string? Reason);

/// <summary>
/// The document library on the API (docs/18 R-11). A document is uploaded on a scheme, a unit or a job; its PDF is checked
/// (see <see cref="PdfIntake"/>) and stored. Staff with the document permission read everything on the schemes they
/// cover. Trustees, owners and tenants read what's shared with them: trustees see "trustees" and "owners" documents on
/// their schemes; owners see "owners" documents on their schemes; owners and tenants see "this unit only" documents on
/// their units. Documents on people, suppliers and meetings, and replacing a compliance or vetting document, come later.
/// </summary>
public static class LibraryEndpoints
{
    public static readonly string[] Categories = ["insurance", "certificate", "vetting", "rules", "minutes", "financial", "contract", "plans", "correspondence", "quote", "photo", "other"];
    public static readonly string[] Visibilities = ["staff", "trustees", "owners", "unit"];
    private static readonly string[] RecordKinds = ["scheme", "unit", "job"];

    public static void MapLibrary(this RouteGroupBuilder g)
    {
        g.MapGet("/library", List);
        g.MapGet("/library/mine", Mine);
        g.MapGet("/library/{id:guid}", Get);
        g.MapPost("/library", Upload);
        g.MapPost("/library/{id:guid}/actions", Act);
        g.MapGet("/library/{id:guid}/link", Link);
    }

    /// <summary>The documents on the schemes asked for that this person may see (archived included: the screen filters them).</summary>
    private static async Task<IResult> List(HttpRequest request, CurrentActor current, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        // schemeIds=… (the library), or record=kind:{id} for a scheme, a unit or a job (a job by its id or its reference).
        var schemeIds = new HashSet<Guid>();
        var unitIds = new HashSet<Guid>();
        var jobValues = new List<string>();
        foreach (var record in request.Query["record"].Select(v => v ?? "").Where(v => v.Contains(':')))
        {
            var kind = record[..record.IndexOf(':')];
            var value = record[(record.IndexOf(':') + 1)..];
            if (kind == "scheme" && Guid.TryParse(value, out var sid)) schemeIds.Add(sid);
            else if (kind == "unit" && Guid.TryParse(value, out var uid)) unitIds.Add(uid);
            else if (kind == "job") jobValues.Add(value);
        }
        foreach (var value in request.Query["schemeIds"].SelectMany(v => (v ?? "").Split(',')))
            if (Guid.TryParse(value, out var sid)) schemeIds.Add(sid);
        var jobIds = jobValues.Count == 0 ? new List<Guid>() : await db.Jobs.AsNoTracking()
            .Where(j => jobValues.Contains(j.Ref) || jobValues.Contains(j.Id.ToString())).Select(j => j.Id).ToListAsync(ct);
        if (schemeIds.Count == 0 && unitIds.Count == 0 && jobIds.Count == 0) return Results.Ok(Array.Empty<LibraryDocumentDto>());

        var reach = await ReachAsync(actor, db, clock, ct);
        var documents = (await db.LibraryDocuments.AsNoTracking().Where(d => schemeIds.Contains(d.SchemeId)
                || (d.RecordKind == "unit" && d.RecordId != null && unitIds.Contains(d.RecordId.Value))
                || (d.RecordKind == "job" && d.RecordId != null && jobIds.Contains(d.RecordId.Value)))
            .ToListAsync(ct)).Where(d => Visible(d, actor, reach)).ToList();
        return Results.Ok((await DtosAsync(documents, db, ct)).OrderByDescending(d => d.UploadedAt).ToList());
    }

    /// <summary>What's shared with the signed-in person: their scheme's trustee, owner or unit documents, not archived.</summary>
    private static async Task<IResult> Mine(CurrentActor current, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var reach = await ReachAsync(actor, db, clock, ct);
        var schemes = reach.OwnerSchemes.Concat(reach.TrusteeSchemes).ToList();
        var units = reach.Units.ToList();
        var candidates = await db.LibraryDocuments.AsNoTracking()
            .Where(d => d.ArchivedAt == null && (schemes.Contains(d.SchemeId) || (d.RecordKind == "unit" && units.Contains(d.RecordId!.Value))))
            .ToListAsync(ct);
        var visible = candidates.Where(d => Visible(d, actor, reach)).ToList();
        return Results.Ok((await DtosAsync(visible, db, ct)).OrderByDescending(d => d.UploadedAt).ToList());
    }

    /// <summary>One document, if the person can see it.</summary>
    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var document = await db.LibraryDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id, ct);
        if (document is null || !Visible(document, actor, await ReachAsync(actor, db, clock, ct))) return Problems.NotFound();
        return Results.Ok((await DtosAsync([document], db, ct))[0]);
    }

    /// <summary>A PDF on a scheme, unit or job, with its title, category, who may open it and when it lapses.</summary>
    private static async Task<IResult> Upload(HttpRequest request, CurrentActor current, CommandRunner commands, HumoDbContext db, IFileStore store,
        IFileScanner scanner, IOptions<FilesOptions> options, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var form = await request.ReadFormAsync(ct);
        var kind = form["recordKind"].ToString() is { Length: > 0 } k ? k : "scheme";
        var recordValue = (kind == "scheme" ? form["schemeId"] : form["recordId"]).ToString().Trim();
        var title = form["title"].ToString().Trim();
        var category = form["category"].ToString();
        var visibility = form["visibility"].ToString();
        var errors = Check(title, category, visibility, form["expiresAt"].ToString(), kind);
        if (recordValue.Length == 0) errors[kind == "scheme" ? "schemeId" : "recordId"] = "Choose what this document is uploaded on.";
        if (errors.Count > 0) return Problems.Validation(errors);

        var placement = await PlaceAsync(kind, recordValue, actor, db, ct);
        if (placement is null) return Problems.NotFound();

        var (accepted, refusal) = await PdfIntake.CheckAsync(form.Files.FirstOrDefault(), options.Value.MaxBytes, scanner, ct);
        if (refusal is not null) return refusal;

        return await commands.RunAsync(new CommandSpec($"Uploaded {title} to {placement.SchemeName}", "Documents.Manage")
        {
            Resource = "Document",
            ResourceId = title,
            SchemeId = placement.SchemeId,
            Category = "documents",
        }, async writer =>
        {
            var key = await store.SaveAsync(accepted!.Bytes, ct);
            var fileId = Guid.CreateVersion7();
            db.UploadedFiles.Add(new UploadedFile
            {
                Id = fileId, OrganisationId = placement.OrganisationId, SchemeId = placement.SchemeId, Name = accepted.Name, ContentType = "application/pdf",
                SizeBytes = accepted.Bytes.Length, Sha256 = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(accepted.Bytes)),
                StorageKey = key, ScanResult = "clean", UploadedBy = writer.Human.Name, UploadedAt = clock.GetUtcNow(),
            });
            var id = Guid.CreateVersion7();
            db.LibraryDocuments.Add(new LibraryDocument
            {
                Id = id, OrganisationId = placement.OrganisationId, SchemeId = placement.SchemeId, FileId = fileId, RecordKind = placement.Kind,
                RecordId = placement.Kind == "scheme" ? null : placement.RecordId, Title = title, Category = category, Visibility = visibility,
                ExpiresOn = ParseDate(form["expiresAt"].ToString()), Notes = Notes(form["notes"].ToString()), Version = 1, UploadedBy = writer.Human.Name,
                UploadedAt = clock.GetUtcNow(),
            });
            return Results.Ok(new { id = id.ToString() });
        }, ct);
    }

    /// <summary>Edit, archive or restore. The version the screen saw must be the current one. Staff only.</summary>
    private static async Task<IResult> Act(Guid id, LibraryActionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var document = await db.LibraryDocuments.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (document is null || !actor.CoversScheme(document.SchemeId)) return Problems.NotFound();
        if (body.ExpectedVersion != document.Version) return Problems.Conflict();

        var errors = new Dictionary<string, string>();
        switch (body.Type)
        {
            case "edit":
                errors = Check(body.Title?.Trim() ?? "", body.Category ?? "", body.Visibility ?? "", body.ExpiresAt ?? "", document.RecordKind);
                break;
            case "archive":
                if (document.ArchivedAt is not null) errors["id"] = "Already archived.";
                if (string.IsNullOrWhiteSpace(body.Reason)) errors["reason"] = "Say why it’s being archived.";
                break;
            case "restore":
                if (document.ArchivedAt is null) errors["id"] = "It isn’t archived.";
                break;
            default:
                return Problems.Validation(new() { ["type"] = "Unknown action." });
        }

        var verb = body.Type switch { "edit" => "Edited", "archive" => "Archived", _ => "Restored" };
        return await commands.RunAsync(new CommandSpec($"{verb} {document.Title}", "Documents.Manage")
        {
            Resource = "Document",
            ResourceId = document.Title,
            SchemeId = document.SchemeId,
            Category = "documents",
            Validate = () => errors,
        }, writer =>
        {
            switch (body.Type)
            {
                case "edit":
                    document.Title = body.Title!.Trim();
                    document.Category = body.Category!;
                    document.Visibility = body.Visibility!;
                    document.ExpiresOn = ParseDate(body.ExpiresAt ?? "");
                    document.Notes = Notes(body.Notes ?? "");
                    break;
                case "archive":
                    document.ArchivedAt = clock.GetUtcNow();
                    document.ArchivedBy = writer.Human.Name;
                    document.ArchiveReason = body.Reason!.Trim();
                    break;
                default:
                    document.ArchivedAt = null;
                    document.ArchivedBy = null;
                    document.ArchiveReason = null;
                    break;
            }
            document.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>A link to open the file: for this person, for a few minutes, and only while they can see the document.</summary>
    private static async Task<IResult> Link(Guid id, CurrentActor current, HumoDbContext db, IOptions<FilesOptions> options, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var document = await db.LibraryDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id, ct);
        if (document is null || !Visible(document, actor, await ReachAsync(actor, db, clock, ct))) return Problems.NotFound();

        var expires = clock.GetUtcNow() + options.Value.LinkLifetime;
        var signature = SignedLinks.Sign(options.Value.SigningKey!, SignedLinks.Payload(document.FileId, actor.User.Id, expires));
        return Results.Ok(new FileLinkDto($"/api/files/{document.FileId:N}/content?exp={expires.ToUnixTimeSeconds()}&sig={signature}", expires.ToString("O")));
    }

    /// <summary>Where a new document goes: the scheme, the unit's scheme or the job's scheme, if the person covers it.</summary>
    private sealed record Placement(string Kind, Guid? RecordId, Guid SchemeId, Guid OrganisationId, string SchemeName);

    private static async Task<Placement?> PlaceAsync(string kind, string value, Actor actor, HumoDbContext db, CancellationToken ct)
    {
        if (!RecordKinds.Contains(kind)) return null;
        if (kind != "job" && !Guid.TryParse(value, out _)) return null;
        var id = kind == "job" ? Guid.Empty : Guid.Parse(value);
        if (kind == "scheme")
        {
            var scheme = await db.Schemes.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, ct);
            return scheme is null || !actor.CoversScheme(id) ? null : new Placement("scheme", null, id, scheme.OrganisationId, scheme.Name);
        }
        if (kind == "unit")
        {
            var unit = await db.Units.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct);
            if (unit is null || !actor.CoversScheme(unit.SchemeId)) return null;
            var scheme = await db.Schemes.AsNoTracking().FirstAsync(s => s.Id == unit.SchemeId, ct);
            return new Placement("unit", id, scheme.Id, scheme.OrganisationId, scheme.Name);
        }
        var job = await db.Jobs.AsNoTracking().FirstOrDefaultAsync(j => j.Ref == value || j.Id.ToString() == value, ct);
        if (job is null || !actor.CoversScheme(job.SchemeId)) return null;
        var jobScheme = await db.Schemes.AsNoTracking().FirstAsync(s => s.Id == job.SchemeId, ct);
        return new Placement("job", job.Id, jobScheme.Id, jobScheme.OrganisationId, jobScheme.Name);
    }

    /// <summary>The schemes and units a person can read beyond staff access, from their relationships and trustee role.</summary>
    private sealed record Reach(HashSet<Guid> OwnerSchemes, HashSet<Guid> TrusteeSchemes, HashSet<Guid> Units);

    private static async Task<Reach> ReachAsync(Actor actor, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var trusteeSchemes = actor.Assignment.Role == Roles.Trustee
            ? actor.Assignment.SchemeIds.Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToHashSet()
            : new HashSet<Guid>();
        var person = Guid.TryParse(actor.User.PersonId, out var p) ? p : (Guid?)null;
        var relationships = person is null ? [] : await db.Relationships.AsNoTracking()
            .Where(r => r.PersonId == person && (r.Type == "owner" || r.Type == "tenant")).ToListAsync(ct);
        var current = relationships.Where(r => r.Until is null || r.Until >= today).ToList();
        return new Reach(
            current.Where(r => r.Type == "owner").Select(r => r.SchemeId).ToHashSet(),
            trusteeSchemes,
            current.Where(r => r.UnitId is not null).Select(r => r.UnitId!.Value).ToHashSet());
    }

    /// <summary>
    /// Whether this person may open this document. Staff (with the document permission, and not acting as a trustee) see
    /// every document on their schemes. Trustees see "trustees" and "owners" documents on theirs. Owners see "owners"
    /// documents on their schemes, and "this unit only" documents on their units.
    /// </summary>
    private static bool Visible(LibraryDocument d, Actor actor, Reach reach) =>
        (actor.Can("Documents.View") && actor.Assignment.Role != Roles.Trustee && actor.CoversScheme(d.SchemeId))
        || (reach.TrusteeSchemes.Contains(d.SchemeId) && d.Visibility is "trustees" or "owners")
        || (reach.OwnerSchemes.Contains(d.SchemeId) && d.Visibility == "owners")
        || (d.RecordKind == "unit" && d.RecordId is { } unit && reach.Units.Contains(unit) && d.Visibility == "unit");

    /// <summary>The fields a document is saved with. "unit" visibility is only for documents uploaded on a unit.</summary>
    private static Dictionary<string, string> Check(string title, string category, string visibility, string expiresAt, string recordKind)
    {
        var errors = new Dictionary<string, string>();
        if (title.Length == 0) errors["title"] = "Give the document a title.";
        else if (title.Length > 200) errors["title"] = "Keep the title to 200 characters.";
        if (!Categories.Contains(category)) errors["category"] = "Choose a category.";
        if (!Visibilities.Contains(visibility)) errors["visibility"] = "Choose who can open it.";
        else if (visibility == "unit" && recordKind != "unit") errors["visibility"] = "“This unit only” is for documents uploaded on a unit.";
        if (expiresAt.Length > 0 && ParseDate(expiresAt) is null) errors["expiresAt"] = "Use a date, such as 2027-03-31.";
        return errors;
    }

    private static DateOnly? ParseDate(string value) =>
        DateOnly.TryParseExact(value, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var date) ? date : null;

    private static string? Notes(string value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim()[..Math.Min(value.Trim().Length, 2000)];

    /// <summary>The documents as the library shows them: each with the record it's uploaded on, as a link.</summary>
    private static async Task<List<LibraryDocumentDto>> DtosAsync(IReadOnlyCollection<LibraryDocument> documents, HumoDbContext db, CancellationToken ct)
    {
        var fileIds = documents.Select(d => d.FileId).ToList();
        var files = await db.UploadedFiles.AsNoTracking().Where(f => fileIds.Contains(f.Id)).ToDictionaryAsync(f => f.Id, ct);
        var schemeIds = documents.Select(d => d.SchemeId).Distinct().ToList();
        var schemes = await db.Schemes.AsNoTracking().Where(s => schemeIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, ct);
        var unitIds = documents.Where(d => d.RecordKind == "unit" && d.RecordId is not null).Select(d => d.RecordId!.Value).ToList();
        var units = await db.Units.AsNoTracking().Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, ct);
        var jobIds = documents.Where(d => d.RecordKind == "job" && d.RecordId is not null).Select(d => d.RecordId!.Value).ToList();
        var jobs = await db.Jobs.AsNoTracking().Where(j => jobIds.Contains(j.Id)).ToDictionaryAsync(j => j.Id, ct);

        return documents.Select(d =>
        {
            var file = files[d.FileId];
            var scheme = schemes[d.SchemeId];
            LibraryLinkDto link = d.RecordKind switch
            {
                "unit" when units.TryGetValue(d.RecordId!.Value, out var unit) =>
                    new LibraryLinkDto("unit", unit.Id.ToString(), $"Unit {unit.Number}, {scheme.Name}", $"/schemes/{scheme.Id}/units/{unit.Number}"),
                "job" when jobs.TryGetValue(d.RecordId!.Value, out var job) =>
                    new LibraryLinkDto("job", job.Ref, $"{job.Ref} · {job.Title}", $"/maintenance/{job.Ref}"),
                _ => new LibraryLinkDto("scheme", scheme.Id.ToString(), scheme.Name, $"/schemes/{scheme.Id}/overview"),
            };
            return new LibraryDocumentDto(
                d.Id.ToString(), d.Version, d.Title, file.Name, file.ContentType, file.SizeBytes, d.Category, [d.SchemeId.ToString()], [link],
                d.Visibility, d.UploadedAt.ToString("O"), d.UploadedBy, d.ExpiresOn?.ToString("yyyy-MM-dd"), d.Notes,
                d.ArchivedAt is { } at ? new ArchivedDto(at.ToString("O"), d.ArchivedBy ?? "", d.ArchiveReason ?? "") : null);
        }).ToList();
    }
}
