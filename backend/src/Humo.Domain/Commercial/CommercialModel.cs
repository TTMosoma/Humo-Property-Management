using System.Text.Json;

namespace Humo.Domain.Commercial;

// The shapes match frontend/humo-web/src/app/domain/models/commercial.ts (camelCase on the wire),
// so the API returns them as they are. Dates are "yyyy-MM-dd" strings, compared as text, as there.

/// <summary>A package's commercial terms from a date. A change is a new version; history is kept.</summary>
public sealed class PackageTerms
{
    public int Version { get; set; }
    public string EffectiveFrom { get; set; } = "";
    /// <summary>Rand per month, excluding tax. Null until decided.</summary>
    public decimal? MonthlyPrice { get; set; }
    public decimal? AnnualPrice { get; set; }
    public string PriceStatus { get; set; } = PriceStatuses.Awaiting;
    /// <summary>Null: negotiated per customer.</summary>
    public decimal? IncludedStorageGb { get; set; }
    public string StorageStatus { get; set; } = PriceStatuses.Awaiting;
    public int? IncludedSchemes { get; set; }
    /// <summary>Rand per month per block of extra schemes.</summary>
    public decimal? ExtraSchemePrice { get; set; }
    /// <summary>Schemes per block (R150 per 10 extra schemes; a part block counts). Null or 1: per scheme.</summary>
    public int? ExtraSchemeBlock { get; set; }
    /// <summary>Charged once a year on the renewal date. Null: no renewal fee.</summary>
    public decimal? AnnualRenewalFee { get; set; }
    /// <summary>SMS a month that come with the package (20, 100, 500). Unused SMS don't carry over to the next month.</summary>
    public int? IncludedSms { get; set; }
    /// <summary>Units under management that the package includes (D16). Null: no limit.</summary>
    public int? IncludedUnits { get; set; }
    /// <summary>People with a sign-in to the agency that the package includes (D16). Null: no limit.</summary>
    public int? IncludedUsers { get; set; }
    public string ChangedBy { get; set; } = "";
    public string ChangedAt { get; set; } = "";
    public string Reason { get; set; } = "";
}

public sealed class CommercialPackage
{
    public string PackageId { get; set; } = "";
    public List<string> BillingFrequencies { get; set; } = ["monthly", "annual"];
    public string Status { get; set; } = CatalogueStatuses.Active;
    public string? RetiresOn { get; set; }
    /// <summary>Newest first.</summary>
    public List<PackageTerms> Terms { get; set; } = [];
}

public sealed class UsageAllowance
{
    public string Unit { get; set; } = "";
    public int Included { get; set; }
}

public sealed class AddOnTerms
{
    public int Version { get; set; }
    public string EffectiveFrom { get; set; } = "";
    public decimal? Price { get; set; }
    public string Frequency { get; set; } = "monthly";
    public string PriceStatus { get; set; } = PriceStatuses.Awaiting;
    public UsageAllowance? UsageAllowance { get; set; }
    public string ChangedBy { get; set; } = "";
    public string ChangedAt { get; set; } = "";
    public string Reason { get; set; } = "";
}

/// <summary>An add-on as catalogue data: a new one needs no code change, only features the app already knows.</summary>
public sealed class CommercialAddOn
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Kind { get; set; } = "feature";
    public List<string> Features { get; set; } = [];
    public decimal? StorageGb { get; set; }
    public bool AllowQuantity { get; set; }
    public string Status { get; set; } = CatalogueStatuses.Active;
    public string? RetiresOn { get; set; }
    public List<AddOnTerms> Terms { get; set; } = [];
}

public sealed class TaxConfig
{
    /// <summary>Humo Property Management is a brand of WeDesign Solutions (D15); invoices are from WeDesign Solutions.</summary>
    public string LegalName { get; set; } = "WeDesign Solutions (Humo Property Management)";
    public string? RegistrationNumber { get; set; }
    /// <summary>Humo charges VAT only when this is on (docs/23 §6, a decision for approval).</summary>
    public bool VatRegistered { get; set; }
    public string? VatNumber { get; set; }
    public decimal RatePercent { get; set; } = 15;
}

public sealed class CommercialSettings
{
    public int Version { get; set; } = 1;
    public int[] StorageThresholds { get; set; } = [80, 95];
    /// <summary>Daily pro-rata, approved on 19 October 2026 (doc 17, D15).</summary>
    public string Proration { get; set; } = ProrationPolicies.Daily;
    public bool ProrationAwaitingApproval { get; set; }
    public TaxConfig Tax { get; set; } = new();
    /// <summary>The Humo Account Manager new customers go to by default; empty until a System Administrator chooses one.</summary>
    public string DesignatedAccountManagerId { get; set; } = "";
    public int PaymentTermsDays { get; set; } = 7;
    /// <summary>A discount above this share of the recurring charges needs a second approver (doc 17, D15).</summary>
    public decimal DiscountApprovalPercent { get; set; } = 20;
}

public sealed class CommercialCatalogue
{
    public List<CommercialPackage> Packages { get; set; } = [];
    public List<CommercialAddOn> AddOns { get; set; } = [];
    public CommercialSettings Settings { get; set; } = new();
}

// ---------------------------------------------------------------- The customer's agreement

public interface IDatedLine
{
    string Id { get; }
    string From { get; }
    string? Until { get; set; }
}

public sealed class PackageLine : IDatedLine
{
    public string Id { get; set; } = "";
    public string From { get; set; } = "";
    public string? Until { get; set; }
    public string PackageId { get; set; } = "";
    public decimal? MonthlyPrice { get; set; }
    public string PriceSource { get; set; } = PriceSources.Catalogue;
    public int? CatalogueVersion { get; set; }
}

public sealed class AddOnLine : IDatedLine
{
    public string Id { get; set; } = "";
    public string From { get; set; } = "";
    public string? Until { get; set; }
    public string AddOnId { get; set; } = "";
    public int Quantity { get; set; } = 1;
    public decimal? UnitPrice { get; set; }
    public string Frequency { get; set; } = "monthly";
    public string PriceSource { get; set; } = PriceSources.Catalogue;
    public int? CatalogueVersion { get; set; }
}

public sealed class Adjustment : IDatedLine
{
    public string Id { get; set; } = "";
    public string From { get; set; } = "";
    public string? Until { get; set; }
    /// <summary>discount, credit or once-off-fee.</summary>
    public string Kind { get; set; } = "discount";
    public string Label { get; set; } = "";
    public decimal Amount { get; set; }
    public decimal? Percent { get; set; }
    public string Reason { get; set; } = "";
    public string By { get; set; } = "";
    public string At { get; set; } = "";
    public string? InvoicedOn { get; set; }
}

public sealed class StorageException
{
    public string Id { get; set; } = "";
    public decimal ExtraGb { get; set; }
    public string Until { get; set; } = "";
    public string Reason { get; set; } = "";
    public string By { get; set; } = "";
    public string At { get; set; } = "";
}

public sealed class AgreementEvent
{
    public string At { get; set; } = "";
    public string ById { get; set; } = "";
    public string By { get; set; } = "";
    public string Action { get; set; } = "";
    public string Reason { get; set; } = "";
    public string? EffectiveFrom { get; set; }
    /// <summary>D11: an Account Manager's change to their own customer needs no separate approval.</summary>
    public string Approval { get; set; } = "";
}

public sealed class Renewal
{
    public string On { get; set; } = "";
    public decimal? Fee { get; set; }
    public string PriceSource { get; set; } = PriceSources.Negotiated;
}

public sealed class Mandate
{
    /// <summary>none, pending or active.</summary>
    public string Status { get; set; } = "none";
    public string? Reference { get; set; }
}

public sealed class BillingDetails
{
    public string Preference { get; set; } = BillingPreferences.ManualEft;
    public string BillingEmail { get; set; } = "";
    public string NextBillingDate { get; set; } = "";
    /// <summary>Humo keeps only the provider's mandate reference, never card details.</summary>
    public Mandate Mandate { get; set; } = new();
}

/// <summary>What this customer agreed to pay: dated lines, adjustments, billing and history.</summary>
public sealed class CommercialAgreement
{
    public string OrganisationId { get; set; } = "";
    public int Version { get; set; } = 1;
    /// <summary>monthly or annual.</summary>
    public string Cycle { get; set; } = "monthly";
    public List<PackageLine> Packages { get; set; } = [];
    public List<AddOnLine> AddOns { get; set; } = [];
    public List<Adjustment> Adjustments { get; set; } = [];
    public List<StorageException> StorageExceptions { get; set; } = [];
    public decimal? NegotiatedStorageGb { get; set; }
    public Renewal Renewal { get; set; } = new();
    public BillingDetails Billing { get; set; } = new();
    /// <summary>Newest first.</summary>
    public List<AgreementEvent> History { get; set; } = [];
    /// <summary>Changes waiting for a second approver (a discount above the threshold): not in force until approved.</summary>
    public List<PendingApproval> PendingApprovals { get; set; } = [];

    public CommercialAgreement Clone() => JsonSerializer.Deserialize<CommercialAgreement>(JsonSerializer.Serialize(this, Json.Options), Json.Options)!;
}

/// <summary>
/// A change an authorised Humo person makes to an agreement. A price that was left out takes
/// the catalogue price in force then (<see cref="MonthlyPriceGiven"/>, <see cref="UnitPriceGiven"/>).
/// </summary>
public sealed class AgreementChange
{
    /// <summary>package, add-on, remove-add-on, cancel-scheduled, adjustment, billing-preference, storage-exception or renewal.</summary>
    public string Type { get; set; } = "";
    public string Reason { get; set; } = "";
    public string? PackageId { get; set; }
    public string? AddOnId { get; set; }
    public string? EffectiveFrom { get; set; }
    public decimal? MonthlyPrice { get; set; }
    public bool MonthlyPriceGiven { get; set; }
    public int Quantity { get; set; } = 1;
    public decimal? UnitPrice { get; set; }
    public bool UnitPriceGiven { get; set; }
    public string? LineId { get; set; }
    public string? Kind { get; set; }
    public string? Label { get; set; }
    public decimal Amount { get; set; }
    public decimal? Percent { get; set; }
    public string? From { get; set; }
    public string? Until { get; set; }
    public string? Preference { get; set; }
    public string? BillingEmail { get; set; }
    public decimal ExtraGb { get; set; }
    public string? On { get; set; }
    public decimal? Fee { get; set; }

    /// <summary>Reads a change as the frontend sends it, telling an omitted price from an explicit one.</summary>
    public static AgreementChange Parse(JsonElement json)
    {
        var change = json.Deserialize<AgreementChange>(Json.Options) ?? new AgreementChange();
        change.MonthlyPriceGiven = json.ValueKind == JsonValueKind.Object && json.TryGetProperty("monthlyPrice", out _);
        change.UnitPriceGiven = json.ValueKind == JsonValueKind.Object && json.TryGetProperty("unitPrice", out _);
        return change;
    }
}

// ---------------------------------------------------------------- Charges, previews, storage and invoices

public sealed record ChargeLine(string Kind, string Label, string Detail, decimal Quantity, decimal? UnitPrice, string Frequency, decimal? Amount, string PriceSource);

public sealed record UsageNote(string Label, string Note);

public sealed record TaxSummary(bool Registered, decimal RatePercent, decimal Amount);

public sealed record ChargeSummary(string On, string Cycle, List<ChargeLine> Recurring, decimal RecurringMonthly, int AwaitingPrice, List<ChargeLine> OnceOff,
    List<ChargeLine> Credits, List<UsageNote> Usage, Renewal Renewal, TaxSummary Tax, decimal RecurringWithTax);

public sealed record ChangePreview(string EffectiveFrom, ChargeSummary Before, ChargeSummary After, decimal Difference, string FirstInvoiceOn, string Policy, Dictionary<string, string>? Errors,
    string? ApprovalNeeded = null);

/// <summary>A change someone asked for that another person must approve before it applies.</summary>
public sealed class PendingApproval
{
    public string Id { get; set; } = "";
    public AgreementChange Change { get; set; } = new();
    public string Describe { get; set; } = "";
    public string RequestedById { get; set; } = "";
    public string RequestedBy { get; set; } = "";
    public string At { get; set; } = "";
    public string Why { get; set; } = "";
}

/// <summary>Who made a change and on whose authority, for the agreement's history.</summary>
public sealed record ChangeActor(string Id, string Name, string Approval);

public sealed record StorageMeasurement(string OrganisationId, string MeasuredAt, string Source, long DocumentsBytes, long ImagesBytes, long GeneratedBytes);

public sealed record StorageSummary(decimal? IncludedGb, string IncludedStatus, bool Negotiated, decimal PurchasedGb, decimal ExceptionGb, decimal? TotalGb, long UsedBytes,
    decimal? Percent, string State, int[] Thresholds, StorageMeasurement Measurement, bool EnforcedByServer);

public sealed record InvoiceLine(string Description, string Kind, decimal Quantity, decimal UnitPrice, decimal Amount, string PriceSource);

public sealed record HumoInvoiceSnapshot(string Id, string Reference, string OrganisationId, string PeriodStart, string PeriodEnd, string IssuedOn, string DueOn,
    List<InvoiceLine> Lines, decimal Subtotal, TaxSummary Tax, decimal Total, string Status, bool Simulated);

// ---------------------------------------------------------------- Vocabulary

public static class PriceStatuses
{
    public const string Awaiting = "awaiting";
    public const string Proposed = "proposed";
    public const string Approved = "approved";
    public static readonly string[] All = [Awaiting, Proposed, Approved];
}

public static class PriceSources
{
    public const string Catalogue = "catalogue";
    public const string Negotiated = "negotiated";
    public const string Included = "included";

    public static string Label(string source) => source switch
    {
        Catalogue => "Catalogue price when agreed",
        Included => "Included in the agreed package price",
        _ => "Agreed price",
    };
}

public static class CatalogueStatuses
{
    public const string Draft = "draft";
    public const string Active = "active";
    public const string Retired = "retired";
}

public static class ProrationPolicies
{
    public const string NextCycle = "next-cycle";
    public const string Daily = "daily";
}

public static class BillingPreferences
{
    public const string CardRecurring = "card-recurring";
    public const string InstantEft = "instant-eft";
    public const string ManualEft = "manual-eft";
    public static readonly string[] All = [CardRecurring, InstantEft, ManualEft];
}

/// <summary>camelCase JSON, as the frontend sends and expects it.</summary>
public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}

/// <summary>
/// The catalogue Humo starts from (<c>demo-data/commercial/catalogue.json</c>, the same file the prototype uses):
/// package terms with no base prices decided, and the add-ons with their proposed example prices (docs/23 §2).
/// Seeded once; after that the catalogue changes only through Pricing &amp; add-ons, versioned and audited.
/// </summary>
public static class InitialCatalogue
{
    public static CommercialCatalogue Load()
    {
        using var stream = typeof(InitialCatalogue).Assembly.GetManifestResourceStream("Humo.Domain.commercial-catalogue.json")
            ?? throw new InvalidOperationException("demo-data/commercial/catalogue.json isn't embedded in Humo.Domain.");
        var catalogue = JsonSerializer.Deserialize<CommercialCatalogue>(stream, Json.Options) ?? throw new InvalidOperationException("The initial commercial catalogue is empty.");
        catalogue.Settings = new CommercialSettings();
        var unknown = catalogue.AddOns.SelectMany(a => a.Features).Where(f => !EntitlementCatalogue.FeatureKeys.Contains(f)).Distinct().ToList();
        if (unknown.Count > 0) throw new InvalidOperationException($"Add-ons name unknown features: {string.Join(", ", unknown)}");
        return catalogue;
    }
}

/// <summary>A month's messages on one channel: what the package and bundles include, and what's been used.</summary>
public sealed record MessageAllowance(string Channel, string Unit, int Included, int Bundles, int Allowance, int Used, int Remaining, string Period, string ResetsOn, string State);
