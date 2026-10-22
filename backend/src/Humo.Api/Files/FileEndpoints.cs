using System.Net.Http.Headers;
using System.Security.Claims;
using Humo.Api.Commands;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Files;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Files;

public sealed record UploadedFileDto(string Id);
public sealed record FileLinkDto(string Url, string ExpiresAt);

/// <summary>
/// Uploaded files (docs/18 R-11). A PDF is accepted only when it has the PDF signature, is within the size limit and
/// passes the malware scan; then it's stored under a random key. Downloads go through a link that is signed for one
/// person, lasts a few minutes, and is checked against the scheme again when the file is served.
/// </summary>
public static class FileEndpoints
{
    public static void MapFiles(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/files").RequireAuthorization();
        g.MapPost("", Upload);
        g.MapGet("/{id:guid}/link", Link);
        g.MapGet("/{id:guid}/content", Content);
    }

    private static async Task<IResult> Upload(HttpRequest request, CurrentActor current, CommandRunner commands, HumoDbContext db, IFileStore store,
        IFileScanner scanner, IOptions<FilesOptions> options, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var form = await request.ReadFormAsync(ct);
        if (!Guid.TryParse(form["schemeId"], out var schemeId)) return Problems.Validation(new() { ["schemeId"] = "Choose the scheme for this file." });
        if (await db.Schemes.AsNoTracking().FirstOrDefaultAsync(s => s.Id == schemeId, ct) is not { } scheme || !actor.CoversScheme(schemeId))
            return Problems.NotFound();

        var (accepted, refusal) = await PdfIntake.CheckAsync(form.Files.FirstOrDefault(), options.Value.MaxBytes, scanner, ct);
        if (refusal is not null) return refusal;
        var (bytes, name) = (accepted!.Bytes, accepted.Name);

        return await commands.RunAsync(new CommandSpec($"Uploaded {name} to {scheme.Name}", "Documents.Manage")
        {
            Resource = "File",
            ResourceId = name,
            SchemeId = schemeId,
            Category = "documents",
        }, async writer =>
        {
            var key = await store.SaveAsync(bytes, ct);
            var id = Guid.CreateVersion7();
            db.UploadedFiles.Add(new UploadedFile
            {
                Id = id, OrganisationId = scheme.OrganisationId, SchemeId = schemeId, Name = name, ContentType = "application/pdf", SizeBytes = bytes.Length,
                Sha256 = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(bytes)), StorageKey = key, ScanResult = "clean",
                UploadedBy = writer.Human.Name, UploadedAt = clock.GetUtcNow(),
            });
            return Results.Ok(new UploadedFileDto(id.ToString()));
        }, ct);
    }

    /// <summary>A link for one person, lasting <c>Files:LinkLifetime</c>. Issued only while they can see the file.</summary>
    private static async Task<IResult> Link(Guid id, CurrentActor current, HumoDbContext db, IOptions<FilesOptions> options, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Documents.View")) return Problems.Policy("forbidden", "Role does not have this permission");
        var file = await db.UploadedFiles.AsNoTracking().FirstOrDefaultAsync(f => f.Id == id, ct);
        if (file is null || !actor.CoversScheme(file.SchemeId)) return Problems.NotFound();

        var expires = clock.GetUtcNow() + options.Value.LinkLifetime;
        var signature = SignedLinks.Sign(options.Value.SigningKey!, SignedLinks.Payload(id, actor.User.Id, expires));
        return Results.Ok(new FileLinkDto($"/api/files/{id:N}/content?exp={expires.ToUnixTimeSeconds()}&sig={signature}", expires.ToString("O")));
    }

    /// <summary>The file itself, for the person the link was issued to, while the link is in time.</summary>
    private static async Task<IResult> Content(Guid id, HttpContext http, CurrentActor current, HumoDbContext db, IFileStore store, IOptions<FilesOptions> options,
        TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var query = http.Request.Query;
        if (!long.TryParse(query["exp"], out var seconds) || query["sig"].ToString() is not { Length: > 0 } signature)
            return Problems.Policy("link-expired", "This link has expired or isn’t yours. Ask for a new one.");
        var expires = DateTimeOffset.FromUnixTimeSeconds(seconds);
        if (expires <= clock.GetUtcNow() || !actor.Can("Documents.View")
            || !SignedLinks.Verify(options.Value.SigningKey!, SignedLinks.Payload(id, actor.User.Id, expires), signature))
            return Problems.Policy("link-expired", "This link has expired or isn’t yours. Ask for a new one.");

        var file = await db.UploadedFiles.AsNoTracking().FirstOrDefaultAsync(f => f.Id == id, ct);
        if (file is null || !actor.CoversScheme(file.SchemeId) || file.ScanResult != "clean") return Problems.NotFound();

        http.Response.Headers.CacheControl = "private, no-store";
        http.Response.Headers.XContentTypeOptions = "nosniff";
        http.Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileName = file.Name }.ToString();
        return Results.Stream(await store.OpenAsync(file.StorageKey, ct), "application/pdf");
    }
}
