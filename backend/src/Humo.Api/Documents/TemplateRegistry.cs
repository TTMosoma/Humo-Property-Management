using System.Globalization;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Domain.Commercial;
using Humo.Domain.Documents;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Documents;

public sealed record TemplateUsageDto(DocumentTemplate Template, string? Owner, int DefaultFor, int EntitledCustomers);
public sealed record TemplateAdoptionDto(int Customers, int PremiumDefaults, int CustomTemplates, List<TemplateUsageDto> Usage);
public sealed record TemplateStatusRequest(string? Status, string? Reason, int? ExpectedVersion);
public sealed record NewCustomTemplateRequest(string? DocumentType);
public sealed record PublishVersionRequest(TemplateDesign? Design, string? Notes, ClientApproval? ClientApproval, int? ExpectedVersion);

/// <summary>
/// The document template registry (D12, D23): Humo's own templates from the contract file, with the statuses Humo has
/// moved them to, and each Enterprise customer's custom templates, which Humo builds and publishes. Statements, letters
/// and the agency's defaults all choose from here.
/// </summary>
public static class TemplateRegistry
{
    /// <summary>Humo's own templates, with any status Humo has moved them to.</summary>
    public static async Task<List<DocumentTemplate>> PlatformAsync(HumoDbContext db, CancellationToken ct)
    {
        var moved = await db.DocumentTemplates.AsNoTracking().Where(r => r.OrganisationId == null).ToDictionaryAsync(r => r.Id, ct);
        return DocumentCatalogue.Platform.Select(t => moved.TryGetValue(t.Id, out var r) ? t with { Status = r.Status, Version = r.Version } : t).ToList();
    }

    /// <summary>What an organisation chooses from: Humo's templates and its own custom ones.</summary>
    public static async Task<List<DocumentTemplate>> ForOrganisationAsync(HumoDbContext db, Guid organisationId, CancellationToken ct)
    {
        var custom = await db.DocumentTemplates.AsNoTracking().Where(r => r.OrganisationId == organisationId && r.Json != null).ToListAsync(ct);
        return [.. await PlatformAsync(db, ct), .. custom.Select(Read)];
    }

    public static DocumentTemplate Read(DocumentTemplateRow r) => JsonSerializer.Deserialize<DocumentTemplate>(r.Json!, Json.Options)!;

    private static void Write(DocumentTemplateRow r, DocumentTemplate t)
    {
        r.Json = JsonSerializer.Serialize(t, Json.Options);
        r.Status = t.Status;
        r.Version = t.Version;
    }

    public static void MapPlatformTemplates(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/platform/document-templates").RequireAuthorization();
        g.MapGet("", Adoption);
        g.MapPut("/{id}/status", SetStatus);
        g.MapPost("/{id}/versions", PublishVersion);
        api.MapPost("/platform/customers/{organisationId:guid}/document-templates", CreateCustom).RequireAuthorization();
    }

    /// <summary>Every template, Humo's and customers', with how many customers use each as their default and may use it.</summary>
    private static async Task<IResult> Adoption(CurrentActor current, HumoDbContext db, Commercial.CommercialRecords commercial, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor || !actor.IsHumo || !actor.Can("Platform.Customers.View")) return Problems.NotFound();
        var orgs = await db.Organisations.AsNoTracking().Where(o => o.Status != "archived").ToListAsync(ct);
        var defaults = (await db.DocumentSettings.AsNoTracking().ToListAsync(ct))
            .ToDictionary(s => s.OrganisationId, s => JsonSerializer.Deserialize<Dictionary<string, string>>(s.DefaultsJson, Json.Options) ?? []);
        var entitled = new Dictionary<Guid, Func<string, bool>>();
        foreach (var o in orgs) entitled[o.Id] = await DocumentEndpoints.EntitledAsync(commercial, o.Id, ct);
        var customRows = await db.DocumentTemplates.AsNoTracking().Where(r => r.OrganisationId != null && r.Json != null).ToListAsync(ct);
        var templates = (await PlatformAsync(db, ct)).Concat(customRows.Select(Read)).ToList();
        var names = orgs.ToDictionary(o => o.Id.ToString(), o => o.ShortName);

        string? DefaultOf(Guid org, string type) =>
            defaults.GetValueOrDefault(org)?.GetValueOrDefault(type) ?? templates.FirstOrDefault(t => t.DocumentType == type && t.IsDefault && t.OrganisationId is null)?.Id;

        var usage = templates.Select(t => new TemplateUsageDto(t,
            t.OrganisationId is { } owner ? names.GetValueOrDefault(owner, owner) : null,
            t.Status == "planned" ? 0 : orgs.Count(o => DefaultOf(o.Id, t.DocumentType) == t.Id),
            orgs.Count(o => (t.OrganisationId is null || t.OrganisationId == o.Id.ToString()) && DocumentCatalogue.Availability(t, entitled[o.Id]) == "available"))).ToList();
        var premiumDefaults = orgs.Count(o => templates.FirstOrDefault(t => t.Id == DefaultOf(o.Id, "levy-statement")) is { } t && t.Tier != "standard");
        return Results.Ok(new TemplateAdoptionDto(orgs.Count, premiumDefaults, templates.Count(t => t.Tier == "custom"), usage));
    }

    /// <summary>Moves one of Humo's own templates through planned → preview → active → deprecated.</summary>
    private static async Task<IResult> SetStatus(string id, TemplateStatusRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var t = (await PlatformAsync(db, ct)).FirstOrDefault(x => x.Id == id);
        if (t is null) return Problems.NotFound();
        var status = body.Status ?? "";
        return await commands.RunAsync(new CommandSpec($"Moved document template {t.Name} ({t.DocumentType}) to {status} — {body.Reason?.Trim()}", "Platform.Templates.Manage")
        {
            Resource = "DocumentTemplate",
            ResourceId = id,
            Category = "activity",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = t.Version,
            Validate = () =>
                !DocumentCatalogue.StatusMoves.TryGetValue(t.Status, out var moves) || !moves.Contains(status) ? new() { ["status"] = $"A {t.Status} template can’t move to {status}." }
                : status != "planned" && t.Versions.All(v => v.Status != "published") ? new() { ["status"] = "Publish a version of the layout first: there’s nothing to render yet." }
                : t.IsDefault && status == "deprecated" ? new() { ["status"] = "This is the default for its document type. Make another template the default first." }
                : (body.Reason ?? "").Trim().Length < 5 ? new() { ["reason"] = "Give a short reason for the audit log." } : [],
        }, async actor =>
        {
            var row = await db.DocumentTemplates.FirstOrDefaultAsync(r => r.Id == id, ct);
            if (row is null) db.DocumentTemplates.Add(row = new DocumentTemplateRow { Id = id, DocumentType = t.DocumentType });
            row.Status = status;
            row.Version = t.Version + 1;
            (row.UpdatedBy, row.UpdatedAt) = (actor.Human.Name, clock.GetUtcNow());
            return Results.NoContent();
        }, ct);
    }

    /// <summary>
    /// An Enterprise customer's own template (D23: Enterprise only, one included), set up from Humo's design for the type.
    /// Humo builds it from the customer's brief and publishes each version once they approve a proof.
    /// </summary>
    private static async Task<IResult> CreateCustom(Guid organisationId, NewCustomTemplateRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db,
        Commercial.CommercialRecords commercial, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        if (await db.Organisations.FirstOrDefaultAsync(o => o.Id == organisationId, ct) is not { } org) return Problems.NotFound();
        var type = body.DocumentType ?? "";
        var platform = await PlatformAsync(db, ct);
        // The branded layout where Humo has one (the agency's colours and font show), else the type's default.
        var bases = platform.Where(t => t.DocumentType == type && t.Versions.Any(v => v.Status == "published")).ToList();
        var basis = bases.FirstOrDefault(t => t.Tier == "premium") ?? bases.FirstOrDefault(t => t.IsDefault);
        var id = $"{organisationId}.{type}";
        var exists = await db.DocumentTemplates.AnyAsync(r => r.Id == id, ct);
        var entitled = await DocumentEndpoints.EntitledAsync(commercial, organisationId, ct);
        var label = type.Replace('-', ' ');

        return await commands.RunAsync(new CommandSpec($"Set up a custom {label} template for {org.ShortName}", "Platform.Customers.Manage")
        {
            Resource = "DocumentTemplate",
            ResourceId = id,
            OrganisationId = organisationId,
            Validate = () =>
                !DocumentEndpoints.DocumentTypes.Contains(type) || basis is null ? new() { ["documentType"] = $"Humo has no {label} layout to start from yet." }
                : exists ? new() { ["organisationId"] = $"{org.ShortName} already has a custom {label} template. Publish a new version of it instead." }
                : !entitled("document-templates-custom") ? new() { ["organisationId"] = $"Custom templates are for Humo Enterprise (D23). {org.ShortName} isn’t on Enterprise." }
                : [],
        }, actor =>
        {
            Commercial.CustomerEndpoints.OwnAccountOnly(actor, org);
            var design = basis!.At(basis.Versions.Where(v => v.Status == "published").Max(v => v.Version))!.Design with
            {
                BrandingMode = "template", Palette = new TemplatePalette("#041b40", "#1d7a52"), Font = "dm-sans",
            };
            var now = clock.GetUtcNow();
            var template = new DocumentTemplate(id, type, $"{org.ShortName} {label}", $"{org.ShortName}’s own {label}.", "Enterprise custom template, built by Humo (D12, D23).",
                "custom", "active", false, organisationId.ToString(), 1,
                [new TemplateVersion(1, "published", design, $"Set up from Humo’s {basis.Name} design.", now.ToString("O"), actor.Human.Name, null)], 1);
            var row = new DocumentTemplateRow { Id = id, OrganisationId = organisationId, DocumentType = type, UpdatedBy = actor.Human.Name, UpdatedAt = now };
            Write(row, template);
            db.DocumentTemplates.Add(row);
            return Task.FromResult(Results.Created($"/api/platform/document-templates/{id}", new { id }));
        }, ct);
    }

    /// <summary>
    /// D12: publishes a custom template's next version, only with the client's recorded proof approval and while the
    /// customer is still entitled. Earlier versions stay, retired, for documents already issued with them.
    /// </summary>
    private static async Task<IResult> PublishVersion(string id, PublishVersionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db,
        Commercial.CommercialRecords commercial, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var row = await db.DocumentTemplates.FirstOrDefaultAsync(r => r.Id == id && r.OrganisationId != null && r.Json != null, ct);
        if (row is null) return Problems.NotFound();
        var t = Read(row);
        var org = await db.Organisations.FirstAsync(o => o.Id == row.OrganisationId, ct);
        var entitled = await DocumentEndpoints.EntitledAsync(commercial, org.Id, ct);
        var today = DateOnly.FromDateTime(clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).DateTime);
        var next = t.Versions.Max(v => v.Version) + 1;
        var approval = body.ClientApproval;

        return await commands.RunAsync(new CommandSpec(
            $"Published version {next} of {t.Name} — client approval: {approval?.ApprovedBy?.Trim()} on {approval?.ApprovedOn}", "Platform.Customers.Manage")
        {
            Resource = "DocumentTemplate",
            ResourceId = id,
            OrganisationId = org.Id,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = t.Version,
            Validate = () =>
            {
                if (!entitled("document-templates-custom")) return new() { ["templateId"] = $"{org.ShortName} isn’t on Humo Enterprise any more, so its custom template can’t change (D23)." };
                if (body.Design is null) return new() { ["design"] = "Send the design to publish." };
                var e = DocumentCatalogue.ValidateDesign(body.Design);
                if (!body.Design.Layout.StartsWith($"{t.DocumentType}/", StringComparison.Ordinal)) e["layout"] = $"Choose a {t.DocumentType.Replace('-', ' ')} layout.";
                if (string.IsNullOrWhiteSpace(body.Notes)) e["notes"] = "Say what changed, for the version history.";
                if ((approval?.ApprovedBy ?? "").Trim().Length < 3) e["approvedBy"] = "Who at the client approved the proof?";
                if (!DateOnly.TryParseExact(approval?.ApprovedOn, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var on) || on > today)
                    e["approvedOn"] = "The date they approved it (not in the future).";
                return e;
            },
        }, actor =>
        {
            Commercial.CustomerEndpoints.OwnAccountOnly(actor, org);
            var now = clock.GetUtcNow();
            var published = t with
            {
                CurrentVersion = next,
                Version = t.Version + 1,
                Versions =
                [
                    .. t.Versions.Select(v => v.Status == "published" ? v with { Status = "retired" } : v),
                    new TemplateVersion(next, "published", body.Design!, body.Notes!.Trim(), now.ToString("O"), actor.Human.Name,
                        new ClientApproval(approval!.ApprovedBy.Trim(), approval.ApprovedOn)),
                ],
            };
            Write(row, published);
            (row.UpdatedBy, row.UpdatedAt) = (actor.Human.Name, now);
            return Task.FromResult(Results.Ok(new { version = next }));
        }, ct);
    }
}
