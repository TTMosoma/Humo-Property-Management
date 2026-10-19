namespace Humo.Api.Portfolio;

/// <summary>Shared vocabulary and lifecycle rules for organisations and schemes (doc 24 §3–§4).</summary>
public static class PortfolioRules
{
    public static readonly string[] Provinces =
        ["Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo", "Mpumalanga", "North West", "Northern Cape", "Western Cape"];

    public static readonly string[] SchemeTypes = ["Sectional Title", "Home Owners Association", "Share Block"];

    /// <summary>onboarding → active / suspended / archived; active → suspended / archived; suspended → active / archived; archived → active.</summary>
    public static readonly IReadOnlyDictionary<string, string[]> OrganisationMoves = new Dictionary<string, string[]>
    {
        ["onboarding"] = ["active", "suspended", "archived"],
        ["active"] = ["suspended", "archived"],
        ["suspended"] = ["active", "archived"],
        ["archived"] = ["active"],
    };

    /// <summary>prospect → onboarding / archived; onboarding → active / archived; active → closed; closed → active / archived; archived → closed.</summary>
    public static readonly IReadOnlyDictionary<string, string[]> SchemeMoves = new Dictionary<string, string[]>
    {
        ["prospect"] = ["onboarding", "archived"],
        ["onboarding"] = ["active", "archived"],
        ["active"] = ["closed"],
        ["closed"] = ["active", "archived"],
        ["archived"] = ["closed"],
    };

    public static readonly IReadOnlyDictionary<string, string> SchemeStatusLabels = new Dictionary<string, string>
    {
        ["prospect"] = "Prospect", ["onboarding"] = "Onboarding", ["active"] = "Active", ["closed"] = "Closed", ["archived"] = "Archived",
    };

    public static readonly IReadOnlyDictionary<string, string> OrganisationVerbs = new Dictionary<string, string>
    {
        ["onboarding"] = "Moved to onboarding", ["active"] = "Activated", ["suspended"] = "Suspended", ["archived"] = "Archived",
    };

    public const string ReasonMessage = "Say why, in a few words. It goes in the audit log.";
}
