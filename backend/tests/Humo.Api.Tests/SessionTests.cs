using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Humo.Api.Auth;
using Humo.Domain.Access;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>
/// Sessions (docs/17, the session policy): the code that binds an email link to the screen that asked for it,
/// idle and absolute limits, revocation, and sign-out of other sessions. Passkey sign-ins need a real authenticator,
/// so the passkey policy is covered by <see cref="SessionPolicyTests"/> and by the manual scenarios.
/// </summary>
public sealed partial class SessionTests : IDisposable
{
    private readonly HumoApiFactory api = new();
    private readonly HttpClient client;

    public SessionTests() => client = api.Client();

    public void Dispose() => api.Dispose();

    // ---- The code that binds a link to the requesting screen ----

    [Fact]
    public async Task A_link_needs_the_code_from_the_screen_that_asked()
    {
        var link = await RequestLink(HumoApiFactory.AdminEmail);
        var res = await Complete(link.Token, Wrong(link.Code));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var problem = await res.Json();
        Assert.Equal("wrong-code", problem.GetProperty("code").GetString());
        Assert.Contains("4 tries left", problem.GetProperty("title").GetString());

        // A wrong code doesn't spend the link: the right code still signs in.
        Assert.Equal(HttpStatusCode.OK, (await Complete(link)).StatusCode);
    }

    [Fact]
    public async Task A_forwarded_link_is_no_use_without_the_code_on_the_requesting_screen()
    {
        // Two requests for the same person: the second screen's code doesn't open the first screen's link.
        var first = await RequestLink(HumoApiFactory.AdminEmail);
        var second = await RequestLink(HumoApiFactory.AdminEmail);
        await AssertFailure(await Complete(first.Token, second.Code), "wrong-code");

        Assert.Equal(HttpStatusCode.OK, (await Complete(first)).StatusCode);
    }

    [Fact]
    public async Task Five_wrong_codes_spend_the_link_even_with_the_right_code_after()
    {
        var link = await RequestLink(HumoApiFactory.AdminEmail);
        for (var i = 0; i < 4; i++) await AssertFailure(await Complete(link.Token, Wrong(link.Code)), "wrong-code");
        await AssertFailure(await Complete(link.Token, Wrong(link.Code)), "link-expired");
        await AssertFailure(await Complete(link), "link-expired");
    }

    [Fact]
    public async Task The_code_is_never_in_the_email()
    {
        var link = await RequestLink(HumoApiFactory.AdminEmail);
        // RequestLink reads the email and clears it; check the body another way: a fresh request's mail has no code.
        var res = await client.PostAsJsonAsync("/api/auth/link", new { email = HumoApiFactory.AdminEmail });
        var message = Assert.Single(api.Email.Sent);
        Assert.DoesNotContain(link.Code, message.Text);
        Assert.Contains("enter the six-digit code", message.Text);
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
    }

    // ---- Idle and absolute limits (a link session: 15 minutes idle, 4 hours in all) ----

    [Fact]
    public async Task A_link_session_ends_after_15_minutes_of_inactivity()
    {
        await api.SignedIn(HumoApiFactory.AdminEmail);
        api.Clock.Advance(TimeSpan.FromMinutes(16));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task Activity_keeps_a_session_alive()
    {
        var signedIn = await api.SignedIn(HumoApiFactory.AdminEmail);
        api.Clock.Advance(TimeSpan.FromMinutes(10));
        Assert.Equal(HttpStatusCode.OK, (await signedIn.GetAsync("/api/me")).StatusCode);
        api.Clock.Advance(TimeSpan.FromMinutes(10));
        Assert.Equal(HttpStatusCode.OK, (await signedIn.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task A_session_ends_at_its_absolute_limit_however_active_it_is()
    {
        var signedIn = await api.SignedIn(HumoApiFactory.AdminEmail);
        for (var i = 0; i < 23; i++) // 230 minutes: each request is within the idle limit
        {
            api.Clock.Advance(TimeSpan.FromMinutes(10));
            Assert.Equal(HttpStatusCode.OK, (await signedIn.GetAsync("/api/me")).StatusCode);
        }
        api.Clock.Advance(TimeSpan.FromMinutes(10)); // 4 hours
        Assert.Equal(HttpStatusCode.Unauthorized, (await signedIn.GetAsync("/api/me")).StatusCode);
    }

    // ---- Revocation ----

    [Fact]
    public async Task Signing_out_revokes_the_session_on_the_server()
    {
        var signedIn = await api.SignedIn(HumoApiFactory.AdminEmail);
        Assert.Equal(HttpStatusCode.NoContent, (await signedIn.PostAsync("/api/auth/sign-out", null)).StatusCode);
        Assert.NotNull(await api.Db(db => db.UserSessions.Select(s => s.RevokedAt).SingleAsync()));
    }

    [Fact]
    public async Task A_revoked_session_is_refused_even_though_its_cookie_is_still_held()
    {
        var signedIn = await api.SignedIn(HumoApiFactory.AdminEmail);
        await api.Db(db => db.UserSessions.ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, DateTimeOffset.UtcNow)));
        Assert.Equal(HttpStatusCode.Unauthorized, (await signedIn.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task A_suspended_person_loses_a_signed_in_session_at_once()
    {
        var signedIn = await api.SignedIn(HumoApiFactory.AdminEmail);
        await api.Db(db => db.Users.ExecuteUpdateAsync(s => s.SetProperty(u => u.Status, IdentityStatuses.Suspended)));
        Assert.Equal(HttpStatusCode.Unauthorized, (await signedIn.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task Signing_out_other_sessions_leaves_this_one_and_ends_the_others()
    {
        var here = await api.SignedIn(HumoApiFactory.AdminEmail);
        var elsewhere = await api.SignedIn(HumoApiFactory.AdminEmail);
        await here.StepUp();

        Assert.Equal(HttpStatusCode.NoContent, (await here.PostAsync("/api/me/security/sign-out-others", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await here.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await elsewhere.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task A_step_up_keeps_the_same_session()
    {
        var signedIn = await api.SignedIn(HumoApiFactory.AdminEmail);
        var before = await api.Db(db => db.UserSessions.Select(s => s.Id).SingleAsync());
        await signedIn.StepUp();
        Assert.Equal(HttpStatusCode.OK, (await signedIn.GetAsync("/api/me")).StatusCode);
        Assert.Equal(before, await api.Db(db => db.UserSessions.Select(s => s.Id).SingleAsync()));
        Assert.Null(await api.Db(db => db.UserSessions.Select(s => s.RevokedAt).SingleAsync()));
    }

    // ---- "Is this your own computer?": asked once per browser ----

    [Fact]
    public async Task A_browser_is_asked_once_and_remembers_its_answer()
    {
        var first = await Complete(await RequestLink(HumoApiFactory.AdminEmail));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.True((await first.Json()).GetProperty("askBrowserTrust").GetBoolean());

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/me/security/browser", new { trusted = true })).StatusCode);

        var again = await Complete(await RequestLink(HumoApiFactory.AdminEmail));
        Assert.False((await again.Json()).GetProperty("askBrowserTrust").GetBoolean());
    }

    [Fact]
    public async Task A_shared_answer_is_remembered_listed_as_shared_and_can_be_removed()
    {
        await Complete(await RequestLink(HumoApiFactory.AdminEmail));
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/me/security/browser", new { trusted = false })).StatusCode);

        var again = await Complete(await RequestLink(HumoApiFactory.AdminEmail));
        Assert.False((await again.Json()).GetProperty("askBrowserTrust").GetBoolean());
        var device = Assert.Single((await (await client.GetAsync("/api/me/security")).Json()).GetProperty("devices").EnumerateArray().ToList());
        Assert.False(device.GetProperty("trusted").GetBoolean());

        await client.StepUp();
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/me/security/devices/{device.GetProperty("id").GetString()}/remove", null)).StatusCode);
        var asked = await Complete(await RequestLink(HumoApiFactory.AdminEmail));
        Assert.True((await asked.Json()).GetProperty("askBrowserTrust").GetBoolean());
    }

    [Fact]
    public async Task A_trusted_browser_is_listed_and_removing_it_brings_the_question_back()
    {
        // A trusted browser's cookie persists until its expiry, which the test client checks against the real clock.
        api.Clock.Set(DateTimeOffset.UtcNow);
        await Complete(await RequestLink(HumoApiFactory.AdminEmail));
        await client.PostAsJsonAsync("/api/me/security/browser", new { trusted = true });

        var devices = (await (await client.GetAsync("/api/me/security")).Json()).GetProperty("devices").EnumerateArray().ToList();
        var device = Assert.Single(devices);
        Assert.Equal("laptop", device.GetProperty("kind").GetString());
        Assert.True(device.GetProperty("trusted").GetBoolean());

        await client.StepUp(); // Security.ManageOwn asks for step-up, as removing a passkey does
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync($"/api/me/security/devices/{device.GetProperty("id").GetString()}/remove", null)).StatusCode);
        // This browser stays signed in, and no longer counts as trusted.
        var after = await (await client.GetAsync("/api/me/security")).Json();
        Assert.Empty(after.GetProperty("devices").EnumerateArray());

        var again = await Complete(await RequestLink(HumoApiFactory.AdminEmail));
        Assert.True((await again.Json()).GetProperty("askBrowserTrust").GetBoolean());
    }

    [Fact]
    public async Task Answering_needs_a_signed_in_session()
    {
        var stranger = api.Client();
        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.PostAsJsonAsync("/api/me/security/browser", new { trusted = true })).StatusCode);
    }

    // ---- Helpers ----

    /// <summary>A different six-digit code, so a wrong attempt is never accidentally right.</summary>
    private static string Wrong(string code) => ((int.Parse(code) + 1) % 1_000_000).ToString("D6");

    /// <summary>The link from the email, and the code the requesting screen was shown.</summary>
    private sealed record Link(string Token, string Code);

    private async Task<Link> RequestLink(string email)
    {
        var res = await client.PostAsJsonAsync("/api/auth/link", new { email });
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        var code = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;
        var message = Assert.Single(api.Email.Sent);
        api.Email.Sent.Clear();
        return new Link(LinkToken().Match(message.Text).Groups[1].Value, code);
    }

    private Task<HttpResponseMessage> Complete(Link link) => Complete(link.Token, link.Code);

    private Task<HttpResponseMessage> Complete(string token, string code) => client.PostAsJsonAsync("/api/auth/link/complete", new { token, code });

    private static async Task AssertFailure(HttpResponseMessage res, string code)
    {
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal(code, (await res.Json()).GetProperty("code").GetString());
    }

    [GeneratedRegex(@"sign-in/link\?token=([A-Za-z0-9_\-]+)")]
    private static partial Regex LinkToken();
}

/// <summary>The session policy table (docs/17): what each kind of sign-in gets, without a server.</summary>
public sealed class SessionPolicyTests
{
    [Theory]
    [InlineData("passkey", true, "owner", 30, 12)]
    [InlineData("passkey", true, "portfolio-manager", 30, 12)]
    [InlineData("passkey", false, "owner", 15, 8)]
    [InlineData("link", false, "owner", 15, 4)]
    [InlineData("passkey", true, "system-admin", 15, 12)]
    [InlineData("passkey", false, "agency-admin", 15, 8)]
    [InlineData("link", false, "system-admin", 15, 4)]
    public void Each_sign_in_gets_its_limits(string method, bool trusted, string role, int idleMinutes, int absoluteHours)
    {
        var (idle, absolute) = SessionPolicy.For(method, trusted, role);
        Assert.Equal((idleMinutes, TimeSpan.FromHours(absoluteHours)), (idle, absolute));
    }
}
