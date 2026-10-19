using System.Net;
using System.Net.Http.Json;
using Humo.Domain.Access;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>New customer accounts (doc 21) and the sole-administrator safeguard (doc 16), on the API.</summary>
public sealed class AccountRequestTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private async Task<Guid> AccountManager(string email, params string[] grants) => await api.Person(email, Roles.AccountManager, null, null, grants);

    private static object Details(Guid manager, string shortName = "Coastline Estates") => new
    {
        name = $"{shortName} CC", shortName, city = "Durban", province = "KwaZulu-Natal", packageId = "professional", accountManagerId = manager.ToString(), notes = "Referred by Acacia",
    };

    private async Task<(Guid id, string outcome)> Submit(HttpClient client, object details)
    {
        var res = await client.PostAsJsonAsync("/api/platform/account-requests", details);
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        var body = await res.Json();
        return (Guid.Parse(body.GetProperty("requestId").GetString()!), body.GetProperty("outcome").GetString()!);
    }

    [Fact]
    public async Task An_Account_Manager_submits_and_another_System_Administrator_approves()
    {
        var dumisani = await AccountManager("dumisani@humo.co.za");
        var am = await api.SignedIn("dumisani@humo.co.za");
        var (id, outcome) = await Submit(am, Details(dumisani));
        Assert.Equal("pending", outcome);
        Assert.Equal(0, await api.Db(db => db.Organisations.CountAsync()));

        // System Administrators are told; the submitter isn't told about their own submission.
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        var bell = await (await admin.GetAsync("/api/notifications")).Json();
        Assert.Contains("waiting for approval", bell[0].GetProperty("title").GetString());
        Assert.Empty((await (await am.GetAsync("/api/notifications")).Json()).EnumerateArray());

        Assert.Equal("forbidden", await (await am.PostAsJsonAsync($"/api/platform/account-requests/{id}/decision", new { type = "approve" })).ProblemCode());
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/platform/account-requests/{id}/decision", new { type = "approve", expectedVersion = 1 })).StatusCode);

        var view = await (await admin.GetAsync($"/api/platform/account-requests/{id}")).Json();
        Assert.Equal("approved", view.GetProperty("request").GetProperty("status").GetString());
        Assert.Equal("onboarding", view.GetProperty("organisationStatus").GetString());
        var org = await api.Db(db => db.Organisations.SingleAsync());
        Assert.Equal(dumisani, org.AccountManagerId);
        // Activation creates no users or invitations.
        Assert.Equal(0, await api.Db(db => db.Memberships.CountAsync(m => m.OrganisationId == org.Id)));
        Assert.Contains("Approved", (await (await am.GetAsync("/api/notifications")).Json())[0].GetProperty("title").GetString());
    }

    [Fact]
    public async Task Rejecting_needs_a_reason_and_creates_nothing_and_nobody_decides_twice()
    {
        var m = await AccountManager("dumisani@humo.co.za");
        var (id, _) = await Submit(await api.SignedIn("dumisani@humo.co.za"), Details(m));
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        Assert.True((await (await admin.PostAsJsonAsync($"/api/platform/account-requests/{id}/decision", new { type = "reject", reason = "no" })).FieldErrors()).TryGetProperty("reason", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/platform/account-requests/{id}/decision", new { type = "reject", reason = "Duplicate of an existing customer" })).StatusCode);
        Assert.Equal(0, await api.Db(db => db.Organisations.CountAsync()));
        Assert.Equal("It’s already rejected.", (await (await admin.PostAsJsonAsync($"/api/platform/account-requests/{id}/decision", new { type = "approve" })).FieldErrors()).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Duplicates_and_inactive_account_managers_are_refused()
    {
        var m = await AccountManager("dumisani@humo.co.za");
        var am = await api.SignedIn("dumisani@humo.co.za");
        await Submit(am, Details(m));
        var again = await am.PostAsJsonAsync("/api/platform/account-requests", Details(m));
        Assert.Equal("A request for this customer is already waiting for approval.", (await again.FieldErrors()).GetProperty("shortName").GetString());
        await api.Organisation("Acacia");
        Assert.Equal("This customer already has an account.", (await (await am.PostAsJsonAsync("/api/platform/account-requests", Details(m, "Acacia"))).FieldErrors()).GetProperty("shortName").GetString());
        var support = await api.Person("lerato@humo.co.za", Roles.Support, null);
        Assert.True((await (await am.PostAsJsonAsync("/api/platform/account-requests", Details(support, "New Co"))).FieldErrors()).TryGetProperty("accountManagerId", out _));
    }

    [Fact]
    public async Task Delegated_activation_needs_the_grant_and_the_policy()
    {
        var m = await AccountManager("dumisani@humo.co.za", "Platform.Customers.ActivateWithoutApproval");
        var am = await api.SignedIn("dumisani@humo.co.za");
        var (id, outcome) = await Submit(am, Details(m));
        Assert.Equal("activated", outcome);
        var view = await (await am.GetAsync($"/api/platform/account-requests/{id}")).Json();
        Assert.Equal("delegated", view.GetProperty("request").GetProperty("route").GetString());
        Assert.Contains(await api.Db(db => db.Audit.Select(a => a.Action).ToListAsync()), a => a.Contains("under delegated authority — Platform.Customers.ActivateWithoutApproval"));

        // A System Administrator pauses delegation: the next account waits, the grant stays.
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsJsonAsync("/api/platform/account-policy", new { policy = "approval-for-all", reason = "Quarter-end review", expectedVersion = 1 })).StatusCode);
        Assert.Equal("pending", (await Submit(am, Details(m, "Second Agency"))).outcome);
    }

    [Fact]
    public async Task Support_can_t_open_accounts()
    {
        await api.Person("lerato@humo.co.za", Roles.Support, null);
        var support = await api.SignedIn("lerato@humo.co.za");
        var m = await AccountManager("dumisani@humo.co.za");
        Assert.Equal("forbidden", await (await support.PostAsJsonAsync("/api/platform/account-requests", Details(m))).ProblemCode());
    }

    [Fact]
    public async Task The_sole_System_Administrator_decides_their_own_request_but_not_once_there_are_two()
    {
        var m = await AccountManager("dumisani@humo.co.za");
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        var (own, _) = await Submit(admin, Details(m));
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/platform/account-requests/{own}/decision", new { type = "approve" })).StatusCode);
        Assert.Contains(await api.Db(db => db.Audit.Select(a => a.Action).ToListAsync()), a => a.Contains("own request, decided by the sole System Administrator"));

        await api.Person("nomsa@humo.co.za", Roles.SystemAdmin, null);
        var (second, _) = await Submit(admin, Details(m, "Other Agency"));
        var refused = await admin.PostAsJsonAsync($"/api/platform/account-requests/{second}/decision", new { type = "approve" });
        Assert.Equal("Another System Administrator decides on a request you submitted.", (await refused.FieldErrors()).GetProperty("status").GetString());
    }
}
