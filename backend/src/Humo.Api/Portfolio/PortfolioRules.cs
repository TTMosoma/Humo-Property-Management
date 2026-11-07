using Humo.Infrastructure.Data;

namespace Humo.Api.Portfolio;

/// <summary>Shared vocabulary and lifecycle rules for organisations and schemes (doc 24 §3–§4).</summary>
public static class PortfolioRules
{
    /// <summary>
    /// D36: the days after a unit's first owner when nobody owned it. A unit always has a registered owner, and ownership
    /// passes on the day the transfer is registered, so a gap means the dates were captured wrongly. <c>To</c> null: no owner since.
    /// </summary>
    public static List<(DateOnly From, DateOnly? To)> OwnerGaps(IEnumerable<Relationship> owners)
    {
        var spans = owners.Where(r => r.Type == "owner" && (r.Until is null || r.Until >= r.Since)).OrderBy(r => r.Since).ToList();
        var gaps = new List<(DateOnly, DateOnly?)>();
        if (spans.Count == 0) return gaps;
        DateOnly? coveredTo = spans[0].Until;
        foreach (var r in spans.Skip(1))
        {
            if (coveredTo is not { } end) break;
            if (r.Since > end.AddDays(1)) gaps.Add((end.AddDays(1), r.Since.AddDays(-1)));
            coveredTo = r.Until is { } u ? (u > end ? u : end) : null;
        }
        if (coveredTo is { } last) gaps.Add((last.AddDays(1), null));
        return gaps;
    }

    /// <summary>The first day a change leaves without an owner that had one before, if any.</summary>
    public static DateOnly? NewGap(IEnumerable<Relationship> before, IEnumerable<Relationship> after)
    {
        var old = OwnerGaps(before);
        return OwnerGaps(after).Where(a => !old.Any(b => b.From <= a.From && (b.To is null || (a.To is { } t && t <= b.To))))
            .Select(a => (DateOnly?)a.From).FirstOrDefault();
    }

    public static string GapMessage(DateOnly from, string unit) =>
        $"{unit} would have no owner on record from {from:d MMMM yyyy}. A unit always has an owner: to record a sale, add the buyer with “They replace the owner”, and the seller’s ownership ends the day before. For an owner who has died, add their estate the same way.";

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
