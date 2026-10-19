using System.Globalization;
using System.Text.RegularExpressions;

namespace Humo.Domain.Commercial;

/// <summary>
/// Humo's commercial rules (docs/23), ported rule for rule from the frontend's
/// <c>domain/models/commercial.ts</c>: what an agreement charges on a date, which changes are
/// allowed, what a change does, and the invoice for a period. Pure: no database, no clock.
/// A catalogue price change never reaches an existing agreement; an invoice never looks a price up again.
/// </summary>
public static partial class CommercialRules
{
    /// <summary>"1 000": South African grouping, without culture data (the API runs globalization-invariant).</summary>
    private static readonly NumberFormatInfo SouthAfrica = new() { NumberGroupSeparator = " ", NumberDecimalSeparator = "," };

    /// <summary>South Africa has one time zone and no daylight saving.</summary>
    public static readonly TimeSpan SouthAfricaOffset = TimeSpan.FromHours(2);

    public static string Day(DateTimeOffset at) => at.ToOffset(SouthAfricaOffset).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static string Day(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static DateOnly ParseDay(string d) => DateOnly.ParseExact(d, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static bool IsDay(string? d) => d is not null && DayFormat().IsMatch(d) && DateOnly.TryParseExact(d, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    public static decimal Round2(decimal n) => Math.Round(n, 2, MidpointRounding.AwayFromZero);

    // ---------------------------------------------------------------- Lookups

    /// <summary>The terms in force on a date: the newest whose <c>EffectiveFrom</c> is on or before it.</summary>
    public static PackageTerms? TermsOn(IEnumerable<PackageTerms> terms, string on) =>
        terms.Where(t => string.CompareOrdinal(t.EffectiveFrom, on) <= 0).OrderByDescending(t => t.EffectiveFrom, StringComparer.Ordinal).FirstOrDefault();

    public static AddOnTerms? TermsOn(IEnumerable<AddOnTerms> terms, string on) =>
        terms.Where(t => string.CompareOrdinal(t.EffectiveFrom, on) <= 0).OrderByDescending(t => t.EffectiveFrom, StringComparer.Ordinal).FirstOrDefault();

    public static IEnumerable<T> InForce<T>(IEnumerable<T> lines, string on) where T : IDatedLine =>
        lines.Where(l => string.CompareOrdinal(l.From, on) <= 0 && (l.Until is null || string.CompareOrdinal(l.Until, on) > 0));

    /// <summary>Lines that start after the date: scheduled changes.</summary>
    public static IEnumerable<T> Scheduled<T>(IEnumerable<T> lines, string on) where T : IDatedLine =>
        lines.Where(l => string.CompareOrdinal(l.From, on) > 0).OrderBy(l => l.From, StringComparer.Ordinal);

    public static PackageLine? PackageOn(CommercialAgreement a, string on) => InForce(a.Packages, on).OrderByDescending(l => l.From, StringComparer.Ordinal).FirstOrDefault();

    public static CommercialAddOn? AddOnDef(CommercialCatalogue cat, string id) => cat.AddOns.FirstOrDefault(x => x.Id == id);

    public static CommercialPackage? PackageDef(CommercialCatalogue cat, string id) => cat.Packages.FirstOrDefault(x => x.PackageId == id);

    private static string PackageName(string id) => EntitlementCatalogue.Package(id)?.Name ?? id;

    // ---------------------------------------------------------------- Charges

    private static decimal Monthly(decimal price, string frequency) => frequency == "annual" ? price / 12 : price;

    /// <summary>What the agreement charges on a date: recurring lines, next-invoice once-offs and credits, usage and tax, kept apart.</summary>
    public static ChargeSummary ChargesOn(CommercialAgreement a, string on, CommercialCatalogue cat, int schemes)
    {
        var recurring = new List<ChargeLine>();
        if (PackageOn(a, on) is { } pkg)
        {
            recurring.Add(new("package", PackageName(pkg.PackageId), PriceSources.Label(pkg.PriceSource), 1, pkg.MonthlyPrice, "monthly", pkg.MonthlyPrice, pkg.PriceSource));
            var terms = TermsOn(PackageDef(cat, pkg.PackageId)?.Terms ?? [], on);
            var extra = terms?.IncludedSchemes is { } included ? Math.Max(0, schemes - included) : 0;
            if (pkg.PriceSource == PriceSources.Catalogue && extra > 0 && terms?.ExtraSchemePrice is { } each)
            {
                var block = Math.Max(1, terms.ExtraSchemeBlock ?? 1);
                var blocks = (extra + block - 1) / block;
                var detail = block > 1 ? $"{extra} beyond the {terms.IncludedSchemes} included: {blocks} × {block}" : $"{extra} beyond the {terms.IncludedSchemes} included";
                recurring.Add(new("extra-schemes", "Additional schemes", detail, blocks, each, "monthly", Round2(blocks * each), PriceSources.Catalogue));
            }
        }
        var usage = new List<UsageNote>();
        foreach (var l in InForce(a.AddOns, on))
        {
            var def = AddOnDef(cat, l.AddOnId);
            var name = def?.Name ?? l.AddOnId;
            decimal? amount = l.PriceSource == PriceSources.Included ? 0 : l.UnitPrice is { } unit ? Round2(Monthly(unit, l.Frequency) * l.Quantity) : null;
            recurring.Add(new("add-on", l.Quantity > 1 ? $"{name} × {l.Quantity}" : name, PriceSources.Label(l.PriceSource), l.Quantity, l.UnitPrice, l.Frequency, amount, l.PriceSource));
            if (TermsOn(def?.Terms ?? [], on)?.UsageAllowance is { } allowance)
                usage.Add(new(name, $"{allowance.Included.ToString("N0", SouthAfrica)} {allowance.Unit} a month included; use beyond it is charged by usage, not in the recurring total."));
        }
        var subtotal = recurring.Sum(l => l.Amount ?? 0);
        foreach (var d in InForce(a.Adjustments, on).Where(x => x.Kind == "discount"))
        {
            var amount = d.Percent is { } pct ? Round2(subtotal * pct / 100) : d.Amount;
            recurring.Add(new("discount", d.Label, d.Percent is { } p ? $"{p.ToString("0.##", CultureInfo.InvariantCulture)}% off" : "Fixed discount", 1, -amount, "monthly", -amount, PriceSources.Negotiated));
        }
        List<ChargeLine> Pending(string kind) => a.Adjustments
            .Where(x => x.Kind == kind && x.InvoicedOn is null && string.CompareOrdinal(x.From, on) <= 0)
            .Select(x => new ChargeLine(kind, x.Label, x.Reason, 1, kind == "credit" ? -x.Amount : x.Amount, "once-off", kind == "credit" ? -x.Amount : x.Amount, PriceSources.Negotiated))
            .ToList();
        var recurringMonthly = Round2(recurring.Sum(l => l.Amount ?? 0));
        var tax = cat.Settings.Tax;
        var taxAmount = tax.VatRegistered ? Round2(recurringMonthly * tax.RatePercent / 100) : 0;
        return new(on, a.Cycle, recurring, recurringMonthly, recurring.Count(l => l.Amount is null), Pending("once-off-fee"), Pending("credit"), usage, a.Renewal,
            new(tax.VatRegistered, tax.RatePercent, taxAmount), Round2(recurringMonthly + taxAmount));
    }

    // ---------------------------------------------------------------- Changes

    /// <summary>Server-side checks for a change: field → message (empty when it's allowed).</summary>
    public static Dictionary<string, string> CheckChange(CommercialAgreement a, AgreementChange c, CommercialCatalogue cat, string today)
    {
        var e = new Dictionary<string, string>();
        bool Before(string? d, string than) => string.CompareOrdinal(d, than) < 0;
        if ((c.Reason ?? "").Trim().Length < 8) e["reason"] = "Say why, in a few words. It goes in the audit log.";
        switch (c.Type)
        {
            case "package":
            {
                var def = PackageDef(cat, c.PackageId ?? "");
                if (!IsDay(c.EffectiveFrom) || Before(c.EffectiveFrom, today)) e["effectiveFrom"] = "Choose today or a later date.";
                else if (PackageOn(a, c.EffectiveFrom!)?.PackageId == c.PackageId) e["packageId"] = "They’re already on this package then.";
                if (def is null || def.Status != CatalogueStatuses.Active || (def.RetiresOn is { } r && string.CompareOrdinal(r, c.EffectiveFrom) <= 0)) e["packageId"] = "This package isn’t available.";
                var price = c.MonthlyPriceGiven ? c.MonthlyPrice : TermsOn(def?.Terms ?? [], c.EffectiveFrom ?? "")?.MonthlyPrice;
                if (price is null) e["monthlyPrice"] = "This package has no catalogue price yet. Enter the price agreed with the customer.";
                else if (price < 0) e["monthlyPrice"] = "A price can’t be negative.";
                break;
            }
            case "add-on":
            {
                var def = AddOnDef(cat, c.AddOnId ?? "");
                if (!IsDay(c.EffectiveFrom) || Before(c.EffectiveFrom, today)) e["effectiveFrom"] = "Choose today or a later date.";
                if (def is null || def.Status != CatalogueStatuses.Active || (def.RetiresOn is { } r && string.CompareOrdinal(r, c.EffectiveFrom) <= 0)) e["addOnId"] = "This add-on isn’t available.";
                else if (!def.AllowQuantity && IsDay(c.EffectiveFrom) && InForce(a.AddOns, c.EffectiveFrom!).Any(l => l.AddOnId == c.AddOnId)) e["addOnId"] = "They already have this add-on then.";
                else if (!def.AllowQuantity && Scheduled(a.AddOns, today).Any(l => l.AddOnId == c.AddOnId)) e["addOnId"] = "This add-on is already scheduled. Cancel that change first.";
                if (c.Quantity < 1 || c.Quantity > (def?.AllowQuantity == true ? 20 : 1)) e["quantity"] = def?.AllowQuantity == true ? "Between 1 and 20." : "This add-on is bought once.";
                var price = c.UnitPriceGiven ? c.UnitPrice : TermsOn(def?.Terms ?? [], c.EffectiveFrom ?? "")?.Price;
                if (def is not null && price is null) e["unitPrice"] = "This add-on has no catalogue price yet. Enter the price agreed with the customer.";
                else if (price < 0) e["unitPrice"] = "A price can’t be negative.";
                break;
            }
            case "remove-add-on":
                if (!IsDay(c.EffectiveFrom) || Before(c.EffectiveFrom, today)) e["effectiveFrom"] = "Choose today or a later date.";
                else if (!InForce(a.AddOns, c.EffectiveFrom!).Any(l => l.AddOnId == c.AddOnId)) e["addOnId"] = "They won’t have this add-on then.";
                break;
            case "cancel-scheduled":
            {
                var line = a.Packages.Cast<IDatedLine>().Concat(a.AddOns).FirstOrDefault(l => l.Id == c.LineId);
                if (line is null || string.CompareOrdinal(line.From, today) <= 0) e["lineId"] = "Only a change that hasn’t taken effect can be cancelled.";
                break;
            }
            case "adjustment":
                if (c.Kind is not ("discount" or "credit" or "once-off-fee")) e["kind"] = "Choose a discount, a credit or a once-off fee.";
                if (string.IsNullOrWhiteSpace(c.Label)) e["label"] = "Name it as it should appear on the invoice.";
                if (!IsDay(c.From)) e["from"] = "Choose a date.";
                if (c.Until is not null && (!IsDay(c.Until) || string.CompareOrdinal(c.Until, c.From) <= 0)) e["until"] = "After the start date.";
                if (c.Percent is { } pct ? !(pct > 0 && pct <= 100) : !(c.Amount > 0)) e["amount"] = "Enter an amount above zero (or a percentage up to 100).";
                if (c.Kind != "discount" && c.Percent is not null) e["amount"] = "Only a discount can be a percentage.";
                break;
            case "billing-preference":
                if (!BillingPreferences.All.Contains(c.Preference)) e["preference"] = "Choose how they pay.";
                else if (!EmailFormat().IsMatch(c.BillingEmail ?? "")) e["billingEmail"] = "Where should invoices go? A valid email address.";
                else if (c.Preference == a.Billing.Preference && c.BillingEmail == a.Billing.BillingEmail) e["preference"] = "Nothing has changed.";
                break;
            case "storage-exception":
                if (!(c.ExtraGb > 0 && c.ExtraGb <= 500)) e["extraGb"] = "Between 1 and 500 GB.";
                if (!IsDay(c.Until) || string.CompareOrdinal(c.Until, today) <= 0) e["until"] = "A date after today: exceptions are temporary.";
                break;
            case "renewal":
                if (!IsDay(c.On) || string.CompareOrdinal(c.On, today) <= 0) e["on"] = "The next renewal date, after today.";
                if (c.Fee is { } fee && fee < 0) e["fee"] = "Zero or more, or leave it empty for no renewal fee.";
                if (c.Fee == a.Renewal.Fee && c.On == a.Renewal.On) e["fee"] = "Nothing has changed.";
                break;
            default:
                e["type"] = "That isn’t a change Humo knows.";
                break;
        }
        return e;
    }

    /// <summary>The agreement after a change (the caller has checked it). Pure: used for the preview and for saving.</summary>
    public static CommercialAgreement ApplyChange(CommercialAgreement a, AgreementChange c, CommercialCatalogue cat, ChangeActor actor, DateTimeOffset now, string describe, Func<string, string> newId)
    {
        var at = now.ToOffset(SouthAfricaOffset).ToString("yyyy-MM-ddTHH:mm:sszzz", CultureInfo.InvariantCulture);
        var today = Day(now);
        var next = a.Clone();
        string? effectiveFrom = null;
        switch (c.Type)
        {
            case "package":
            {
                effectiveFrom = c.EffectiveFrom!;
                var terms = TermsOn(PackageDef(cat, c.PackageId!)?.Terms ?? [], effectiveFrom);
                var fromCatalogue = !c.MonthlyPriceGiven;
                // A later package change that was scheduled is replaced by this one.
                next.Packages = next.Packages.Where(l => string.CompareOrdinal(l.From, effectiveFrom) <= 0 || string.CompareOrdinal(l.From, today) <= 0).ToList();
                foreach (var l in InForce(next.Packages, effectiveFrom).ToList()) l.Until = effectiveFrom;
                next.Packages.Add(new PackageLine
                {
                    Id = newId("pk"), PackageId = c.PackageId!, From = effectiveFrom,
                    MonthlyPrice = fromCatalogue ? terms?.MonthlyPrice : c.MonthlyPrice,
                    PriceSource = fromCatalogue ? PriceSources.Catalogue : PriceSources.Negotiated,
                    CatalogueVersion = fromCatalogue ? terms?.Version : null,
                });
                // A package at catalogue price brings its catalogue renewal fee; an agreed fee stays until someone changes it.
                if (fromCatalogue && terms?.AnnualRenewalFee is { } fee && (next.Renewal.Fee is null || next.Renewal.PriceSource != PriceSources.Negotiated))
                    next.Renewal = new Renewal { On = next.Renewal.On, Fee = fee, PriceSource = PriceSources.Catalogue };
                break;
            }
            case "add-on":
            {
                effectiveFrom = c.EffectiveFrom!;
                var terms = TermsOn(AddOnDef(cat, c.AddOnId!)?.Terms ?? [], effectiveFrom);
                var fromCatalogue = !c.UnitPriceGiven;
                next.AddOns.Add(new AddOnLine
                {
                    Id = newId("ao"), AddOnId = c.AddOnId!, Quantity = c.Quantity, From = effectiveFrom,
                    UnitPrice = fromCatalogue ? terms?.Price : c.UnitPrice,
                    Frequency = terms?.Frequency ?? "monthly",
                    PriceSource = fromCatalogue ? PriceSources.Catalogue : PriceSources.Negotiated,
                    CatalogueVersion = fromCatalogue ? terms?.Version : null,
                });
                break;
            }
            case "remove-add-on":
                effectiveFrom = c.EffectiveFrom!;
                foreach (var l in InForce(next.AddOns, effectiveFrom).Where(x => x.AddOnId == c.AddOnId).ToList()) l.Until = effectiveFrom;
                break;
            case "cancel-scheduled":
            {
                var line = next.Packages.Cast<IDatedLine>().Concat(next.AddOns).First(l => l.Id == c.LineId);
                next.Packages.RemoveAll(l => l.Id == c.LineId);
                next.AddOns.RemoveAll(l => l.Id == c.LineId);
                // The package it would have replaced carries on.
                if (line is PackageLine)
                    foreach (var l in next.Packages.Where(x => x.Until == line.From)) l.Until = null;
                break;
            }
            case "adjustment":
                effectiveFrom = c.From;
                next.Adjustments.Add(new Adjustment
                {
                    Id = newId("adj"), Kind = c.Kind!, Label = c.Label!.Trim(), Amount = c.Amount, Percent = c.Percent, From = c.From!, Until = c.Until,
                    Reason = c.Reason.Trim(), By = actor.Name, At = at,
                });
                break;
            case "billing-preference":
                next.Billing = new BillingDetails
                {
                    Preference = c.Preference!, BillingEmail = c.BillingEmail!.Trim(), NextBillingDate = next.Billing.NextBillingDate,
                    Mandate = c.Preference == BillingPreferences.CardRecurring ? next.Billing.Mandate : new Mandate(),
                };
                break;
            case "renewal":
                effectiveFrom = c.On;
                next.Renewal = new Renewal { On = c.On!, Fee = c.Fee, PriceSource = PriceSources.Negotiated };
                break;
            case "storage-exception":
                next.StorageExceptions.Add(new StorageException { Id = newId("sx"), ExtraGb = c.ExtraGb, Until = c.Until!, Reason = c.Reason.Trim(), By = actor.Name, At = at });
                break;
        }
        next.Version = a.Version + 1;
        next.History.Insert(0, new AgreementEvent { At = at, ById = actor.Id, By = actor.Name, Action = describe, Reason = c.Reason.Trim(), EffectiveFrom = effectiveFrom, Approval = actor.Approval });
        return next;
    }

    /// <summary>
    /// Does the change need a second approver? A recurring discount above the threshold does: as a percentage,
    /// or as an amount against the recurring charges before discounts on its start date. Null: it doesn't.
    /// </summary>
    public static string? ApprovalNeeded(CommercialAgreement a, AgreementChange c, CommercialCatalogue cat, int schemes)
    {
        if (c.Type != "adjustment" || c.Kind != "discount") return null;
        var limit = cat.Settings.DiscountApprovalPercent;
        var limitText = limit.ToString("0.##", CultureInfo.InvariantCulture);
        if (c.Percent is { } pct) return pct > limit ? $"{pct.ToString("0.##", CultureInfo.InvariantCulture)}% off (more than {limitText}%)" : null;
        var on = c.From ?? "";
        var basis = ChargesOn(a, on, cat, schemes).Recurring.Where(l => l.Kind != "discount").Sum(l => l.Amount ?? 0);
        var share = basis > 0 ? c.Amount / basis * 100 : 100;
        return share > limit ? $"{Math.Round(share, MidpointRounding.AwayFromZero)}% of the recurring charges (more than {limitText}%)" : null;
    }

    /// <summary>Before and after, on the date the change takes effect, for the person to confirm. Nothing is saved.</summary>
    public static ChangePreview Preview(CommercialAgreement a, AgreementChange c, CommercialCatalogue cat, int schemes, DateTimeOffset now)
    {
        var today = Day(now);
        var effectiveFrom = c.Type switch
        {
            "package" or "add-on" or "remove-add-on" => c.EffectiveFrom ?? today,
            "adjustment" => c.From ?? today,
            _ => today,
        };
        var errors = CheckChange(a, c, cat, today);
        // A missing reason doesn't stop the preview: the person sees the effect while they write it.
        var blocking = errors.Keys.Any(k => k != "reason");
        var after = blocking ? a : ApplyChange(a, c, cat, new ChangeActor("", "", ""), now, "", p => $"{p}-preview");
        var on = IsDay(effectiveFrom) ? effectiveFrom : today;
        var before = ChargesOn(a, on, cat, schemes);
        var afterCharges = ChargesOn(after, on, cat, schemes);
        var policy = cat.Settings.Proration;
        var firstInvoiceOn = policy == ProrationPolicies.Daily || string.CompareOrdinal(on, a.Billing.NextBillingDate) <= 0
            ? a.Billing.NextBillingDate
            : NextCycleOn(a.Billing.NextBillingDate, on, a.Cycle);
        return new(on, before, afterCharges, Round2(afterCharges.RecurringMonthly - before.RecurringMonthly), firstInvoiceOn, policy, errors.Count > 0 ? errors : null,
            ApprovalNeeded(a, c, cat, schemes));
    }

    /// <summary>The first billing date on or after <paramref name="on"/>, stepping from a known billing date.</summary>
    public static string NextCycleOn(string billingDate, string on, string cycle)
    {
        if (!IsDay(billingDate) || !IsDay(on)) return billingDate;
        var d = ParseDay(billingDate);
        var target = ParseDay(on);
        while (d < target) d = d.AddMonths(cycle == "annual" ? 12 : 1);
        return Day(d);
    }

    // ---------------------------------------------------------------- Storage

    public const long Gb = 1024L * 1024 * 1024;

    /// <summary>
    /// The allowance (package or negotiated, plus packs, plus unexpired exceptions) against what's used.
    /// Not enforced until the API checks uploads against it (docs/23 §5).
    /// </summary>
    public static StorageSummary Storage(CommercialAgreement a, CommercialCatalogue cat, StorageMeasurement m, string on)
    {
        var pkg = PackageOn(a, on);
        var terms = TermsOn(PackageDef(cat, pkg?.PackageId ?? "essentials")?.Terms ?? [], on);
        var negotiated = a.NegotiatedStorageGb is not null;
        var includedGb = negotiated ? a.NegotiatedStorageGb : terms?.IncludedStorageGb;
        var purchasedGb = InForce(a.AddOns, on).Sum(l => (AddOnDef(cat, l.AddOnId)?.StorageGb ?? 0) * l.Quantity);
        var exceptionGb = a.StorageExceptions.Where(x => string.CompareOrdinal(x.Until, on) > 0).Sum(x => x.ExtraGb);
        decimal? totalGb = includedGb is null ? null : includedGb + purchasedGb + exceptionGb;
        var used = m.DocumentsBytes + m.ImagesBytes + m.GeneratedBytes;
        decimal? percent = totalGb is > 0 ? Math.Round(used / (totalGb.Value * Gb) * 1000, MidpointRounding.AwayFromZero) / 10 : null;
        var thresholds = cat.Settings.StorageThresholds;
        var state = percent is null ? "unknown" : percent >= 100 ? "exhausted" : percent >= thresholds[1] ? "critical" : percent >= thresholds[0] ? "warning" : "ok";
        return new(includedGb, negotiated ? PriceStatuses.Approved : terms?.StorageStatus ?? PriceStatuses.Awaiting, negotiated, purchasedGb, exceptionGb, totalGb, used, percent, state, thresholds, m, false);
    }

    // ---------------------------------------------------------------- Invoices

    /// <summary>The annual renewal fee, if the renewal date falls in the period [start, end).</summary>
    public static InvoiceLine? RenewalIn(CommercialAgreement a, string periodStart, string periodEnd)
    {
        var r = a.Renewal;
        if (r.Fee is not { } fee || fee == 0 || string.CompareOrdinal(r.On, periodStart) < 0 || string.CompareOrdinal(r.On, periodEnd) >= 0) return null;
        return new($"Annual renewal fee (renews {r.On})", "renewal-fee", 1, fee, fee, r.PriceSource);
    }

    /// <summary>The invoice for a billing period, from the agreement as it stood: a snapshot, never recalculated later.</summary>
    public static HumoInvoiceSnapshot BuildInvoice(CommercialAgreement a, string periodStart, CommercialCatalogue cat, int schemes, string id, string reference, string issuedOn, bool simulated)
    {
        var months = a.Cycle == "annual" ? 12 : 1;
        var start = ParseDay(periodStart);
        var periodEnd = Day(start.AddMonths(months));
        int Days(string x, string y) => ParseDay(y).DayNumber - ParseDay(x).DayNumber;
        var periodDays = Days(periodStart, periodEnd);
        var lines = new List<InvoiceLine>();
        void Charge(string on, decimal share)
        {
            foreach (var l in ChargesOn(a, on, cat, schemes).Recurring)
            {
                if (l.Amount is not { } amount) continue;
                var label = share < 1 ? $"{l.Label} ({Math.Round(share * periodDays, MidpointRounding.AwayFromZero)} of {periodDays} days)" : l.Label;
                lines.Add(new(label, l.Kind, l.Quantity, Round2(amount * months * share / l.Quantity), Round2(amount * months * share), l.PriceSource));
            }
        }
        if (cat.Settings.Proration == ProrationPolicies.NextCycle) Charge(periodStart, 1);
        else
        {
            // Daily pro-rata: each stretch of the period with the same lines is charged for its days.
            var changes = a.Packages.Cast<IDatedLine>().Concat(a.AddOns).Concat(a.Adjustments)
                .SelectMany(l => new[] { l.From, l.Until ?? "" })
                .Where(d => string.CompareOrdinal(d, periodStart) > 0 && string.CompareOrdinal(d, periodEnd) < 0)
                .Prepend(periodStart).Distinct().OrderBy(d => d, StringComparer.Ordinal).ToList();
            for (var i = 0; i < changes.Count; i++) Charge(changes[i], (decimal)Days(changes[i], i + 1 < changes.Count ? changes[i + 1] : periodEnd) / periodDays);
        }
        var pending = ChargesOn(a, periodStart, cat, schemes);
        foreach (var l in pending.OnceOff.Concat(pending.Credits)) lines.Add(new(l.Label, l.Kind, 1, l.Amount!.Value, l.Amount!.Value, PriceSources.Negotiated));
        if (RenewalIn(a, periodStart, periodEnd) is { } renewal) lines.Add(renewal);
        var subtotal = Round2(lines.Sum(l => l.Amount));
        var tax = cat.Settings.Tax;
        var taxAmount = tax.VatRegistered ? Round2(subtotal * tax.RatePercent / 100) : 0;
        var dueOn = Day(ParseDay(issuedOn).AddDays(cat.Settings.PaymentTermsDays));
        return new(id, reference, a.OrganisationId, periodStart, periodEnd, issuedOn, dueOn, lines, subtotal, new(tax.VatRegistered, tax.RatePercent, taxAmount), Round2(subtotal + taxAmount), "issued", simulated);
    }

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}$")]
    private static partial Regex DayFormat();

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailFormat();
}
