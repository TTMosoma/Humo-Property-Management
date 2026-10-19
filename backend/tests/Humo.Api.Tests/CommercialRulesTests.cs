using Humo.Domain.Commercial;

namespace Humo.Api.Tests;

/// <summary>
/// The commercial rules (docs/23), as the prototype's <c>commercial-management.spec.ts</c> states them:
/// the recurring total, renewal fees, price protection, scheduled changes, storage and invoices.
/// </summary>
public sealed class CommercialRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 12, 8, 0, 0, TimeSpan.FromHours(2));
    private static readonly ChangeActor Am = new("am-1", "Mashoto Moropane", "D11");
    private static int seq;

    private static string Id(string prefix) => $"{prefix}-{++seq}";

    private static CommercialCatalogue Catalogue(int? includedSchemes = null, decimal? extraSchemePrice = null)
    {
        var cat = InitialCatalogue.Load();
        var pro = cat.Packages.Single(p => p.PackageId == "professional").Terms[0];
        pro.IncludedSchemes = includedSchemes;
        pro.ExtraSchemePrice = extraSchemePrice;
        return cat;
    }

    private static CommercialAgreement Agreement() => new()
    {
        OrganisationId = "x",
        Packages = [new PackageLine { Id = "p1", PackageId = "professional", From = "2026-01-01", MonthlyPrice = 9_000, PriceSource = PriceSources.Catalogue, CatalogueVersion = 2 }],
        AddOns =
        [
            new AddOnLine { Id = "a1", AddOnId = "whatsapp", Quantity = 1, From = "2026-01-01", UnitPrice = 100, PriceSource = PriceSources.Catalogue },
            new AddOnLine { Id = "a2", AddOnId = "storage-10", Quantity = 2, From = "2026-01-01", UnitPrice = 150, PriceSource = PriceSources.Catalogue },
            new AddOnLine { Id = "a3", AddOnId = "api-access", Quantity = 1, From = "2026-01-01", UnitPrice = 1_200, Frequency = "annual", PriceSource = PriceSources.Negotiated },
        ],
        Adjustments =
        [
            new Adjustment { Id = "d1", Kind = "discount", Label = "Launch discount", Percent = 10, From = "2026-01-01" },
            new Adjustment { Id = "c1", Kind = "credit", Label = "Goodwill", Amount = 500, From = "2026-01-01" },
            new Adjustment { Id = "f1", Kind = "once-off-fee", Label = "Data migration", Amount = 2_500, From = "2026-01-01" },
        ],
        Renewal = new Renewal { On = "2027-05-01" },
        Billing = new BillingDetails { Preference = BillingPreferences.CardRecurring, BillingEmail = "a@b.example", NextBillingDate = "2026-11-01" },
    };

    [Fact]
    public void Adds_up_the_package_portfolio_pricing_add_ons_and_discounts_and_keeps_once_offs_credits_usage_and_tax_apart()
    {
        var cat = Catalogue(includedSchemes: 20, extraSchemePrice: 50);
        var c = CommercialRules.ChargesOn(Agreement(), "2026-10-12", cat, schemes: 24);
        // 9 000 + 4 × 50 schemes + 100 WhatsApp + 2 × 150 storage + 1 200 / 12 API = 9 700; 10% off = 8 730.
        Assert.Equal(200, c.Recurring.Single(l => l.Kind == "extra-schemes").Amount);
        Assert.Equal(-970, c.Recurring.Single(l => l.Kind == "discount").Amount);
        Assert.Equal(8_730, c.RecurringMonthly);
        Assert.Equal([2_500m], c.OnceOff.Select(l => l.Amount!.Value));
        Assert.Equal([-500m], c.Credits.Select(l => l.Amount!.Value));
        Assert.Equal("WhatsApp Communication", c.Usage[0].Label);
        Assert.Equal(new TaxSummary(false, 15, 0), c.Tax);
        Assert.Equal(8_730, c.RecurringWithTax);

        cat.Settings.Tax.VatRegistered = true;
        Assert.Equal(1_309.5m, CommercialRules.ChargesOn(Agreement(), "2026-10-12", cat, 24).Tax.Amount);
    }

    [Fact]
    public void A_line_without_a_price_is_counted_as_awaiting_not_as_zero()
    {
        var a = Agreement();
        a.Packages[0].MonthlyPrice = null;
        var c = CommercialRules.ChargesOn(a, "2026-10-12", Catalogue(), 0);
        Assert.Equal(1, c.AwaitingPrice);
        Assert.Null(c.Recurring.Single(l => l.Kind == "package").Amount);
    }

    [Fact]
    public void The_renewal_fee_is_charged_once_on_the_invoice_covering_the_renewal_date_never_in_the_monthly_total()
    {
        var a = Agreement();
        a.Adjustments.Clear();
        a.Renewal = new Renewal { On = "2026-11-15", Fee = 2_500, PriceSource = PriceSources.Negotiated };
        var cat = Catalogue();
        Assert.Equal(9_500, CommercialRules.ChargesOn(a, "2026-11-01", cat, 0).RecurringMonthly);
        var nov = CommercialRules.BuildInvoice(a, "2026-11-01", cat, 0, "x", "x", "2026-11-01", false);
        Assert.Equal(2_500, nov.Lines.Single(l => l.Kind == "renewal-fee").Amount);
        Assert.Equal(9_500 + 2_500, nov.Subtotal);
        Assert.Equal("2026-11-08", nov.DueOn);
        var dec = CommercialRules.BuildInvoice(a, "2026-12-01", cat, 0, "y", "y", "2026-12-01", false);
        Assert.DoesNotContain(dec.Lines, l => l.Kind == "renewal-fee");
    }

    [Fact]
    public void A_catalogue_price_change_doesn_t_reach_an_existing_agreement_new_lines_take_the_price_in_force_on_their_date()
    {
        var cat = Catalogue();
        var whatsapp = cat.AddOns.Single(x => x.Id == "whatsapp");
        whatsapp.Terms.Insert(0, new AddOnTerms { Version = 2, EffectiveFrom = "2026-12-01", Price = 140, PriceStatus = PriceStatuses.Approved });
        var a = Agreement();
        Assert.Equal(100, CommercialRules.ChargesOn(a, "2027-01-15", cat, 0).Recurring.Single(l => l.Label == "WhatsApp Communication").UnitPrice);

        var fresh = Agreement();
        fresh.AddOns.Clear();
        var before = CommercialRules.ApplyChange(fresh, new AgreementChange { Type = "add-on", AddOnId = "whatsapp", Quantity = 1, EffectiveFrom = "2026-11-01", Reason = "Asked for it" }, cat, Am, Now, "x", Id);
        var after = CommercialRules.ApplyChange(fresh, new AgreementChange { Type = "add-on", AddOnId = "whatsapp", Quantity = 1, EffectiveFrom = "2026-12-01", Reason = "Asked for it" }, cat, Am, Now, "x", Id);
        Assert.Equal((100m, 1), (before.AddOns[0].UnitPrice!.Value, before.AddOns[0].CatalogueVersion!.Value));
        Assert.Equal((140m, 2), (after.AddOns[0].UnitPrice!.Value, after.AddOns[0].CatalogueVersion!.Value));
    }

    [Fact]
    public void A_scheduled_add_on_takes_effect_on_its_date_and_can_be_cancelled_before_then()
    {
        var cat = Catalogue();
        var a = Agreement();
        a.AddOns.RemoveAll(l => l.AddOnId == "whatsapp");
        var change = new AgreementChange { Type = "add-on", AddOnId = "whatsapp", Quantity = 1, EffectiveFrom = "2026-11-01", Reason = "Trustees asked for WhatsApp" };
        var preview = CommercialRules.Preview(a, change, cat, 0, Now);
        Assert.Null(preview.Errors);
        Assert.Equal(90, preview.Difference); // R100, 10% off
        Assert.Equal("2026-11-01", preview.FirstInvoiceOn);

        var next = CommercialRules.ApplyChange(a, change, cat, Am, Now, "Scheduled WhatsApp", Id);
        Assert.Equal(2, next.Version);
        Assert.DoesNotContain(CommercialRules.InForce(next.AddOns, "2026-10-31"), l => l.AddOnId == "whatsapp");
        Assert.Contains(CommercialRules.InForce(next.AddOns, "2026-11-01"), l => l.AddOnId == "whatsapp");
        Assert.Equal("Scheduled WhatsApp", next.History[0].Action);
        Assert.Equal("D11", next.History[0].Approval);

        var line = next.AddOns.Single(l => l.AddOnId == "whatsapp");
        Assert.Equal("They already have this add-on then.", CommercialRules.CheckChange(next, change, cat, "2026-10-12")["addOnId"]);
        var cancel = new AgreementChange { Type = "cancel-scheduled", LineId = line.Id, Reason = "Customer changed their mind" };
        Assert.Empty(CommercialRules.CheckChange(next, cancel, cat, "2026-10-12"));
        Assert.Contains("lineId", CommercialRules.CheckChange(next, cancel, cat, "2026-11-01").Keys);
        Assert.DoesNotContain(CommercialRules.ApplyChange(next, cancel, cat, Am, Now, "x", Id).AddOns, l => l.AddOnId == "whatsapp");
    }

    [Fact]
    public void Cancelling_a_scheduled_package_lets_the_current_one_carry_on()
    {
        var cat = Catalogue();
        var a = CommercialRules.ApplyChange(Agreement(), new AgreementChange { Type = "package", PackageId = "enterprise", EffectiveFrom = "2027-01-01", MonthlyPrice = 15_000, MonthlyPriceGiven = true, Reason = "Moving up in January" }, cat, Am, Now, "x", Id);
        Assert.Equal("2027-01-01", a.Packages[0].Until);
        Assert.Equal("enterprise", CommercialRules.PackageOn(a, "2027-01-01")!.PackageId);
        var scheduled = a.Packages.Single(l => l.PackageId == "enterprise");
        var back = CommercialRules.ApplyChange(a, new AgreementChange { Type = "cancel-scheduled", LineId = scheduled.Id, Reason = "Not this year after all" }, cat, Am, Now, "x", Id);
        Assert.Single(back.Packages);
        Assert.Null(back.Packages[0].Until);
    }

    [Fact]
    public void Refuses_an_unpriced_add_on_without_an_agreed_price_and_a_date_in_the_past()
    {
        var cat = Catalogue();
        var e = CommercialRules.CheckChange(Agreement(), new AgreementChange { Type = "add-on", AddOnId = "governance", Quantity = 1, EffectiveFrom = "2026-10-01", Reason = "x" }, cat, "2026-10-12");
        Assert.Equal("Choose today or a later date.", e["effectiveFrom"]);
        Assert.Equal("This add-on has no catalogue price yet. Enter the price agreed with the customer.", e["unitPrice"]);
        Assert.Contains("reason", e.Keys);
        var agreed = new AgreementChange { Type = "add-on", AddOnId = "governance", Quantity = 1, EffectiveFrom = "2026-10-12", UnitPrice = 1_500, UnitPriceGiven = true, Reason = "Agreed with the board" };
        Assert.Empty(CommercialRules.CheckChange(Agreement(), agreed, cat, "2026-10-12"));
        Assert.Equal(PriceSources.Negotiated, CommercialRules.ApplyChange(Agreement(), agreed, cat, Am, Now, "x", Id).AddOns[^1].PriceSource);
    }

    [Fact]
    public void A_package_at_catalogue_price_brings_the_catalogue_renewal_fee_an_agreed_fee_stays()
    {
        var cat = Catalogue();
        var ent = cat.Packages.Single(p => p.PackageId == "enterprise").Terms[0];
        ent.MonthlyPrice = 20_000;
        ent.AnnualRenewalFee = 4_000;
        var a = Agreement();
        var moved = CommercialRules.ApplyChange(a, new AgreementChange { Type = "package", PackageId = "enterprise", EffectiveFrom = "2026-10-12", Reason = "Moving to Enterprise" }, cat, Am, Now, "x", Id);
        Assert.Equal((4_000m, PriceSources.Catalogue), (moved.Renewal.Fee!.Value, moved.Renewal.PriceSource));

        a.Renewal = new Renewal { On = "2027-05-01", Fee = 3_000, PriceSource = PriceSources.Negotiated };
        var kept = CommercialRules.ApplyChange(a, new AgreementChange { Type = "package", PackageId = "enterprise", EffectiveFrom = "2026-10-12", Reason = "Moving to Enterprise" }, cat, Am, Now, "x", Id);
        Assert.Equal(3_000, kept.Renewal.Fee);
    }

    [Fact]
    public void Daily_pro_rata_charges_each_line_for_the_days_it_was_in_force()
    {
        var cat = Catalogue();
        cat.Settings.Proration = ProrationPolicies.Daily;
        var a = Agreement();
        a.Adjustments.Clear();
        a.AddOns.Clear();
        a.AddOns.Add(new AddOnLine { Id = "w", AddOnId = "whatsapp", Quantity = 1, From = "2026-11-16", UnitPrice = 300, PriceSource = PriceSources.Catalogue });
        var inv = CommercialRules.BuildInvoice(a, "2026-11-01", cat, 0, "i", "r", "2026-11-01", false);
        // 30 days: the package all month, WhatsApp for the last 15.
        Assert.Equal(9_000, inv.Lines.Where(l => l.Kind == "package").Sum(l => l.Amount));
        Assert.Equal(150, inv.Lines.Single(l => l.Kind == "add-on").Amount);
        Assert.Contains("(15 of 30 days)", inv.Lines.Single(l => l.Kind == "add-on").Description);
    }

    [Fact]
    public void The_storage_allowance_adds_packs_and_unexpired_exceptions_and_warns_at_the_thresholds()
    {
        var cat = Catalogue();
        var a = Agreement();
        a.StorageExceptions.Add(new StorageException { Id = "x", ExtraGb = 5, Until = "2999-01-01" });
        a.StorageExceptions.Add(new StorageException { Id = "y", ExtraGb = 50, Until = "2026-01-01" });
        StorageSummary Used(decimal gb) => CommercialRules.Storage(a, cat, new StorageMeasurement("x", "", "measured", (long)(gb * CommercialRules.Gb), 0, 0), "2026-10-12");
        var s = Used(10);
        Assert.Equal((25m, 20m, 5m, 50m, false), (s.IncludedGb!.Value, s.PurchasedGb, s.ExceptionGb, s.TotalGb!.Value, s.EnforcedByServer));
        Assert.Equal(("ok", 20m), (s.State, s.Percent!.Value));
        Assert.Equal("warning", Used(41).State);
        Assert.Equal("critical", Used(48).State);
        Assert.Equal("exhausted", Used(50).State);
    }

    [Fact]
    public void Entitlements_come_from_the_package_with_inheritance_then_add_ons_then_unexpired_overrides()
    {
        var now = new DateTimeOffset(2026, 10, 19, 8, 0, 0, TimeSpan.Zero);
        var addOns = InitialCatalogue.Load().AddOns.Select(a => new AddOnFeatures(a.Id, a.Name, a.Features));
        SubscriptionView Sub(string status = "active", params FeatureOverride[] overrides) =>
            new("o", 1, "professional", status, "", "", [new SubscriptionAddOn("governance", "2026-01-01")], overrides, 0, 5);
        bool On(List<Entitlement> e, string f) => e.Single(x => x.Feature == f).Enabled;

        var e = EntitlementEngine.Resolve(Sub(), now, addOns);
        Assert.True(On(e, "units"));            // inherited from Essentials
        Assert.True(On(e, "levies"));           // Professional
        Assert.False(On(e, "compliance"));      // Enterprise only
        Assert.Equal("Governance add-on", e.Single(x => x.Feature == "meetings").SourceLabel);

        e = EntitlementEngine.Resolve(Sub("active", new FeatureOverride("compliance", true, "Trial", "Mashoto", "", "2026-10-31T00:00:00+02:00"),
            new FeatureOverride("api", true, "Old trial", "Mashoto", "", "2026-10-01T00:00:00+02:00")), now, addOns);
        Assert.True(On(e, "compliance"));
        Assert.Equal("Granted until 31 Oct · Trial", e.Single(x => x.Feature == "compliance").SourceLabel);
        Assert.False(On(e, "api"));

        e = EntitlementEngine.Resolve(Sub("suspended"), now, addOns);
        Assert.False(On(e, "units"));
        Assert.True(On(e, "audit-log"));        // baseline: Humo never sells safety as an upgrade
    }
}
