using System.Text.Json;
using Humo.Api.Commands;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Commercial;

/// <summary>
/// Humo's commercial records (docs/23): the catalogue, commercial settings, and each customer's
/// subscription and agreement. The rules are in <see cref="CommercialRules"/>; this loads and saves.
/// </summary>
public sealed class CommercialRecords(HumoDbContext db, TimeProvider clock)
{
    public const string CatalogueKey = "commercial-catalogue";
    public const string SettingsKey = "commercial-settings";
    /// <summary>A new account's trial (docs/21): its package, free, for this long.</summary>
    public static readonly TimeSpan TrialLength = TimeSpan.FromDays(30);

    private CommercialCatalogue? catalogue;

    public string Today => CommercialRules.Day(clock.GetUtcNow());

    /// <summary>The catalogue and settings, as stored (<see cref="SeedAsync"/> puts the initial catalogue there once).</summary>
    public async Task<CommercialCatalogue> CatalogueAsync(CancellationToken ct)
    {
        if (catalogue is not null) return catalogue;
        var rows = await db.PlatformSettings.Where(s => s.Key == CatalogueKey || s.Key == SettingsKey).ToListAsync(ct);
        var stored = rows.FirstOrDefault(r => r.Key == CatalogueKey);
        var settings = rows.FirstOrDefault(r => r.Key == SettingsKey);
        var initial = stored is null || settings is null ? InitialCatalogue.Load() : null;
        var cat = stored is null ? initial! : JsonSerializer.Deserialize<CommercialCatalogue>(stored.Value, Json.Options)!;
        cat.Settings = settings is null ? initial!.Settings : JsonSerializer.Deserialize<CommercialSettings>(settings.Value, Json.Options)!;
        cat.Settings.Version = settings?.Version ?? 1;
        return catalogue = cat;
    }

    /// <summary>At start-up: the initial catalogue and default settings, if there are none yet. Never overwrites.</summary>
    public static async Task SeedAsync(HumoDbContext db, CancellationToken ct = default)
    {
        var keys = await db.PlatformSettings.Where(s => s.Key == CatalogueKey || s.Key == SettingsKey).Select(s => s.Key).ToListAsync(ct);
        if (keys.Count == 2) return;
        var initial = InitialCatalogue.Load();
        if (!keys.Contains(CatalogueKey)) db.PlatformSettings.Add(new PlatformSetting { Key = CatalogueKey, Value = Serialise(new { initial.Packages, initial.AddOns }) });
        if (!keys.Contains(SettingsKey)) db.PlatformSettings.Add(new PlatformSetting { Key = SettingsKey, Value = Serialise(initial.Settings) });
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Saves packages and add-ons (the caller changed them in place).</summary>
    public async Task SaveCatalogueAsync(CommercialCatalogue cat, CancellationToken ct)
    {
        var row = await db.PlatformSettings.FirstAsync(s => s.Key == CatalogueKey, ct);
        row.Value = Serialise(new { cat.Packages, cat.AddOns });
        row.Version++;
    }

    public async Task SaveSettingsAsync(CommercialSettings settings, CancellationToken ct)
    {
        var row = await db.PlatformSettings.FirstAsync(s => s.Key == SettingsKey, ct);
        settings.Version = row.Version + 1;
        row.Value = Serialise(settings);
        row.Version = settings.Version;
        if (catalogue is not null) catalogue.Settings = settings;
    }

    public async Task<(Agreement Row, CommercialAgreement Agreement)?> AgreementAsync(Guid organisationId, CancellationToken ct)
    {
        var row = await db.Agreements.FirstOrDefaultAsync(a => a.OrganisationId == organisationId, ct);
        return row is null ? null : (row, Read(row));
    }

    public static CommercialAgreement Read(Agreement row)
    {
        var a = JsonSerializer.Deserialize<CommercialAgreement>(row.Document, Json.Options)!;
        a.Version = row.Version;
        return a;
    }

    /// <summary>Stores the agreement; its version moves on with the row's (the concurrency token).</summary>
    public static void Write(Agreement row, CommercialAgreement a)
    {
        row.Version = a.Version;
        row.Document = Serialise(a);
    }

    /// <summary>
    /// A new customer (docs/21): a trial of the chosen package, and an agreement at the catalogue price
    /// in force (usually "awaiting configuration"). Nothing is charged during the trial.
    /// </summary>
    public async Task OpenAsync(Organisation org, string packageId, Actor? by, CancellationToken ct)
    {
        var cat = await CatalogueAsync(ct);
        var now = clock.GetUtcNow();
        var today = CommercialRules.Day(now);
        var terms = CommercialRules.TermsOn(CommercialRules.PackageDef(cat, packageId)?.Terms ?? [], today);
        var trialEnds = CommercialRules.ParseDay(CommercialRules.Day(now + TrialLength));
        var firstBilling = new DateOnly(trialEnds.Year, trialEnds.Month, 1).AddMonths(1);
        db.Subscriptions.Add(new Subscription { OrganisationId = org.Id, Status = SubscriptionStatuses.Trial, StartedAt = now });
        var agreement = new CommercialAgreement
        {
            OrganisationId = org.Id.ToString(),
            Packages = [new PackageLine { Id = NewLineId("pk"), PackageId = packageId, From = today, MonthlyPrice = terms?.MonthlyPrice, PriceSource = PriceSources.Catalogue, CatalogueVersion = terms?.Version }],
            Renewal = new Renewal { On = CommercialRules.Day(CommercialRules.ParseDay(today).AddYears(1)), Fee = terms?.AnnualRenewalFee, PriceSource = PriceSources.Catalogue },
            Billing = new BillingDetails { Preference = BillingPreferences.ManualEft, NextBillingDate = CommercialRules.Day(firstBilling) },
            History =
            [
                new AgreementEvent
                {
                    At = now.ToOffset(CommercialRules.SouthAfricaOffset).ToString("yyyy-MM-ddTHH:mm:sszzz"), ById = by?.Human.Id.ToString() ?? "", By = by?.Human.Name ?? "Humo",
                    Action = $"Trial opened on {EntitlementCatalogue.Package(packageId)?.Name ?? packageId}; price to be agreed", Reason = "New account",
                    EffectiveFrom = today, Approval = "Account opening (docs/21)",
                },
            ],
        };
        db.Agreements.Add(new Agreement { OrganisationId = org.Id, Version = 1, Document = Serialise(agreement) });
    }

    /// <summary>The subscription in force today: package and add-ons from the agreement's dated lines, the contract value from its charges.</summary>
    public SubscriptionView View(Subscription sub, CommercialAgreement a, CommercialCatalogue cat, int schemes)
    {
        var today = Today;
        var pkg = CommercialRules.PackageOn(a, today);
        var renewsAt = sub.Status == SubscriptionStatuses.Trial ? sub.StartedAt + TrialLength : (DateTimeOffset?)null;
        return new SubscriptionView(
            a.OrganisationId, sub.Version, pkg?.PackageId ?? a.Packages.FirstOrDefault()?.PackageId ?? "essentials", sub.Status, sub.StartedAt.ToString("O"),
            renewsAt?.ToString("O") ?? $"{a.Renewal.On}T00:00:00+02:00",
            CommercialRules.InForce(a.AddOns, today).Select(l => new SubscriptionAddOn(l.AddOnId, l.From)).ToList(),
            JsonSerializer.Deserialize<List<FeatureOverride>>(sub.Overrides, Json.Options) ?? [],
            CommercialRules.ChargesOn(a, today, cat, schemes).RecurringMonthly, sub.Seats);
    }

    public static IEnumerable<AddOnFeatures> AddOnFeatures(CommercialCatalogue cat) => cat.AddOns.Select(a => new AddOnFeatures(a.Id, a.Name, a.Features));

    /// <summary>A customer's subscription and effective entitlements; null for an organisation without one.</summary>
    public async Task<(SubscriptionView Subscription, List<Entitlement> Entitlements)?> PlanAsync(Guid organisationId, CancellationToken ct)
    {
        var sub = await db.Subscriptions.AsNoTracking().FirstOrDefaultAsync(s => s.OrganisationId == organisationId, ct);
        var row = await db.Agreements.AsNoTracking().FirstOrDefaultAsync(a => a.OrganisationId == organisationId, ct);
        if (sub is null || row is null) return null;
        var cat = await CatalogueAsync(ct);
        var schemes = await db.Schemes.CountAsync(s => s.OrganisationId == organisationId && s.Status != "archived", ct);
        var view = View(sub, Read(row), cat, schemes);
        return (view, EntitlementEngine.Resolve(view, clock.GetUtcNow(), AddOnFeatures(cat)));
    }

    /// <summary>Is the feature on for this organisation? An organisation with no subscription yet has no plan to limit it.</summary>
    public async Task<bool> EntitledAsync(Guid organisationId, string feature, CancellationToken ct) =>
        await PlanAsync(organisationId, ct) is not { } plan || plan.Entitlements.Any(e => e.Feature == feature && e.Enabled);

    public static string NewLineId(string prefix) => $"{prefix}-{Guid.NewGuid().ToString("N")[..12]}";

    public static string Serialise<T>(T value) => JsonSerializer.Serialize(value, Json.Options);
}
