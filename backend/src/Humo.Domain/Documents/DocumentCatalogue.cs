using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Humo.Domain.Documents;

// The shapes match frontend/humo-web/src/app/domain/models/document.ts (camelCase on the wire).

public sealed record TemplatePalette(string Primary, string Accent);

public sealed record DocumentLogo(string Kind, string Text);

public sealed record AgencyBranding(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DocumentLogo? Logo,
    TemplatePalette Palette,
    string Font);

public sealed record DocumentContact(string Email, string Phone);

/// <summary>Everything a template version may change, as data (see <c>TemplateDesign</c> in the app).</summary>
public sealed record TemplateDesign(
    string Layout,
    string BrandingMode,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] TemplatePalette? Palette,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Font,
    List<string> Sections,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Title,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? FooterText,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? LegalText,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? NumberPrefix);

public sealed record ClientApproval(string ApprovedBy, string ApprovedOn);

public sealed record TemplateVersion(
    int Version,
    string Status,
    TemplateDesign Design,
    string Notes,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PublishedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PublishedBy,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ClientApproval? ClientApproval);

public sealed record DocumentTemplate(
    string Id,
    string DocumentType,
    string Name,
    string Description,
    string Purpose,
    string Tier,
    string Status,
    bool IsDefault,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? OrganisationId,
    int CurrentVersion,
    List<TemplateVersion> Versions,
    int Version)
{
    public TemplateVersion? At(int? version = null) => Versions.FirstOrDefault(v => v.Version == (version ?? CurrentVersion));
}

/// <summary>The look a document is finally drawn with (Humo → agency → template). Snapshotted into every issued document.</summary>
public sealed record ResolvedBranding(
    TemplatePalette Palette,
    string Font,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DocumentLogo? Logo,
    string Source);

/// <summary>
/// Humo's built-in document templates, read from <c>contracts/document-templates.json</c>: the same
/// catalogue the app uses (its contract test fails if they drift). The rules here are the app's
/// <c>templateAvailability</c> and <c>resolveBranding</c>, rule for rule.
/// </summary>
public static partial class DocumentCatalogue
{
    public static IReadOnlyList<DocumentTemplate> Platform { get; }

    /// <summary>Tier → the feature that unlocks it (null: every customer).</summary>
    public static readonly IReadOnlyDictionary<string, string?> TierFeatures = new Dictionary<string, string?>
    {
        ["standard"] = null,
        ["premium"] = "document-templates-premium",
        ["custom"] = "document-templates-custom",
    };

    public static readonly ResolvedBranding Humo = new(new TemplatePalette("#041b40", "#1d7a52"), "dm-sans", null, "humo");

    public static readonly IReadOnlySet<string> Fonts = new HashSet<string> { "dm-sans", "outfit", "serif" };

    static DocumentCatalogue()
    {
        using var stream = typeof(DocumentCatalogue).Assembly.GetManifestResourceStream("Humo.Domain.document-templates.json")
            ?? throw new InvalidOperationException("contracts/document-templates.json isn't embedded in Humo.Domain.");
        var contract = JsonSerializer.Deserialize<Contract>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("contracts/document-templates.json is empty.");
        Platform = contract.Templates;
    }

    public static DocumentTemplate? Get(string id) => Platform.FirstOrDefault(t => t.Id == id);

    /// <summary>available, locked, planned or deprecated: by status and the tier's entitlement only, never the package name.</summary>
    public static string Availability(DocumentTemplate t, Func<string, bool> entitled) =>
        t.Status switch
        {
            "planned" => "planned",
            "deprecated" => "deprecated",
            _ => TierFeatures.GetValueOrDefault(t.Tier) is { } feature && !entitled(feature) ? "locked" : "available",
        };

    /// <summary>The organisation's default for a type if it may still use it; otherwise Humo's default.</summary>
    public static DocumentTemplate? DefaultFor(string type, string? chosen, Func<string, bool> entitled)
    {
        var options = Platform.Where(t => t.DocumentType == type).ToList();
        return options.FirstOrDefault(t => t.Id == chosen && Availability(t, entitled) == "available") ?? options.FirstOrDefault(t => t.IsDefault);
    }

    /// <summary>Humo defaults → agency branding (if the template uses it and the agency is entitled) → the template's own design.</summary>
    public static ResolvedBranding Branding(TemplateDesign design, AgencyBranding? agency, Func<string, bool> entitled)
    {
        if (design.BrandingMode == "template" && design.Palette is { } palette)
            return new ResolvedBranding(palette, design.Font ?? Humo.Font, agency?.Logo, "template");
        if (design.BrandingMode == "agency" && agency is not null && entitled("document-branding"))
            return new ResolvedBranding(agency.Palette, design.Font ?? agency.Font, agency.Logo, "agency");
        return Humo;
    }

    public static bool IsHexColour(string? s) => s is not null && HexColour().IsMatch(s);

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColour();

    private sealed record Contract(List<DocumentTemplate> Templates);
}
