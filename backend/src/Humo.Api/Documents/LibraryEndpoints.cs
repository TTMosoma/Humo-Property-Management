using Humo.Api.Commands;
using Humo.Api.Files;
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
/// The document library on the API (docs/18 R-11): documents on schemes, with their PDF checked and stored (see
/// <see cref="PdfIntake"/>). Reading and changing need the document permissions and the scheme. Documents on units,
/// people, suppliers, jobs and meetings come in a later slice, and so do the owners' and trustees' own views.
/// </summary>
public static class LibraryEndpoints
{
    public static readonly string[] Categories = ["insurance", "certificate", "vetting", "rules", "minutes", "financial", "contract", "plans", "correspondence", "quote", "photo", "other"];
    public static readonly string[] Visibilities = ["staff", "trustees", "owners"];

    public static void MapLibrary(this RouteGroupBuilder g)
    {
        g.MapGet("/library", List);
        g.MapGet("/library/{id:guid}", Get);
        g.MapPost("/library", Upload);
        g.MapPost("/library/{id:guid}/actions", Act);
        g.MapGet("/library/{id:guid}/link", Link);
    }

    private static async Task<IResult> List(HttpRequest request, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Documents.View")) return Problems.Policy("forbidden", "Role does not have this permission");
        // schemeIds=… (the library), or record=scheme:{id} (one scheme's documents).
        var asked = request.Query["schemeIds"].SelectMany(v => (v ?? "").Split(',')).Concat(
            request.Query["record"].Select(v => v ?? "").Where(v => v.StartsWith("scheme:")).Select(v => v["scheme:".Length..]))
            .Where(v => Guid.TryParse(v, out _)).Select(Guid.Parse).ToHashSet();
        var schemeIds = asked.Where(actor.CoversScheme).ToList();
        if (schemeIds.Count == 0) return Results.Ok(Array.Empty<LibraryDocumentDto>());

        var documents = await db.LibraryDocuments.AsNoTracking().Where(d => schemeIds.Contains(d.SchemeId)).ToListAsync(ct);
        var dtos = await DtosAsync(documents, db, ct);
        return Results.Ok(dtos.OrderByDescending(d => d.UploadedAt).ToList());
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Documents.View")) return Problems.Policy("forbidden", "Role does not have this permission");
        var document = await db.LibraryDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id, ct);
        if (document is null || !actor.CoversScheme(document.SchemeId)) return Problems.NotFound();
        return Results.Ok((await DtosAsync([document], db, ct))[0]);
    }

    /// <summary>A PDF on a scheme, with its title, category, who may open it and when it lapses.</summary>
    private static async Task<IResult> Upload(HttpRequest request, CurrentActor current, CommandRunner commands, HumoDbContext db, IFileStore store,
        IFileScanner scanner, IOptions<FilesOptions> options, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var form = await request.ReadFormAsync(ct);
        if (!Guid.TryParse(form["schemeId"], out var schemeId)) return Problems.Validation(new() { ["schemeId"] = "Choose the scheme for this document." });
        if (await db.Schemes.AsNoTracking().FirstOrDefaultAsync(s => s.Id == schemeId, ct) is not { } scheme || !actor.CoversScheme(schemeId))
            return Problems.NotFound();

        var title = form["title"].ToString().Trim();
        var category = form["category"].ToString();
        var visibility = form["visibility"].ToString();
        var errors = Check(title, category, visibility, form["expiresAt"].ToString());
        if (errors.Count > 0) return Problems.Validation(errors);

        var (accepted, refusal) = await PdfIntake.CheckAsync(form.Files.FirstOrDefault(), options.Value.MaxBytes, scanner, ct);
        if (refusal is not null) return refusal;

        return await commands.RunAsync(new CommandSpec($"Uploaded {title} to {scheme.Name}", "Documents.Manage")
        {
            Resource = "Document",
            ResourceId = title,
            SchemeId = schemeId,
            Category = "documents",
        }, async writer =>
        {
            var key = await store.SaveAsync(accepted!.Bytes, ct);
            var fileId = Guid.CreateVersion7();
            db.UploadedFiles.Add(new UploadedFile
            {
                Id = fileId, OrganisationId = scheme.OrganisationId, SchemeId = schemeId, Name = accepted.Name, ContentType = "application/pdf",
                SizeBytes = accepted.Bytes.Length, Sha256 = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(accepted.Bytes)),
                StorageKey = key, ScanResult = "clean", UploadedBy = writer.Human.Name, UploadedAt = clock.GetUtcNow(),
            });
            var id = Guid.CreateVersion7();
            db.LibraryDocuments.Add(new LibraryDocument
            {
                Id = id, OrganisationId = scheme.OrganisationId, SchemeId = schemeId, FileId = fileId, Title = title, Category = category, Visibility = visibility,
                ExpiresOn = ParseDate(form["expiresAt"].ToString()), Notes = Notes(form["notes"].ToString()), Version = 1, UploadedBy = writer.Human.Name,
                UploadedAt = clock.GetUtcNow(),
            });
            return Results.Ok(new { id = id.ToString() });
        }, ct);
    }

    /// <summary>Edit, archive or restore. The version the screen saw must be the current one.</summary>
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
                errors = Check(body.Title?.Trim() ?? "", body.Category ?? "", body.Visibility ?? "", body.ExpiresAt ?? "");
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

    /// <summary>A link to open the document's file: for this person, for a few minutes, while they can see the scheme.</summary>
    private static async Task<IResult> Link(Guid id, CurrentActor current, HumoDbContext db, IOptions<FilesOptions> options, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Documents.View")) return Problems.Policy("forbidden", "Role does not have this permission");
        var document = await db.LibraryDocuments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id, ct);
        if (document is null || !actor.CoversScheme(document.SchemeId)) return Problems.NotFound();

        var expires = clock.GetUtcNow() + options.Value.LinkLifetime;
        var signature = SignedLinks.Sign(options.Value.SigningKey!, SignedLinks.Payload(document.FileId, actor.User.Id, expires));
        return Results.Ok(new FileLinkDto($"/api/files/{document.FileId:N}/content?exp={expires.ToUnixTimeSeconds()}&sig={signature}", expires.ToString("O")));
    }

    private static Dictionary<string, string> Check(string title, string category, string visibility, string expiresAt)
    {
        var errors = new Dictionary<string, string>();
        if (title.Length == 0) errors["title"] = "Give the document a title.";
        else if (title.Length > 200) errors["title"] = "Keep the title to 200 characters.";
        if (!Categories.Contains(category)) errors["category"] = "Choose a category.";
        if (!Visibilities.Contains(visibility)) errors["visibility"] = "Choose who can open it.";
        if (expiresAt.Length > 0 && ParseDate(expiresAt) is null) errors["expiresAt"] = "Use a date, such as 2027-03-31.";
        return errors;
    }

    private static DateOnly? ParseDate(string value) =>
        DateOnly.TryParseExact(value, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var date) ? date : null;

    private static string? Notes(string value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim()[..Math.Min(value.Trim().Length, 2000)];

    private static async Task<List<LibraryDocumentDto>> DtosAsync(IReadOnlyCollection<LibraryDocument> documents, HumoDbContext db, CancellationToken ct)
    {
        var fileIds = documents.Select(d => d.FileId).ToList();
        var files = await db.UploadedFiles.AsNoTracking().Where(f => fileIds.Contains(f.Id)).ToDictionaryAsync(f => f.Id, ct);
        var schemeIds = documents.Select(d => d.SchemeId).Distinct().ToList();
        var schemes = await db.Schemes.AsNoTracking().Where(s => schemeIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, ct);
        return documents.Select(d =>
        {
            var file = files[d.FileId];
            var scheme = schemes[d.SchemeId];
            return new LibraryDocumentDto(
                d.Id.ToString(), d.Version, d.Title, file.Name, file.ContentType, file.SizeBytes, d.Category, [d.SchemeId.ToString()],
                [new LibraryLinkDto("scheme", scheme.Id.ToString(), scheme.Name, $"/schemes/{scheme.Id}/overview")],
                d.Visibility, d.UploadedAt.ToString("O"), d.UploadedBy, d.ExpiresOn?.ToString("yyyy-MM-dd"), d.Notes,
                d.ArchivedAt is { } at ? new ArchivedDto(at.ToString("O"), d.ArchivedBy ?? "", d.ArchiveReason ?? "") : null);
        }).ToList();
    }
}
