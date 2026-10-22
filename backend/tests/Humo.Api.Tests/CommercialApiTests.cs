using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Subscriptions, entitlements and agreements on the API (docs/04, docs/23).</summary>
public sealed class CommercialApiTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.OK, await res.Content.ReadAsStringAsync());
        return await res.Json();
    }

    private static async Task NoContent(HttpResponseMessage res) => Assert.True(res.StatusCode == HttpStatusCode.NoContent, await res.Content.ReadAsStringAsync());

    private static bool Has(JsonElement entitlements, string feature) => entitlements.EnumerateArray().Single(e => e.GetProperty("feature").GetString() == feature).GetProperty("enabled").GetBoolean();

    [Fact]
    public async Task An_approved_account_starts_a_trial_and_the_session_carries_its_entitlements()
    {
        var mashoto = await api.Person("mashoto@humo.co.za", Roles.AccountManager, null);
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        var submit = await admin.PostAsJsonAsync("/api/platform/account-requests", new { name = "Coastline Estates CC", shortName = "Coastline", city = "Durban", province = "KwaZulu-Natal", packageId = "essentials", accountManagerId = mashoto.ToString() });
        var id = (await submit.Json()).GetProperty("requestId").GetString();
        await NoContent(await admin.PostAsJsonAsync($"/api/platform/account-requests/{id}/decision", new { type = "approve" }));

        var org = await api.Db(db => db.Organisations.SingleAsync());
        Assert.Equal("trial", (await api.Db(db => db.Subscriptions.SingleAsync())).Status);
        await api.Person("ayo@coastline.example", Roles.AgencyAdmin, org.Id);
        var me = await Ok(await (await api.SignedIn("ayo@coastline.example")).GetAsync("/api/me"));
        Assert.Equal("essentials", me.GetProperty("subscription").GetProperty("packageId").GetString());
        Assert.True(Has(me.GetProperty("entitlements"), "units"));
        Assert.False(Has(me.GetProperty("entitlements"), "levies"));

        // Humo staff have no customer plan.
        Assert.Equal(JsonValueKind.Null, (await Ok(await admin.GetAsync("/api/me"))).GetProperty("entitlements").ValueKind);
    }

    [Fact]
    public async Task The_trustee_board_needs_Governance_and_the_account_manager_switches_it_on_for_their_own_customer()
    {
        var mashoto = await api.Person("mashoto@humo.co.za", Roles.AccountManager, null);
        await api.Person("dumisani@humo.co.za", Roles.AccountManager, null);
        var org = await api.Customer("Acacia", "professional", mashoto);
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var agency = await api.SignedIn("thandeka@acacia.example");
        var kc = (await (await agency.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" })).Json()).GetProperty("id").GetString();
        var appoint = new { type = "appoint", personId = Guid.NewGuid().ToString(), portfolio = "Chairperson", how = "co-opted", since = "2026-03-01" };
        Assert.Equal("not-entitled", await (await agency.PostAsJsonAsync($"/api/boards/{kc}/actions", appoint)).ProblemCode());

        var grant = new { change = new { type = "add-on", addOnId = "governance", enabled = true, reason = "Trustees asked for board tools" }, expectedVersion = 1 };
        // Another Account Manager's customer: refused, and audited.
        var other = await api.SignedIn("dumisani@humo.co.za");
        await other.StepUp();
        Assert.Equal("forbidden", await (await other.PostAsJsonAsync($"/api/platform/customers/{org}/subscription", grant)).ProblemCode());

        var am = await api.SignedIn("mashoto@humo.co.za");
        Assert.Equal("step-up-required", await (await am.PostAsJsonAsync($"/api/platform/customers/{org}/subscription", grant)).ProblemCode());
        await am.StepUp();
        await NoContent(await am.PostAsJsonAsync($"/api/platform/customers/{org}/subscription", grant));
        Assert.Equal(HttpStatusCode.Conflict, (await am.PostAsJsonAsync($"/api/platform/customers/{org}/subscription", grant)).StatusCode);

        var customer = await Ok(await am.GetAsync($"/api/platform/customers/{org}"));
        Assert.Equal("Governance add-on", customer.GetProperty("entitlements").EnumerateArray().Single(e => e.GetProperty("feature").GetString() == "meetings").GetProperty("sourceLabel").GetString());
        // Manage features doesn't change what they pay: no catalogue price, so it's included in the agreed price.
        var view = await Ok(await am.GetAsync($"/api/platform/customers/{org}/commercial"));
        Assert.Equal("included", view.GetProperty("agreement").GetProperty("addOns")[0].GetProperty("priceSource").GetString());

        // The board is now part of their plan: the command passes the entitlement check and reaches validation.
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await agency.PostAsJsonAsync($"/api/boards/{kc}/actions", appoint)).StatusCode);
        // The other manager's refusal is audited; asking for step-up and the stale version change nothing.
        var audit = await api.Db(db => db.Audit.Where(a => a.Resource == "Subscription").Select(a => a.Result).ToListAsync());
        Assert.Equal(["denied", "success"], audit);
    }

    [Fact]
    public async Task An_account_manager_previews_then_schedules_a_priced_add_on_with_the_reason_in_the_history()
    {
        var mashoto = await api.Person("mashoto@humo.co.za", Roles.AccountManager, null);
        var org = await api.Customer("Acacia", "professional", mashoto);
        var am = await api.SignedIn("mashoto@humo.co.za");
        var change = new { type = "add-on", addOnId = "whatsapp", quantity = 1, effectiveFrom = "2026-11-01", reason = "Trustees want WhatsApp reminders" };

        var preview = await Ok(await am.PostAsJsonAsync($"/api/platform/customers/{org}/agreement/preview", new { change }));
        Assert.Equal(100, preview.GetProperty("difference").GetDecimal());
        Assert.Equal(JsonValueKind.Null, preview.GetProperty("errors").ValueKind);
        Assert.Equal(1, await api.Db(db => db.Agreements.Select(a => a.Version).SingleAsync()));

        await am.StepUp();
        await NoContent(await am.PostAsJsonAsync($"/api/platform/customers/{org}/agreement/changes", new { change, expectedVersion = 1 }));
        var view = await Ok(await am.GetAsync($"/api/platform/customers/{org}/commercial"));
        var scheduled = Assert.Single(view.GetProperty("scheduled").EnumerateArray());
        Assert.Equal(("add-on", "2026-11-01", 100m), (scheduled.GetProperty("kind").GetString(), scheduled.GetProperty("from").GetString(), scheduled.GetProperty("monthlyChange").GetDecimal()));
        var history = view.GetProperty("agreement").GetProperty("history")[0];
        Assert.Equal("Trustees want WhatsApp reminders", history.GetProperty("reason").GetString());
        Assert.Contains("D11", history.GetProperty("approval").GetString());
        Assert.Contains(await api.Db(db => db.Audit.Select(a => a.Action).ToListAsync()), a => a.StartsWith("Scheduled the WhatsApp Communication add-on at R100 a month from 2026-11-01 for Acacia"));

        // An unpriced add-on needs the price agreed with the customer.
        var unpriced = await am.PostAsJsonAsync($"/api/platform/customers/{org}/agreement/changes", new { change = new { type = "add-on", addOnId = "compliance", quantity = 1, effectiveFrom = "2026-11-01", reason = "They need compliance tracking" }, expectedVersion = 2 });
        Assert.True((await unpriced.FieldErrors()).TryGetProperty("unitPrice", out _));
    }

    [Fact]
    public async Task Support_can_t_see_prices_the_executive_can_see_but_not_change_and_customers_see_only_their_own_plan()
    {
        var mashoto = await api.Person("mashoto@humo.co.za", Roles.AccountManager, null);
        var org = await api.Customer("Acacia", "professional", mashoto);
        var other = await api.Customer("Fynbos");
        await api.Person("lerato@humo.co.za", Roles.Support, null);
        await api.Person("sizwe@humo.co.za", Roles.Executive, null);
        var support = await api.SignedIn("lerato@humo.co.za");
        Assert.Equal("forbidden", await (await support.GetAsync($"/api/platform/customers/{org}/commercial")).ProblemCode());
        Assert.Equal("forbidden", await (await support.GetAsync("/api/platform/commercial/catalogue")).ProblemCode());
        var list = await Ok(await support.GetAsync("/api/platform/customers"));
        Assert.Equal(2, list.GetProperty("total").GetInt32());

        var exec = await api.SignedIn("sizwe@humo.co.za");
        await Ok(await exec.GetAsync($"/api/platform/customers/{org}/commercial"));
        await exec.StepUp();
        Assert.Equal("forbidden", await (await exec.PostAsJsonAsync($"/api/platform/customers/{org}/agreement/changes", new { change = new { type = "renewal", on = "2027-06-01", fee = 1000, reason = "Agreed at renewal" } })).ProblemCode());
        var overview = await Ok(await exec.GetAsync("/api/platform/overview"));
        Assert.Equal(2, overview.GetProperty("customers").GetInt32());

        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var agency = await api.SignedIn("thandeka@acacia.example");
        var plan = await Ok(await agency.GetAsync($"/api/organisations/{org}/plan"));
        Assert.Equal(("professional", "manual-eft"), (plan.GetProperty("packageId").GetString(), plan.GetProperty("billing").GetProperty("preference").GetString()));
        Assert.False(plan.TryGetProperty("health", out _));
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync($"/api/organisations/{other}/plan")).StatusCode);
        Assert.Equal("forbidden", await (await agency.GetAsync("/api/platform/commercial/catalogue")).ProblemCode());

        // Asking Humo about an add-on: their account manager hears about it, in the app and by email.
        api.Email.Sent.Clear();
        await NoContent(await agency.PostAsJsonAsync($"/api/organisations/{org}/upgrade-requests", new { addOn = "whatsapp", note = "For levy reminders", source = "plan-page" }));
        Assert.Equal("mashoto@humo.co.za", Assert.Single(api.Email.Sent).To);
        var request = (await Ok(await agency.GetAsync($"/api/organisations/{org}/plan"))).GetProperty("requests")[0];
        Assert.Equal(("whatsapp", "new"), (request.GetProperty("addOn").GetString(), request.GetProperty("status").GetString()));
    }

    [Fact]
    public async Task Health_uses_only_what_Humo_measures_and_says_so()
    {
        var org = await api.Customer("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        await api.SignedIn("thandeka@acacia.example");
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        var c = await Ok(await admin.GetAsync($"/api/platform/customers/{org}"));
        var health = c.GetProperty("health");
        Assert.True(health.GetProperty("partial").GetBoolean());
        var measured = health.GetProperty("signals").EnumerateArray().Where(s => s.GetProperty("measured").GetBoolean()).Select(s => s.GetProperty("key").GetString()).ToList();
        Assert.Equal(["active-users", "logins", "payment"], measured);
        Assert.Equal(1, c.GetProperty("snapshot").GetProperty("activeUsers30d").GetInt32());
        Assert.Empty(c.GetProperty("opportunities").EnumerateArray());
    }

    [Fact]
    public async Task A_System_Administrator_sets_package_terms_as_a_new_version_and_account_managers_can_t()
    {
        await api.Person("mashoto@humo.co.za", Roles.AccountManager, null);
        var terms = new { effectiveFrom = "2026-11-01", monthlyPrice = 9500, annualPrice = 102600, priceStatus = "approved", includedStorageGb = 25, storageStatus = "approved", includedSchemes = 20, extraSchemePrice = 45, annualRenewalFee = 2400, reason = "Board approved the 2027 price list" };
        var am = await api.SignedIn("mashoto@humo.co.za");
        await am.StepUp();
        Assert.Equal("forbidden", await (await am.PutAsJsonAsync("/api/platform/commercial/packages/professional/terms", terms)).ProblemCode());

        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();
        await NoContent(await admin.PutAsJsonAsync("/api/platform/commercial/packages/professional/terms", terms));
        var cat = await Ok(await admin.GetAsync("/api/platform/commercial/catalogue"));
        var pro = cat.GetProperty("packages").EnumerateArray().Single(p => p.GetProperty("packageId").GetString() == "professional").GetProperty("terms");
        Assert.Equal((9500m, 3), (pro[0].GetProperty("monthlyPrice").GetDecimal(), pro[0].GetProperty("version").GetInt32()));
        Assert.Equal(2400m, pro[1].GetProperty("monthlyPrice").GetDecimal());

        var addOn = new { id = "postage-pack", name = "Postage pack", description = "100 printed and posted letters a month.", kind = "communication", features = new[] { "communications" }, allowQuantity = true, status = "active", effectiveFrom = "2026-10-19", price = 250, frequency = "monthly", priceStatus = "proposed", usageAllowance = new { unit = "letters", included = 100 }, reason = "New pack for agencies that post letters", isNew = true };
        await NoContent(await admin.PutAsJsonAsync("/api/platform/commercial/add-ons/postage-pack", addOn));
        Assert.Contains((await Ok(await admin.GetAsync("/api/catalogue"))).GetProperty("addOns").EnumerateArray(), a => a.GetProperty("id").GetString() == "postage-pack");
    }

    [Fact]
    public async Task A_discount_above_twenty_percent_waits_for_Humo_Finance_and_the_asker_can_t_approve_it()
    {
        var mashoto = await api.Person("mashoto@humo.co.za", Roles.AccountManager, null);
        await api.Person("refilwe@humo.co.za", Roles.HumoFinance, null);
        var org = await api.Customer("Acacia", "professional", mashoto);
        var am = await api.SignedIn("mashoto@humo.co.za");
        await am.StepUp();
        var big = new { change = new { type = "adjustment", kind = "discount", label = "Loyalty", amount = 0, percent = 30, from = "2026-11-01", reason = "Long-standing customer, agreed at renewal" } };
        Assert.Equal("30% off (more than 20%)", (await Ok(await am.PostAsJsonAsync($"/api/platform/customers/{org}/agreement/preview", big))).GetProperty("approvalNeeded").GetString());
        api.Email.Sent.Clear();
        var asked = await am.PostAsJsonAsync($"/api/platform/customers/{org}/agreement/changes", big);
        Assert.Equal(HttpStatusCode.Accepted, asked.StatusCode);
        // Humo Finance hears about it.
        Assert.Equal("refilwe@humo.co.za", Assert.Single(api.Email.Sent).To);
        var view = await Ok(await am.GetAsync($"/api/platform/customers/{org}/commercial"));
        Assert.Empty(view.GetProperty("agreement").GetProperty("adjustments").EnumerateArray());
        var approval = Assert.Single(view.GetProperty("agreement").GetProperty("pendingApprovals").EnumerateArray()).GetProperty("id").GetString();

        Assert.Equal("forbidden", await (await am.PostAsJsonAsync($"/api/platform/customers/{org}/agreement/approvals/{approval}", new { decision = "approve" })).ProblemCode());
        var finance = await api.SignedIn("refilwe@humo.co.za");
        await finance.StepUp();
        await NoContent(await finance.PostAsJsonAsync($"/api/platform/customers/{org}/agreement/approvals/{approval}", new { decision = "approve" }));
        var agreement = (await Ok(await am.GetAsync($"/api/platform/customers/{org}/commercial"))).GetProperty("agreement");
        Assert.Equal(30, agreement.GetProperty("adjustments")[0].GetProperty("percent").GetDecimal());
        Assert.Empty(agreement.GetProperty("pendingApprovals").EnumerateArray());
        Assert.StartsWith("Approved by refilwe", agreement.GetProperty("history")[0].GetProperty("approval").GetString());

        // Within the threshold, it applies at once.
        var small = new { change = new { type = "adjustment", kind = "discount", label = "Small", amount = 0, percent = 20, from = "2026-11-01", reason = "Within the Account Manager's authority" } };
        await NoContent(await am.PostAsJsonAsync($"/api/platform/customers/{org}/agreement/changes", small));
    }

    [Fact]
    public async Task An_agency_administrator_sets_their_own_passkey_approval_threshold()
    {
        var org = await api.Customer("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        await api.Person("lerato@acacia.example", Roles.PortfolioManager, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        Assert.Equal(50_000, (await Ok(await admin.GetAsync("/api/me"))).GetProperty("organisation").GetProperty("approvalStepUpAmount").GetDecimal());
        var body = new { amount = 25_000, reason = "Our board wants a passkey for smaller amounts too", expectedVersion = 1 };
        Assert.Equal("step-up-required", await (await admin.PutAsJsonAsync($"/api/organisations/{org}/approval-policy", body)).ProblemCode());
        await admin.StepUp();
        Assert.True((await (await admin.PutAsJsonAsync($"/api/organisations/{org}/approval-policy", new { amount = 10, reason = "Too low", expectedVersion = 1 })).FieldErrors()).TryGetProperty("amount", out _));
        await NoContent(await admin.PutAsJsonAsync($"/api/organisations/{org}/approval-policy", body));
        Assert.Equal(25_000, (await Ok(await admin.GetAsync("/api/me"))).GetProperty("organisation").GetProperty("approvalStepUpAmount").GetDecimal());

        var pm = await api.SignedIn("lerato@acacia.example");
        await pm.StepUp();
        Assert.Equal("forbidden", await (await pm.PutAsJsonAsync($"/api/organisations/{org}/approval-policy", body with { expectedVersion = 2 })).ProblemCode());
    }
}
