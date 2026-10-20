using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Humo.Api.Tests;

/// <summary>
/// Humo staff removing someone's passkeys, invitations that wait for approval, and the sole System Administrator
/// allowing impersonation for themselves after a cooling-off period.
/// </summary>
public sealed class AdminSafeguardTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private static Task<HttpResponseMessage> Act(HttpClient c, Guid id, object action) => c.PostAsJsonAsync($"/api/platform/team/{id}/actions", action);

    private Task<Guid> UserId(string email) => api.Db(db => db.Users.Where(u => u.Email == email).Select(u => u.Id).SingleAsync());

    /// <summary>Two passkeys on someone's sign-in, as the WebAuthn ceremony would have stored them.</summary>
    private async Task Passkeys(Guid userId)
    {
        using var scope = api.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<HumoUser>>();
        var user = (await users.FindByIdAsync(userId.ToString()))!;
        foreach (var name in new[] { "Work laptop", "Phone" })
        {
            var info = new UserPasskeyInfo(Guid.NewGuid().ToByteArray(), [1, 2, 3], api.Clock.GetUtcNow(), 0, null, true, name == "Phone", false, [1], [1]) { Name = name };
            Assert.True((await users.AddOrUpdatePasskeyAsync(user, info)).Succeeded);
        }
    }

    [Fact]
    public async Task Support_removes_a_customers_passkeys_with_a_reason_and_a_fresh_passkey_and_it_is_logged()
    {
        var org = await api.Customer("Acacia");
        var thandeka = await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        await Passkeys(thandeka);
        await api.Person("lerato@humo.co.za", Roles.Support, null);
        var support = await api.SignedIn("lerato@humo.co.za");

        var list = await (await support.GetAsync($"/api/platform/users/{thandeka}/passkeys")).Json();
        Assert.Equal(2, list.GetArrayLength());
        var phone = list.EnumerateArray().Single(p => p.GetProperty("name").GetString() == "Phone").GetProperty("id").GetString();

        Assert.Equal("step-up-required", await (await support.PostAsJsonAsync($"/api/platform/users/{thandeka}/passkeys/remove", new { passkeyId = phone, reason = "Lost phone, confirmed by call" })).ProblemCode());
        await support.StepUp();
        Assert.True((await (await support.PostAsJsonAsync($"/api/platform/users/{thandeka}/passkeys/remove", new { passkeyId = phone, reason = "Lost" })).FieldErrors()).TryGetProperty("reason", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await support.PostAsJsonAsync($"/api/platform/users/{thandeka}/passkeys/remove", new { passkeyId = phone, reason = "Lost phone, confirmed by a call to their office" })).StatusCode);

        Assert.Equal(["Work laptop"], (await (await support.GetAsync($"/api/platform/users/{thandeka}/passkeys")).Json()).EnumerateArray().Select(p => p.GetProperty("name").GetString()));
        var audit = await api.Db(db => db.Audit.Where(a => a.Action.Contains("Removed the passkey")).SingleAsync());
        Assert.Equal(("security", "success"), (audit.Category, audit.Result));
        Assert.Contains("Lost phone", audit.Action);
        await HumoApiFactory.Until(() => api.Email.Sent.Any(m => m.To == "thandeka@acacia.example"));
        Assert.Contains("signed you out on every device", api.Email.Sent.Single(m => m.To == "thandeka@acacia.example").Text);

        // Not a System Administrator's, and not your own.
        var admin = await UserId(HumoApiFactory.AdminEmail);
        await Passkeys(admin);
        Assert.Contains("System Administrator", (await (await support.PostAsJsonAsync($"/api/platform/users/{admin}/passkeys/remove", new { reason = "Testing the safeguard" })).FieldErrors()).GetProperty("userId").GetString());
        var self = await UserId("lerato@humo.co.za");
        Assert.True((await (await support.PostAsJsonAsync($"/api/platform/users/{self}/passkeys/remove", new { reason = "Testing the safeguard" })).FieldErrors()).TryGetProperty("userId", out _));

        // Agency staff can't.
        var agency = await api.SignedIn("thandeka@acacia.example");
        Assert.Equal(HttpStatusCode.NotFound, (await agency.GetAsync($"/api/platform/users/{admin}/passkeys")).StatusCode);
    }

    [Fact]
    public async Task A_new_System_Administrator_is_emailed_only_once_their_role_is_approved()
    {
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();
        api.Email.Sent.Clear();
        var res = await admin.PostAsJsonAsync("/api/platform/team", new { name = "Nomsa Khoza", email = "nomsa@humo.co.za", role = Roles.SystemAdmin, label = "Platform operations", reason = "Second administrator" });
        var nomsa = Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
        Assert.DoesNotContain(api.Email.Sent, m => m.To == "nomsa@humo.co.za");

        api.Clock.Advance(TimeSpan.FromHours(25));
        admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();
        var grant = (await (await admin.GetAsync("/api/platform/team/pending-grants")).Json())[0].GetProperty("id").GetString();
        Assert.Equal(HttpStatusCode.NoContent, (await Act(admin, nomsa, new { type = "approve-grant", grantId = grant })).StatusCode);
        Assert.Contains("invited you", Assert.Single(api.Email.Sent, m => m.To == "nomsa@humo.co.za").Text);
    }

    [Fact]
    public async Task A_declined_System_Administrator_never_hears_from_Humo_and_their_sign_in_is_closed()
    {
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();
        var res = await admin.PostAsJsonAsync("/api/platform/team", new { name = "Sipho Ndlovu", email = "sipho@humo.co.za", role = Roles.SystemAdmin, label = "Platform operations", reason = "Asked by mistake" });
        var sipho = Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
        var grant = (await (await admin.GetAsync("/api/platform/team/pending-grants")).Json())[0].GetProperty("id").GetString();
        Assert.Equal(HttpStatusCode.NoContent, (await Act(admin, sipho, new { type = "decline-grant", grantId = grant, reason = "Requested by mistake" })).StatusCode);
        Assert.DoesNotContain(api.Email.Sent, m => m.To == "sipho@humo.co.za");
        Assert.Equal(IdentityStatuses.Deactivated, await api.Db(db => db.Users.Where(u => u.Id == sipho).Select(u => u.Status).SingleAsync()));
    }

    [Fact]
    public async Task The_sole_System_Administrator_allows_their_own_impersonation_after_a_cooling_off_period()
    {
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        var me = await UserId(HumoApiFactory.AdminEmail);
        await api.Person("lerato@humo.co.za", Roles.Support, null);
        await admin.StepUp();

        Assert.Equal(HttpStatusCode.NoContent, (await Act(admin, me, new { type = "set-impersonation", allowed = true, reason = "Only administrator: supporting customers" })).StatusCode);
        var pending = (await (await admin.GetAsync("/api/platform/team/pending-grants")).Json())[0];
        Assert.Equal("System.Impersonate", pending.GetProperty("role").GetString());
        Assert.False(await CanImpersonate(admin, me));
        // The rest of the team is told straight away.
        var lerato = await api.SignedIn("lerato@humo.co.za");
        Assert.Contains("asked to be allowed to impersonate", (await (await lerato.GetAsync("/api/notifications")).Json())[0].GetProperty("title").GetString());
        Assert.True((await (await Act(admin, me, new { type = "set-impersonation", allowed = true, reason = "Asking twice" })).FieldErrors()).TryGetProperty("allowed", out _));

        var grant = pending.GetProperty("id").GetString();
        Assert.Contains("cooling-off period", (await (await Act(admin, me, new { type = "approve-grant", grantId = grant })).FieldErrors()).GetProperty("grantId").GetString());

        api.Clock.Advance(TimeSpan.FromHours(25));
        admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();
        Assert.Equal(HttpStatusCode.NoContent, (await Act(admin, me, new { type = "approve-grant", grantId = grant })).StatusCode);
        Assert.True(await CanImpersonate(admin, me));
        Assert.Contains(await api.Db(db => db.Audit.Select(a => a.Action).ToListAsync()), a => a.StartsWith("Confirmed impersonation for"));

        // Giving it up is immediate.
        Assert.Equal(HttpStatusCode.NoContent, (await Act(admin, me, new { type = "set-impersonation", allowed = false, reason = "No longer needed" })).StatusCode);
        Assert.False(await CanImpersonate(admin, me));
    }

    [Fact]
    public async Task With_two_System_Administrators_impersonation_for_yourself_comes_from_the_other_one()
    {
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        var me = await UserId(HumoApiFactory.AdminEmail);
        await api.Person("nomsa@humo.co.za", Roles.SystemAdmin, null);
        await admin.StepUp();
        Assert.Contains("own access", (await (await Act(admin, me, new { type = "set-impersonation", allowed = true, reason = "Want to impersonate" })).FieldErrors()).GetProperty("id").GetString());
    }

    private static async Task<bool> CanImpersonate(HttpClient c, Guid id) =>
        (await (await c.GetAsync($"/api/platform/team/{id}")).Json()).GetProperty("canImpersonate").GetBoolean();
}
