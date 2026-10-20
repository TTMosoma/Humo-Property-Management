using System.Net.Http.Json;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>SMS (and WhatsApp) allowances: what each package includes, bundles on top, usage per calendar month with no roll-over.</summary>
public sealed class MessageAllowanceTests : IDisposable
{
    private readonly HumoApiFactory api = new HumoApiFactory().With("Sms:Provider", "Captured");

    public void Dispose() => api.Dispose();

    private static CommercialAgreement Agreement(string packageId, params (string AddOn, int Quantity)[] addOns) => new()
    {
        Packages = [new PackageLine { Id = "p1", From = "2026-01-01", PackageId = packageId }],
        AddOns = [.. addOns.Select((x, i) => new AddOnLine { Id = $"a{i}", From = "2026-01-01", AddOnId = x.AddOn, Quantity = x.Quantity })],
    };

    [Theory]
    [InlineData("essentials", 20)]
    [InlineData("professional", 100)]
    [InlineData("enterprise", 500)]
    public void Each_package_includes_its_SMS(string package, int included)
    {
        var cat = InitialCatalogue.Load();
        var sms = Assert.Single(CommercialRules.Messages(Agreement(package), cat, "2026-10-20", new Dictionary<string, int>()));
        Assert.Equal(("sms", included, 0, included, "2026-10", "2026-11-01"), (sms.Channel, sms.Included, sms.Bundles, sms.Allowance, sms.Period, sms.ResetsOn));
        Assert.Equal(125m, CommercialRules.TermsOn(CommercialRules.PackageDef(cat, "enterprise")!.Terms, "2026-10-20")!.IncludedStorageGb);
    }

    [Fact]
    public void Bundles_stack_on_the_package_and_usage_over_the_allowance_shows()
    {
        var cat = InitialCatalogue.Load();
        var list = CommercialRules.Messages(Agreement("professional", ("sms-bundle", 2), ("whatsapp", 1)), cat, "2026-10-20", new Dictionary<string, int> { ["sms"] = 2_150, ["whatsapp"] = 10 });
        var sms = list.Single(m => m.Channel == "sms");
        Assert.Equal((100, 2_000, 2_100, 2_150, 0, "over"), (sms.Included, sms.Bundles, sms.Allowance, sms.Used, sms.Remaining, sms.State));
        var whatsapp = list.Single(m => m.Channel == "whatsapp");
        Assert.Equal((500, 490, "ok"), (whatsapp.Allowance, whatsapp.Remaining, whatsapp.State));
    }

    [Theory]
    [InlineData(160, 'a', 1)]
    [InlineData(161, 'a', 2)]
    [InlineData(306, 'a', 2)]
    [InlineData(307, 'a', 3)]
    [InlineData(70, '’', 1)]
    [InlineData(71, '’', 2)]
    public void SMS_count_in_billed_parts(int length, char c, int parts) => Assert.Equal(parts, CommercialRules.SmsParts(new string(c, length)));

    [Fact]
    public async Task Sending_an_SMS_counts_against_this_months_allowance_and_a_new_month_starts_from_zero()
    {
        var org = await api.Customer("Acacia", "professional");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = Guid.Parse((await (await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" })).Json()).GetProperty("id").GetString()!);
        var unit = Guid.Parse((await (await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "12", description = "3-bed", sizeM2 = 120, participationQuota = 2, monthlyLevy = 1800, occupancy = "owner-occupied" })).Json()).GetProperty("id").GetString()!);
        await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Lindiwe", lastName = "Mokoena", kind = "individual", email = "", phone = "082 123 4567", preferredChannel = "sms" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = unit.ToString(), since = "2021-02-01" },
        });

        var before = (await (await admin.GetAsync($"/api/organisations/{org}/plan")).Json()).GetProperty("messages");
        var sms = Assert.Single(before.EnumerateArray());
        Assert.Equal(("sms", 100, 0), (sms.GetProperty("channel").GetString(), sms.GetProperty("allowance").GetInt32(), sms.GetProperty("used").GetInt32()));

        // Two parts: just over one SMS.
        var body = "Water is off on Thursday from 09:00 to 13:00 while the plumber replaces the main valve on Block A. Please keep some water aside, and switch your geyser off until it's back on.";
        Assert.Equal(System.Net.HttpStatusCode.Created, (await admin.PostAsJsonAsync("/api/communications/messages", new { audience = new { schemeId = kc.ToString(), kind = "owners" }, subject = "", body, channels = new[] { "sms" } })).StatusCode);
        await HumoApiFactory.Until(() => !api.Sms.Sent.IsEmpty);
        await HumoApiFactory.Until(() => api.Db(db => db.MessageUsage.AnyAsync()));
        sms = (await (await admin.GetAsync($"/api/organisations/{org}/plan")).Json()).GetProperty("messages")[0];
        Assert.Equal((2, 98), (sms.GetProperty("used").GetInt32(), sms.GetProperty("remaining").GetInt32()));

        // Next month: the allowance is whole again; October's use stays on record.
        api.Clock.Advance(TimeSpan.FromDays(14));
        admin = await api.SignedIn("thandeka@acacia.example");
        sms = (await (await admin.GetAsync($"/api/organisations/{org}/plan")).Json()).GetProperty("messages")[0];
        Assert.Equal(("2026-11", 0, 100), (sms.GetProperty("period").GetString(), sms.GetProperty("used").GetInt32(), sms.GetProperty("remaining").GetInt32()));
        Assert.Equal(2, await api.Db(db => db.MessageUsage.Where(u => u.Period == "2026-10").Select(u => u.Units).SingleAsync()));
    }
}
