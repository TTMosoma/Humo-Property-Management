using System.Net;
using System.Net.Http.Json;
using Humo.Domain.Access;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Organisations and schemes (doc 24 §1, §3, §4), through the real command pipeline.</summary>
public sealed class PortfolioTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private static object Scheme(string name = "Kingfisher Court", string code = "kc", int? expectedVersion = null) =>
        new { name, code, type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng", expectedVersion };

    private async Task<(Guid org, HttpClient admin)> Agency()
    {
        var org = await api.Organisation("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        return (org, await api.SignedIn("thandeka@acacia.example"));
    }

    private static async Task<Guid> Create(HttpClient client, object body)
    {
        var res = await client.PostAsJsonAsync("/api/schemes", body);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    [Fact]
    public async Task An_Agency_Administrator_adds_a_scheme_which_starts_onboarding()
    {
        var (org, admin) = await Agency();
        var id = await Create(admin, Scheme());

        var scheme = await (await admin.GetAsync($"/api/schemes/{id}")).Json();
        Assert.Equal("KC", scheme.GetProperty("code").GetString());
        Assert.Equal("onboarding", scheme.GetProperty("status").GetString());
        Assert.Equal(org.ToString(), scheme.GetProperty("organisationId").GetString());
        Assert.Single((await (await admin.GetAsync("/api/schemes")).Json()).EnumerateArray());
        Assert.Single((await (await admin.GetAsync("/api/schemes/health")).Json()).EnumerateArray());
        Assert.Contains(await api.Db(db => db.Audit.Select(a => a.Action).ToListAsync()), a => a == "Added scheme Kingfisher Court");
    }

    [Fact]
    public async Task Scheme_details_are_validated_after_permission()
    {
        var (_, admin) = await Agency();
        await Create(admin, Scheme());

        var bad = await admin.PostAsJsonAsync("/api/schemes", new { name = "X", code = "K1", type = "Castle", suburb = "", city = "", province = "Atlantis" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, bad.StatusCode);
        var errors = await bad.FieldErrors();
        foreach (var field in new[] { "name", "code", "type", "suburb", "city", "province" }) Assert.True(errors.TryGetProperty(field, out _), field);

        var duplicate = await admin.PostAsJsonAsync("/api/schemes", Scheme("Another", "KC"));
        Assert.Equal("Another scheme already uses this code.", (await duplicate.FieldErrors()).GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_stale_version_is_a_conflict()
    {
        var (_, admin) = await Agency();
        var id = await Create(admin, Scheme());
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsJsonAsync($"/api/schemes/{id}", Scheme("Kingfisher Court East", "KC", expectedVersion: 1))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync($"/api/schemes/{id}", Scheme("Again", "KC", expectedVersion: 1))).StatusCode);
    }

    [Fact]
    public async Task Scheme_status_follows_the_lifecycle_with_a_reason()
    {
        var (_, admin) = await Agency();
        var id = await Create(admin, Scheme());

        var skip = await admin.PostAsJsonAsync($"/api/schemes/{id}/status", new { status = "closed", reason = "Testing the rules" });
        Assert.Equal("A onboarding scheme can’t be moved to closed.", (await skip.FieldErrors()).GetProperty("status").GetString());
        var terse = await admin.PostAsJsonAsync($"/api/schemes/{id}/status", new { status = "active", reason = "ok" });
        Assert.True((await terse.FieldErrors()).TryGetProperty("reason", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/schemes/{id}/status", new { status = "active", reason = "Handover complete" })).StatusCode);
    }

    [Fact]
    public async Task A_scheme_limited_Portfolio_Manager_sees_and_changes_only_their_schemes()
    {
        var (org, admin) = await Agency();
        var kc = await Create(admin, Scheme());
        var tw = await Create(admin, Scheme("The Willows", "TW"));
        await api.Person("johan@acacia.example", Roles.PortfolioManager, org, [kc]);
        var johan = await api.SignedIn("johan@acacia.example");

        var list = (await (await johan.GetAsync("/api/schemes")).Json()).EnumerateArray().Select(s => s.GetProperty("code").GetString()).ToList();
        Assert.Equal(["KC"], list);
        // Someone else's scheme is "not found", never "forbidden" (S6).
        Assert.Equal(HttpStatusCode.NotFound, (await johan.GetAsync($"/api/schemes/{tw}")).StatusCode);

        // He's the portfolio manager the scheme shows.
        var scheme = await (await admin.GetAsync($"/api/schemes/{kc}")).Json();
        Assert.Equal("johan", scheme.GetProperty("portfolioManager").GetProperty("name").GetString());
    }

    [Fact]
    public async Task Browsing_the_agency_shows_every_scheme_D1()
    {
        var (org, admin) = await Agency();
        var kc = await Create(admin, Scheme());
        var tw = await Create(admin, Scheme("The Willows", "TW"));
        await api.Person("sarah@acacia.example", Roles.PortfolioManager, org, [kc], "Portfolio.BrowseAgency");
        var sarah = await api.SignedIn("sarah@acacia.example");

        Assert.Equal(2, (await (await sarah.GetAsync("/api/schemes")).Json()).GetArrayLength());
        Assert.Equal(HttpStatusCode.OK, (await sarah.GetAsync($"/api/schemes/{tw}")).StatusCode);
        // Changing a scheme's status is the Agency Administrator's (Schemes.Manage): refused before scope is even considered.
        var change = await sarah.PostAsJsonAsync($"/api/schemes/{tw}/status", new { status = "active", reason = "Should be refused" });
        Assert.Equal("forbidden", await change.ProblemCode());
        Assert.Contains(await api.Db(db => db.Audit.Where(a => a.Result == "denied").Select(a => a.Reason).ToListAsync()), r => r == "Role does not have this permission");
    }

    [Fact]
    public async Task Customers_see_only_their_own_organisation()
    {
        var (org, admin) = await Agency();
        var other = await api.Organisation("Marula");
        var mine = await (await admin.GetAsync("/api/organisations")).Json();
        Assert.Equal([org.ToString()], mine.EnumerateArray().Select(o => o.GetProperty("id").GetString()));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/organisations/{other}")).StatusCode);

        // Their own details are Humo's to change (Platform.Customers.Manage): refused and audited.
        var edit = await admin.PutAsJsonAsync($"/api/organisations/{org}", new { name = "Acacia Managing Agents", shortName = "Acacia", city = "Sandton", province = "Gauteng" });
        Assert.Equal("forbidden", await edit.ProblemCode());
    }

    [Fact]
    public async Task Humo_staff_manage_every_organisation_and_suspending_needs_step_up()
    {
        var acacia = await api.Organisation("Acacia", OrganisationStatuses.Onboarding);
        await api.Organisation("Marula");
        var humo = await api.SignedIn(HumoApiFactory.AdminEmail);

        Assert.Equal(2, (await (await humo.GetAsync("/api/organisations")).Json()).GetArrayLength());
        var rename = await humo.PutAsJsonAsync($"/api/organisations/{acacia}", new { name = "Acacia Managing Agents", shortName = "marula", city = "Sandton", province = "Gauteng", expectedVersion = 1 });
        Assert.Equal("Another customer already uses this name.", (await rename.FieldErrors()).GetProperty("shortName").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await humo.PostAsJsonAsync($"/api/organisations/{acacia}/status", new { status = "active", reason = "Onboarding complete" })).StatusCode);
        var suspend = await humo.PostAsJsonAsync($"/api/organisations/{acacia}/status", new { status = "suspended", reason = "Account unpaid for 90 days" });
        Assert.Equal("step-up-required", await suspend.ProblemCode());
        Assert.Equal("active", await api.Db(db => db.Organisations.Where(o => o.Id == acacia).Select(o => o.Status).SingleAsync()));
    }

    [Fact]
    public async Task People_in_a_suspended_organisation_can_t_work()
    {
        var (org, admin) = await Agency();
        await api.Db(db => db.Organisations.Where(o => o.Id == org).ExecuteUpdateAsync(s => s.SetProperty(o => o.Status, OrganisationStatuses.Suspended)));
        var me = await (await admin.GetAsync("/api/me")).Json();
        Assert.Equal("organisation-suspended", me.GetProperty("blocked").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await admin.PostAsJsonAsync("/api/schemes", Scheme())).StatusCode);
    }
}
