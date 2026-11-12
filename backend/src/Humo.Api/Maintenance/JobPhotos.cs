using System.Security.Cryptography;
using Humo.Api.Commands;
using Humo.Api.Commercial;
using Humo.Domain.Access;
using Humo.Domain.Maintenance;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Files;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Maintenance;

/// <summary>
/// The checks every uploaded photo passes before it's stored: it's a JPEG, PNG or WebP by its content, not its name;
/// within the size limit; and a malware scan finds nothing. A file that fails any check is refused, and nothing is stored.
/// </summary>
public static class ImageIntake
{
    public sealed record Accepted(byte[] Bytes, string Name, string ContentType);

    public static async Task<(Accepted? File, IResult? Refusal)> CheckAsync(IFormFile? file, int maxBytes, IFileScanner scanner, CancellationToken ct)
    {
        var tooLarge = Problems.Validation(new() { ["file"] = $"That photo is larger than {maxBytes / 1024 / 1024} MB." });
        if (file is null) return (null, Problems.Validation(new() { ["file"] = "Choose a photo to upload." }));
        if (file.Length > maxBytes) return (null, tooLarge);

        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer, ct);
        var bytes = buffer.ToArray();
        if (bytes.Length > maxBytes) return (null, tooLarge);

        var type = TypeOf(bytes);
        if (type is null)
            return (null, Problems.Validation(new() { ["file"] = IsHeic(bytes)
                ? "That’s an HEIC photo, which most browsers can’t show. On an iPhone, choose it from Photos in the browser, or set the camera to Most Compatible."
                : "Only JPEG, PNG or WebP photos can be uploaded." }));
        var name = Path.GetFileName(file.FileName) is { Length: > 0 } n ? n[..Math.Min(n.Length, 200)] : "photo";

        // A file that can't be checked isn't stored: the scanner has to answer first.
        ScanResult scan;
        try { scan = await scanner.ScanAsync(bytes, ct); }
        catch (ScannerUnavailableException)
        {
            return (null, Results.Problem(title: "The photo can’t be checked for viruses right now, so it wasn’t stored. Try again shortly.", statusCode: StatusCodes.Status503ServiceUnavailable));
        }
        if (!scan.Clean)
            return (null, Results.Problem(title: $"The photo was refused: {scan.Threat} was found in it.", statusCode: StatusCodes.Status422UnprocessableEntity,
                extensions: new Dictionary<string, object?> { ["code"] = "infected" }));

        return (new Accepted(bytes, name, type), null);
    }

    private static string? TypeOf(byte[] b) =>
        b.AsSpan().StartsWith(new byte[] { 0xFF, 0xD8, 0xFF }) ? "image/jpeg"
        : b.AsSpan().StartsWith(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }) ? "image/png"
        : b.Length >= 12 && b.AsSpan(0, 4).SequenceEqual("RIFF"u8) && b.AsSpan(8, 4).SequenceEqual("WEBP"u8) ? "image/webp"
        : null;

    private static bool IsHeic(byte[] b) => b.Length >= 12 && b.AsSpan(4, 4).SequenceEqual("ftyp"u8) && b.AsSpan(8, 4) is var brand
        && (brand.SequenceEqual("heic"u8) || brand.SequenceEqual("heix"u8) || brand.SequenceEqual("mif1"u8) || brand.SequenceEqual("hevc"u8));
}

/// <summary>
///   POST /jobs/{ref}/photos             a photo of the problem (report) or of the finished work (completion), as multipart
///   GET  /jobs/{ref}/photos/{photoId}   the image, for whoever can see the job
///   DELETE /jobs/{ref}/photos/{photoId} added by mistake: the file goes too, and frees its storage
/// A photo is an uploaded file like any other: scanned, stored under a random key, and counted against the agency's storage (D20).
/// </summary>
public static class JobPhotoEndpoints
{
    public const int MaxPerJob = 20;

    public static void MapJobPhotos(this IEndpointRouteBuilder api)
    {
        var j = api.MapGroup("/jobs").RequireAuthorization();
        j.MapPost("/{reference}/photos", Add);
        j.MapGet("/{reference}/photos/{photoId}", Get);
        j.MapDelete("/{reference}/photos/{photoId}", Remove);
        j.MapGet("/{reference}/quotes/{quoteId}/file", QuoteFile);
    }

    /// <summary>Staff who can see the job (Maintenance.View, in their schemes); a resident, for a job they reported or one on their unit.</summary>
    private static async Task<JobRow?> ReadableAsync(Actor actor, HumoDbContext db, string reference, CancellationToken ct)
    {
        if (actor.OrganisationId is not { } org) return null;
        var row = await db.Jobs.FirstOrDefaultAsync(x => x.OrganisationId == org && x.Ref == reference, ct);
        if (row is null) return null;
        if (actor.Can("Maintenance.View")) return await Portfolio.SchemeEndpoints.Visible(actor, db).AnyAsync(s => s.Id == row.SchemeId, ct) ? row : null;
        if (!actor.Can("Resident.Requests") || !Guid.TryParse(actor.User.PersonId, out var person)) return null;
        if (row.ReportedByPersonId == person) return row;
        var units = await db.Relationships.Where(r => r.PersonId == person && r.UnitId != null && (r.Type == "owner" || r.Type == "tenant")).Select(r => r.UnitId!.Value).ToListAsync(ct);
        return row.UnitId is { } unit && units.Contains(unit) ? row : null;
    }

    private static async Task<IResult> Add(string reference, HttpRequest request, CurrentActor current, CommandRunner commands, HumoDbContext db, IFileStore store, IFileScanner scanner,
        IOptions<FilesOptions> options, PackageLimits limits, Platform.Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await ReadableAsync(actor, db, reference, ct) is not { } row) return Problems.NotFound();
        var form = await request.ReadFormAsync(ct);
        var resident = actor.Assignment.Role is Roles.Owner or Roles.Tenant;
        // Residents show the problem; the finished work is the agency's to record.
        var stage = resident ? "report" : form["stage"].ToString() is "completion" ? "completion" : "report";
        var caption = form["caption"].ToString().Trim();
        var (accepted, refusal) = await ImageIntake.CheckAsync(form.Files.FirstOrDefault(), options.Value.MaxBytes, scanner, ct);
        if (refusal is not null) return refusal;
        var file = accepted!;
        if (await limits.RefuseNewFileAsync(row.OrganisationId, file.Bytes.Length, ct) is { } full) return Problems.Validation(new() { ["file"] = full });
        var job = MaintenanceService.Read(row);

        return await commands.RunAsync(new CommandSpec($"Added a photo to {reference}{(stage == "completion" ? " (finished work)" : "")}: {file.Name}",
            resident ? "Resident.Requests" : stage == "completion" ? "Maintenance.Manage" : "Maintenance.Log")
        {
            Resource = "Job",
            ResourceId = reference,
            SchemeId = row.SchemeId,
            Feature = "maintenance-basic",
            Validate = () => job.Photos.Count >= MaxPerJob ? new() { ["file"] = $"A job holds up to {MaxPerJob} photos." }
                : caption.Length > 120 ? new() { ["caption"] = "Keep the caption under 120 characters." } : [],
        }, async writer =>
        {
            var key = await store.SaveAsync(file.Bytes, ct);
            var fileId = Guid.CreateVersion7();
            var now = clock.GetUtcNow();
            db.UploadedFiles.Add(new UploadedFile
            {
                Id = fileId, OrganisationId = row.OrganisationId, SchemeId = row.SchemeId, Name = file.Name, ContentType = file.ContentType, SizeBytes = file.Bytes.Length,
                Sha256 = Convert.ToHexStringLower(SHA256.HashData(file.Bytes)), StorageKey = key, ScanResult = "clean", UploadedBy = writer.Human.Name, UploadedAt = now,
            });
            var id = $"{reference}-{(stage == "completion" ? "c" : "p")}{job.Photos.Count + 1}";
            job.Photos.Add(new JobPhoto
            {
                Id = id, Caption = caption.Length > 0 ? caption : Path.GetFileNameWithoutExtension(file.Name), TakenAt = now.ToString("O"), By = writer.Human.Name, Stage = stage,
                FileId = fileId.ToString(), AddedById = writer.User.Id.ToString(),
            });
            MaintenanceService.Write(row, job);
            // The storage warning at 80% (D20), counted with this photo.
            await limits.NotifyAsync(row.OrganisationId, notices, writer.Human.Id, ct, extraBytes: file.Bytes.Length);
            return Results.Created($"/api/jobs/{reference}/photos/{id}", new { id });
        }, ct);
    }

    /// <summary>Staff remove any photo on a job they can see; a resident only one they added themselves.</summary>
    private static async Task<IResult> Remove(string reference, string photoId, CurrentActor current, CommandRunner commands, HumoDbContext db, IFileStore store, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await ReadableAsync(actor, db, reference, ct) is not { } row) return Problems.NotFound();
        var job = MaintenanceService.Read(row);
        var photo = job.Photos.FirstOrDefault(p => p.Id == photoId);
        var resident = actor.Assignment.Role is Roles.Owner or Roles.Tenant;
        if (photo is null || (resident && photo.AddedById != actor.User.Id.ToString())) return Problems.NotFound();
        var file = Guid.TryParse(photo.FileId, out var fid) ? await db.UploadedFiles.FirstOrDefaultAsync(f => f.Id == fid && f.SchemeId == row.SchemeId, ct) : null;

        return await commands.RunAsync(new CommandSpec($"Removed a photo from {reference}: {photo.Caption}",
            resident ? "Resident.Requests" : photo.Stage == "completion" ? "Maintenance.Manage" : "Maintenance.Log")
        {
            Resource = "Job",
            ResourceId = reference,
            SchemeId = row.SchemeId,
            Feature = "maintenance-basic",
        }, _ =>
        {
            job.Photos.Remove(photo);
            MaintenanceService.Write(row, job);
            if (file is not null)
            {
                db.UploadedFiles.Remove(file);
                // Only once the change is saved: a file that fails to go is left over, never a photo that points at nothing.
                commands.AfterCommit(() => store.DeleteAsync(file.StorageKey, ct));
            }
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>D38: the supplier's own quote document, sent through their link. Staff who can see the job.</summary>
    private static async Task<IResult> QuoteFile(string reference, string quoteId, CurrentActor current, HumoDbContext db, IFileStore store, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Maintenance.View") || await ReadableAsync(actor, db, reference, ct) is not { } row) return Problems.NotFound();
        if (MaintenanceService.Read(row).Quotes.FirstOrDefault(q => q.Id == quoteId)?.FileId is not { } fid || !Guid.TryParse(fid, out var fileId)) return Problems.NotFound();
        var file = await db.UploadedFiles.AsNoTracking().FirstOrDefaultAsync(f => f.Id == fileId && f.SchemeId == row.SchemeId, ct);
        if (file is null || file.ScanResult != "clean") return Problems.NotFound();
        return Results.File(await store.OpenAsync(file.StorageKey, ct), "application/pdf", file.Name);
    }

    private static async Task<IResult> Get(string reference, string photoId, HttpContext http, CurrentActor current, HumoDbContext db, IFileStore store, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await ReadableAsync(actor, db, reference, ct) is not { } row) return Problems.NotFound();
        var photo = MaintenanceService.Read(row).Photos.FirstOrDefault(p => p.Id == photoId);
        if (photo?.FileId is not { } fid || !Guid.TryParse(fid, out var fileId)) return Problems.NotFound();
        var file = await db.UploadedFiles.AsNoTracking().FirstOrDefaultAsync(f => f.Id == fileId && f.SchemeId == row.SchemeId, ct);
        if (file is null || file.ScanResult != "clean" || !file.ContentType.StartsWith("image/", StringComparison.Ordinal)) return Problems.NotFound();

        http.Response.Headers.CacheControl = "private, max-age=300";
        http.Response.Headers.XContentTypeOptions = "nosniff";
        return Results.Stream(await store.OpenAsync(file.StorageKey, ct), file.ContentType);
    }
}
