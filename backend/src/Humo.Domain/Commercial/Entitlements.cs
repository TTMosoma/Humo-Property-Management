using System.Collections.Frozen;
using System.Globalization;
using System.Text.Json;

namespace Humo.Domain.Commercial;

public sealed record FeatureDef(string Key, string Module, string Label, string Description, bool Baseline);

/// <summary>A named collection of features. A package may build on another (<c>Extends</c>).</summary>
public sealed record PackageDef(string Id, string Product, string Name, string Tagline, string? Extends, List<string> Features);

/// <summary>An add-on as the entitlement engine needs it: which features it switches on.</summary>
public sealed record AddOnFeatures(string Id, string Name, IReadOnlyList<string> Features);

/// <summary>A per-customer exception: a trial, a goodwill grant, or switching something off.</summary>
public sealed record FeatureOverride(string Feature, bool Enabled, string Reason, string By, string At, string? ExpiresAt = null);

public sealed record SubscriptionAddOn(string AddOnId, string Since);

/// <summary>The customer's subscription as the frontend knows it (domain/models/entitlement.ts).</summary>
public sealed record SubscriptionView(string OrganisationId, int Version, string PackageId, string Status, string StartedAt, string RenewsAt,
    IReadOnlyList<SubscriptionAddOn> AddOns, IReadOnlyList<FeatureOverride> Overrides, decimal Mrr, int Seats);

public sealed record Entitlement(string Feature, bool Enabled, string Source, string SourceLabel);

public static class SubscriptionStatuses
{
    public const string Trial = "trial";
    public const string Active = "active";
    public const string PastDue = "past-due";
    public const string Suspended = "suspended";
    public const string Cancelled = "cancelled";
    public static readonly FrozenSet<string> All = new[] { Trial, Active, PastDue, Suspended, Cancelled }.ToFrozenSet();
}

/// <summary>
/// Features and packages, read from <c>contracts/entitlements.json</c>: the same catalogue the
/// frontend uses, so the two can't drift. Nothing asks "is this customer Enterprise?": code asks
/// whether a feature is on (docs/04).
/// </summary>
public static class EntitlementCatalogue
{
    public static IReadOnlyList<FeatureDef> Features { get; }
    public static IReadOnlyList<PackageDef> Packages { get; }
    public static FrozenSet<string> FeatureKeys { get; }

    static EntitlementCatalogue()
    {
        using var stream = typeof(EntitlementCatalogue).Assembly.GetManifestResourceStream("Humo.Domain.entitlements.json")
            ?? throw new InvalidOperationException("contracts/entitlements.json isn't embedded in Humo.Domain.");
        var contract = JsonSerializer.Deserialize<Contract>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("contracts/entitlements.json is empty.");
        Features = contract.Features;
        Packages = contract.Packages;
        FeatureKeys = Features.Select(f => f.Key).ToFrozenSet();
        var unknown = Packages.SelectMany(p => p.Features).Where(f => !FeatureKeys.Contains(f)).Distinct().ToList();
        if (unknown.Count > 0) throw new InvalidOperationException($"Packages name unknown features: {string.Join(", ", unknown)}");
    }

    public static PackageDef? Package(string id) => Packages.FirstOrDefault(p => p.Id == id);

    public static bool IsPackage(string? id) => id is not null && Packages.Any(p => p.Id == id);

    /// <summary>Every feature a package includes, following <c>Extends</c>.</summary>
    public static HashSet<string> PackageFeatures(string id)
    {
        var pkg = Package(id);
        if (pkg is null) return [];
        var all = pkg.Extends is { } parent ? PackageFeatures(parent) : [];
        all.UnionWith(pkg.Features);
        return all;
    }

    private sealed record Contract(List<FeatureDef> Features, List<PackageDef> Packages);
}

/// <summary>
/// The entitlement engine, rule for rule as <c>resolveEntitlements()</c> in the frontend:
/// 1. the package (with inheritance), 2. add-ons, 3. unexpired overrides (the last word).
/// A suspended or cancelled subscription keeps only the baseline security features.
/// </summary>
public static class EntitlementEngine
{

    public static List<Entitlement> Resolve(SubscriptionView? sub, DateTimeOffset now, IEnumerable<AddOnFeatures> addOns)
    {
        var map = new Dictionary<string, Entitlement>();
        var fromPackage = sub is null ? [] : EntitlementCatalogue.PackageFeatures(sub.PackageId);
        var packageName = sub is null ? "" : EntitlementCatalogue.Package(sub.PackageId)?.Name ?? sub.PackageId;
        foreach (var f in EntitlementCatalogue.Features)
            map[f.Key] = fromPackage.Contains(f.Key) ? new(f.Key, true, "package", packageName) : new(f.Key, false, "none", "Not included");

        var catalogue = addOns.ToList();
        foreach (var a in sub?.AddOns ?? [])
        {
            if (catalogue.FirstOrDefault(x => x.Id == a.AddOnId) is not { } def) continue;
            foreach (var f in def.Features)
                if (map.TryGetValue(f, out var e) && !e.Enabled) map[f] = new(f, true, "add-on", $"{def.Name} add-on");
        }

        foreach (var o in sub?.Overrides ?? [])
        {
            if (!map.ContainsKey(o.Feature)) continue;
            DateTimeOffset? expires = o.ExpiresAt is null ? null : DateTimeOffset.Parse(o.ExpiresAt, CultureInfo.InvariantCulture);
            if (expires < now) continue;
            var until = expires is { } x ? $" until {x.ToOffset(TimeSpan.FromHours(2)).ToString("d MMM", CultureInfo.InvariantCulture)}" : "";
            map[o.Feature] = new(o.Feature, o.Enabled, "override", o.Enabled ? $"Granted{until} · {o.Reason}" : $"Switched off · {o.Reason}");
        }

        if (sub is { Status: SubscriptionStatuses.Suspended or SubscriptionStatuses.Cancelled })
            foreach (var f in EntitlementCatalogue.Features.Where(f => !f.Baseline))
                map[f.Key] = new(f.Key, false, "none", $"Subscription {sub.Status}");

        return EntitlementCatalogue.Features.Select(f => map[f.Key]).ToList();
    }
}
