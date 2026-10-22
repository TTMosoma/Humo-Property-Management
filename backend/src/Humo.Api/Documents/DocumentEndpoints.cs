using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Settings;
using Humo.Domain.Commercial;
using Humo.Domain.Documents;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Documents;

public sealed record DocumentSettingsDto(string OrganisationId, int Version, Dictionary<string, string> Defaults, DocumentContact Contact, string? FooterText, AgencyBranding? Branding,
    string StatementDelivery);
public sealed record SetDefaultRequest(string TemplateId, int? ExpectedVersion);
public sealed record BrandingRequest(DocumentContact Contact, string? FooterText, AgencyBranding? Branding, string? StatementDelivery, int? ExpectedVersion);

/// <summary>
/// The document template registry as the signed-in organisation sees it (D12, docs/document-template-architecture.md):
/// Humo's catalogue, the organisation's default per document type, its contact details, footer and branding,
/// and how statements are delivered (D9: a secure portal link by default, or the PDF attached).
/// </summary>
public static class DocumentEndpoints
{
    public static readonly IReadOnlySet<string> DocumentTypes = DocumentCatalogue.Platform.Select(t => t.DocumentType).ToHashSet();

    public static void MapDocuments(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/documents").RequireAuthorization();
        g.MapLibrary();
        g.MapGet("/templates", Templates);
        g.MapGet("/settings", GetSettings);
        g.MapPut("/settings/defaults/{type}", SetDefault);
        g.MapPut("/settings/branding", UpdateBranding);
    }

    /// <summary>Humo's catalogue. Enterprise custom templates (D12) are added per organisation when Humo builds them.</summary>
    private static async Task<IResult> Templates(CurrentActor current, CancellationToken ct) =>
        await current.GetAsync(ct) is null ? Results.Unauthorized() : Results.Ok(DocumentCatalogue.Platform);

    private static async Task<IResult> GetSettings(CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } orgId }) return Problems.NotFound();
        return Results.Ok(await ReadAsync(db, orgId, ct));
    }

    /// <summary>The organisation's document settings; contact details fall back to the agency's own.</summary>
    internal static async Task<DocumentSettingsDto> ReadAsync(HumoDbContext db, Guid orgId, CancellationToken ct)
    {
        var row = await db.DocumentSettings.AsNoTracking().FirstOrDefaultAsync(s => s.OrganisationId == orgId, ct);
        var agency = row is null ? await db.AgencySettings.AsNoTracking().FirstOrDefaultAsync(s => s.OrganisationId == orgId, ct) : null;
        return new DocumentSettingsDto(orgId.ToString(), row?.Version ?? 0,
            row is null ? [] : JsonSerializer.Deserialize<Dictionary<string, string>>(row.DefaultsJson, Json.Options) ?? [],
            row is null ? new DocumentContact(agency?.Email ?? "", agency?.Phone ?? "") : new DocumentContact(row.ContactEmail, row.ContactPhone),
            row?.FooterText,
            row?.BrandingJson is { } b ? JsonSerializer.Deserialize<AgencyBranding>(b, Json.Options) : null,
            row?.StatementDelivery ?? "link");
    }

    /// <summary>Is a feature on for the organisation? Read once, used by the catalogue's rules.</summary>
    internal static async Task<Func<string, bool>> EntitledAsync(Commercial.CommercialRecords commercial, Guid orgId, CancellationToken ct)
    {
        if (await commercial.PlanAsync(orgId, ct) is not { } plan) return _ => true;
        var on = plan.Entitlements.Where(e => e.Enabled).Select(e => e.Feature).ToHashSet();
        return on.Contains;
    }

    private static async Task<IResult> SetDefault(string type, SetDefaultRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db,
        Commercial.CommercialRecords commercial, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } orgId }) return Problems.NotFound();
        var row = await db.DocumentSettings.FirstOrDefaultAsync(s => s.OrganisationId == orgId, ct);
        var template = DocumentCatalogue.Get(body.TemplateId ?? "");
        var entitled = await EntitledAsync(commercial, orgId, ct);
        var label = type.Replace('-', ' ');
        return await commands.RunAsync(new CommandSpec($"Set the default {label} template to {template?.Name ?? body.TemplateId}", "Documents.Configure")
        {
            Resource = "DocumentSettings",
            ResourceId = orgId.ToString(),
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = row?.Version ?? 0,
            // The same rule the registry shows: only templates this organisation may use.
            Validate = () => !DocumentTypes.Contains(type) || template is null || template.DocumentType != type ? new() { ["templateId"] = "Choose one of the templates listed." }
                : DocumentCatalogue.Availability(template, entitled) != "available" ? new() { ["templateId"] = $"{template.Name} isn’t available on your plan." }
                : [],
        }, async _ =>
        {
            row ??= await NewRowAsync(db, orgId, ct);
            var defaults = JsonSerializer.Deserialize<Dictionary<string, string>>(row.DefaultsJson, Json.Options) ?? [];
            defaults[type] = template!.Id;
            row.DefaultsJson = JsonSerializer.Serialize(defaults, Json.Options);
            row.Version++;
            return Results.NoContent();
        }, ct);
    }

    /// <summary>Branding is a paid capability: without document-branding the API keeps what's there and changes the contact details only.</summary>
    private static async Task<IResult> UpdateBranding(BrandingRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Commercial.CommercialRecords commercial,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } orgId }) return Problems.NotFound();
        var row = await db.DocumentSettings.FirstOrDefaultAsync(s => s.OrganisationId == orgId, ct);
        var branded = (await EntitledAsync(commercial, orgId, ct))("document-branding");
        var b = body.Branding;
        return await commands.RunAsync(new CommandSpec("Updated document contact details and branding", "Documents.Configure")
        {
            Resource = "DocumentSettings",
            ResourceId = orgId.ToString(),
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = row?.Version ?? 0,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (!SettingsEndpoints.IsEmail(body.Contact?.Email)) e["email"] = "Enter an email address like accounts@agency.co.za.";
                if (SettingsEndpoints.Digits(body.Contact?.Phone) < 9) e["phone"] = "Enter a phone number with its area code.";
                if ((body.FooterText?.Length ?? 0) > 200) e["footerText"] = "Keep the footer line under 200 characters.";
                if (body.StatementDelivery is not (null or "link" or "attachment")) e["statementDelivery"] = "A secure link to the portal, or the PDF attached.";
                if (branded && b is not null)
                {
                    if (!DocumentCatalogue.IsHexColour(b.Palette?.Primary)) e["primary"] = "Use a colour like #0a3d62.";
                    if (!DocumentCatalogue.IsHexColour(b.Palette?.Accent)) e["accent"] = "Use a colour like #1d7a52.";
                    if (!DocumentCatalogue.Fonts.Contains(b.Font ?? "")) e["font"] = "Choose one of the fonts listed.";
                    if (b.Logo is { } logo && (logo.Kind != "wordmark" || (logo.Text ?? "").Length > 24)) e["logo"] = "Keep the wordmark under 24 characters.";
                }
                return e;
            },
        }, async _ =>
        {
            row ??= await NewRowAsync(db, orgId, ct);
            row.ContactEmail = body.Contact.Email.Trim();
            row.ContactPhone = body.Contact.Phone.Trim();
            row.FooterText = string.IsNullOrWhiteSpace(body.FooterText) ? null : body.FooterText.Trim();
            if (branded && b is not null)
                row.BrandingJson = JsonSerializer.Serialize(b with { Logo = b.Logo is { } l ? l with { Text = l.Text.Trim() } : null }, Json.Options);
            if (body.StatementDelivery is { } delivery) row.StatementDelivery = delivery;
            row.Version++;
            return Results.NoContent();
        }, ct);
    }

    private static async Task<DocumentSetting> NewRowAsync(HumoDbContext db, Guid orgId, CancellationToken ct)
    {
        var agency = await db.AgencySettings.AsNoTracking().FirstOrDefaultAsync(s => s.OrganisationId == orgId, ct);
        var row = new DocumentSetting { OrganisationId = orgId, Version = 0, ContactEmail = agency?.Email ?? "", ContactPhone = agency?.Phone ?? "" };
        db.DocumentSettings.Add(row);
        return row;
    }
}
