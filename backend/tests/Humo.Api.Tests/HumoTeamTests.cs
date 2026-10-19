using System.Net;
using System.Net.Http.Json;
using Humo.Domain.Access;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Humo's own team and the sole-administrator safeguard (doc 16).</summary>
public sealed class HumoTeamTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private Task<Guid> AdminId() => api.Db(db => db.Users.Where(u => u.Email == HumoApiFactory.AdminEmail).Select(u => u.Id).SingleAsync());

    private static Task<HttpResponseMessage> Act(HttpClient c, Guid id, object action) => c.PostAsJsonAsync($"/api/platform/team/{id}/actions", action);

    [Fact]
    public async Task Inviting_staff_needs_a_Humo_address_and_step_up()
    {
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();
        var outside = await admin.PostAsJsonAsync("/api/platform/team", new { name = "Lerato Dube", email = "lerato@gmail.com", role = Roles.Support, label = "Customer support", reason = "New support hire" });
        Assert.Contains("@humo.co.za", (await outside.FieldErrors()).GetProperty("email").GetString());

        var res = await admin.PostAsJsonAsync("/api/platform/team", new { name = "Lerato Dube", email = "lerato@humo.co.za", role = Roles.Support, label = "Customer support", reason = "New support hire" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        Assert.Contains("invited you", Assert.Single(api.Email.Sent).Text);
        var team = await (await admin.GetAsync("/api/platform/team")).Json();
        Assert.Contains(team.EnumerateArray(), m => m.GetProperty("identity").GetProperty("email").GetString() == "lerato@humo.co.za" && m.GetProperty("roles")[0].GetProperty("role").GetString() == Roles.Support);
    }

    [Fact]
    public async Task The_sole_System_Administrator_confirms_a_second_one_only_after_24_hours_and_the_team_is_told()
    {
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        var support = await api.Person("lerato@humo.co.za", Roles.Support, null);
        await admin.StepUp();
        var res = await admin.PostAsJsonAsync("/api/platform/team", new { name = "Nomsa Khoza", email = "nomsa@humo.co.za", role = Roles.SystemAdmin, label = "Platform operations", reason = "Second administrator" });
        var nomsa = Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
        var grant = (await (await admin.GetAsync("/api/platform/team/pending-grants")).Json())[0].GetProperty("id").GetString();

        // Everyone else on the team hears about it at once.
        var lerato = await api.SignedIn("lerato@humo.co.za");
        Assert.Contains("asked to make Nomsa Khoza a System Administrator", (await (await lerato.GetAsync("/api/notifications")).Json())[0].GetProperty("title").GetString());

        var tooSoon = await Act(admin, nomsa, new { type = "approve-grant", grantId = grant });
        Assert.Contains("cooling-off period", (await tooSoon.FieldErrors()).GetProperty("grantId").GetString());

        // A day later (sessions last 12 hours, so they sign in again).
        api.Clock.Advance(TimeSpan.FromHours(25));
        admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();
        Assert.Equal(HttpStatusCode.NoContent, (await Act(admin, nomsa, new { type = "approve-grant", grantId = grant })).StatusCode);
        Assert.Contains(await api.Db(db => db.Audit.Select(a => a.Action).ToListAsync()), a => a.Contains("confirmed by the sole System Administrator after the 24-hour cooling-off period"));
        Assert.Equal(2, (await api.Db(db => db.RoleAssignments.Where(a => a.Role == Roles.SystemAdmin && a.Status == AssignmentStatuses.Active).CountAsync())));
        _ = support;
    }

    [Fact]
    public async Task With_two_administrators_the_requester_can_t_approve_and_nobody_changes_their_own_access()
    {
        await api.Person("nomsa@humo.co.za", Roles.SystemAdmin, null);
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();
        var res = await admin.PostAsJsonAsync("/api/platform/team", new { name = "Third Admin", email = "third@humo.co.za", role = Roles.SystemAdmin, label = "Security", reason = "Grow the team" });
        var third = Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
        var grant = (await (await admin.GetAsync("/api/platform/team/pending-grants")).Json())[0].GetProperty("id").GetString();
        Assert.Contains("second System Administrator approves", (await (await Act(admin, third, new { type = "approve-grant", grantId = grant })).FieldErrors()).GetProperty("grantId").GetString());

        var nomsa = await api.SignedIn("nomsa@humo.co.za");
        await nomsa.StepUp();
        Assert.Equal(HttpStatusCode.NoContent, (await Act(nomsa, third, new { type = "approve-grant", grantId = grant })).StatusCode);

        var self = await Act(admin, await AdminId(), new { type = "set-impersonation", allowed = true, reason = "Want to impersonate" });
        Assert.Contains("your own access", (await self.FieldErrors()).GetProperty("id").GetString());
    }

    [Fact]
    public async Task Offboarding_ends_every_role_and_one_System_Administrator_always_remains()
    {
        // The last-administrator rule is defensive: only an administrator can act, and nobody acts on themselves.
        var nomsaId = await api.Person("nomsa@humo.co.za", Roles.SystemAdmin, null);
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();
        // Remove Nomsa: allowed (two admins). Then nobody may remove the remaining one.
        Assert.Equal(HttpStatusCode.NoContent, (await Act(admin, nomsaId, new { type = "offboard", reason = "Left Humo" })).StatusCode);
        Assert.Equal("deactivated", await api.Db(db => db.Users.Where(u => u.Id == nomsaId).Select(u => u.Status).SingleAsync()));
        Assert.Equal(1, (await api.Db(db => db.RoleAssignments.Where(a => a.Role == Roles.SystemAdmin && a.Status == AssignmentStatuses.Active).CountAsync())));
    }

    [Fact]
    public async Task Account_managers_hand_over_customers_before_leaving_and_get_delegated_activation()
    {
        var thabo = await api.Person("thabo@humo.co.za", Roles.AccountManager, null);
        var dumisani = await api.Person("dumisani@humo.co.za", Roles.AccountManager, null);
        var org = await api.Organisation("Acacia");
        await api.Db(db => db.Organisations.Where(o => o.Id == org).ExecuteUpdateAsync(s => s.SetProperty(o => o.AccountManagerId, thabo)));
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();

        var noHandover = await Act(admin, thabo, new { type = "offboard", reason = "Left Humo" });
        Assert.Contains("Choose who looks after their 1 customers", (await noHandover.FieldErrors()).GetProperty("reassignTo").GetString());
        Assert.Equal(HttpStatusCode.NoContent, (await Act(admin, thabo, new { type = "offboard", reason = "Left Humo", reassignTo = dumisani.ToString() })).StatusCode);
        Assert.Equal(dumisani, await api.Db(db => db.Organisations.Where(o => o.Id == org).Select(o => o.AccountManagerId).SingleAsync()));

        Assert.Equal(HttpStatusCode.NoContent, (await Act(admin, dumisani, new { type = "set-delegated-activation", allowed = true, reason = "Trusted for onboarding" })).StatusCode);
        var member = await (await admin.GetAsync($"/api/platform/team/{dumisani}")).Json();
        Assert.True(member.GetProperty("canActivateWithoutApproval").GetBoolean());
        Assert.Equal("Acacia", member.GetProperty("customers")[0].GetProperty("name").GetString());
    }

    [Fact]
    public async Task Only_System_Administrators_change_the_team()
    {
        var thabo = await api.Person("thabo@humo.co.za", Roles.AccountManager, null);
        var am = await api.SignedIn("thabo@humo.co.za");
        await am.StepUp();
        var target = await api.Person("lerato@humo.co.za", Roles.Support, null);
        Assert.Equal("forbidden", await (await Act(am, target, new { type = "suspend", reason = "Not allowed" })).ProblemCode());
        _ = thabo;
    }
}
