using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Humo.Domain.Access;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Slice 1, step 1: sign-in by email link and the session (doc 24 S1–S3; docs/18 R-8).</summary>
public sealed partial class SignInTests : IDisposable
{
    private readonly HumoApiFactory api = new();
    private readonly HttpClient client;

    public SignInTests() => client = api.Client();

    public void Dispose() => api.Dispose();

    [Fact]
    public async Task Health_answers_ok()
    {
        var res = await client.GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task Without_a_session_me_is_401()
    {
        var res = await client.GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task The_first_System_Administrator_joins_with_an_email_link()
    {
        await SignInWithLink(HumoApiFactory.AdminEmail);

        var me = await Me();
        Assert.True(me.GetProperty("signedIn").GetBoolean());
        Assert.Equal("humo", me.GetProperty("identity").GetProperty("kind").GetString());
        Assert.Equal("active", me.GetProperty("identity").GetProperty("status").GetString());
        Assert.Equal("AA", me.GetProperty("identity").GetProperty("initials").GetString());
        var active = me.GetProperty("assignments").EnumerateArray().Single();
        Assert.Equal("system-admin", active.GetProperty("role").GetString());
        Assert.Equal("platform", active.GetProperty("scope").GetProperty("type").GetString());
        Assert.Equal(active.GetProperty("id").GetString(), me.GetProperty("activeAssignmentId").GetString());
        var permissions = me.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()).ToList();
        Assert.Contains("Platform.Customers.AnyAccount", permissions);
        Assert.DoesNotContain("System.Impersonate", permissions); // an individual grant, never a role default
        Assert.True(me.GetProperty("organisation").ValueKind == JsonValueKind.Null);

        var audit = await api.Db(db => db.Audit.Select(a => a.Action).ToListAsync());
        Assert.Contains("Accepted the invitation", audit);
        Assert.Contains("Signed in with an email link", audit);
    }

    [Fact]
    public async Task An_unknown_address_gets_the_same_answer_and_no_email()
    {
        var res = await client.PostAsJsonAsync("/api/auth/link", new { email = "nobody@example.com" });
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        Assert.Empty(api.Email.Sent);
    }

    [Fact]
    public async Task A_link_works_once()
    {
        var link = await RequestLink(HumoApiFactory.AdminEmail);
        Assert.Equal(HttpStatusCode.NoContent, (await Complete(link)).StatusCode);
        await AssertFailure(await Complete(link), "link-expired");
    }

    [Fact]
    public async Task A_link_expires_after_15_minutes()
    {
        var link = await RequestLink(HumoApiFactory.AdminEmail);
        api.Clock.Advance(TimeSpan.FromMinutes(16));
        await AssertFailure(await Complete(link), "link-expired");
    }

    [Fact]
    public async Task A_suspended_person_can_t_sign_in()
    {
        var link = await RequestLink(HumoApiFactory.AdminEmail);
        await api.Db(db => db.Users.ExecuteUpdateAsync(s => s.SetProperty(u => u.Status, IdentityStatuses.Suspended)));
        await AssertFailure(await Complete(link), "paused");
    }

    [Fact]
    public async Task A_suspended_person_gets_no_link()
    {
        await api.Db(db => db.Users.ExecuteUpdateAsync(s => s.SetProperty(u => u.Status, IdentityStatuses.Suspended)));
        var res = await client.PostAsJsonAsync("/api/auth/link", new { email = HumoApiFactory.AdminEmail });
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        Assert.Empty(api.Email.Sent);
    }

    [Fact]
    public async Task Passkey_options_are_offered_without_saying_whether_an_account_exists()
    {
        foreach (var email in new[] { HumoApiFactory.AdminEmail, "nobody@example.com" })
        {
            var res = await client.PostAsJsonAsync("/api/auth/passkey/options", new { email });
            Assert.Equal(HttpStatusCode.OK, res.StatusCode);
            var options = await res.Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal("localhost", options.GetProperty("rpId").GetString());
            Assert.False(string.IsNullOrEmpty(options.GetProperty("challenge").GetString()));
        }
    }

    [Fact]
    public async Task A_signed_in_person_gets_passkey_creation_options_for_pm_domain()
    {
        await SignInWithLink(HumoApiFactory.AdminEmail);
        var res = await client.PostAsync("/api/me/passkeys/options", null);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var options = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("localhost", options.GetProperty("rp").GetProperty("id").GetString());
        Assert.Equal(HumoApiFactory.AdminEmail, options.GetProperty("user").GetProperty("name").GetString());
        Assert.Equal("required", options.GetProperty("authenticatorSelection").GetProperty("residentKey").GetString());
    }

    [Fact]
    public async Task Nobody_switches_to_a_role_that_isn_t_theirs()
    {
        await SignInWithLink(HumoApiFactory.AdminEmail);
        var res = await client.PutAsJsonAsync("/api/me/assignment", new { assignmentId = Guid.NewGuid().ToString() });
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task Signing_out_ends_the_session()
    {
        await SignInWithLink(HumoApiFactory.AdminEmail);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/sign-out", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public void The_bootstrap_administrator_must_have_a_Humo_address()
    {
        using var bad = new HumoApiFactory().With("Bootstrap:AdminEmail", "someone@gmail.com");
        var e = Assert.ThrowsAny<Exception>(() => bad.Client());
        Assert.Contains("humo.co.za", e.ToString());
    }

    // ---- Helpers ----

    /// <summary>The link from the email, and the code the requesting screen was shown.</summary>
    private sealed record Link(string Token, string Code);

    private async Task<Link> RequestLink(string email)
    {
        var res = await client.PostAsJsonAsync("/api/auth/link", new { email });
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        var code = (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString()!;
        var message = Assert.Single(api.Email.Sent);
        api.Email.Sent.Clear();
        Assert.Equal(email, message.To);
        return new Link(LinkToken().Match(message.Text).Groups[1].Value, code);
    }

    private Task<HttpResponseMessage> Complete(Link link) => Complete(link.Token, link.Code);

    private Task<HttpResponseMessage> Complete(string token, string code) => client.PostAsJsonAsync("/api/auth/link/complete", new { token, code });

    private async Task SignInWithLink(string email) => Assert.Equal(HttpStatusCode.NoContent, (await Complete(await RequestLink(email))).StatusCode);

    private async Task<JsonElement> Me()
    {
        var res = await client.GetAsync("/api/me");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task AssertFailure(HttpResponseMessage res, string code)
    {
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var problem = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(code, problem.GetProperty("code").GetString());
    }

    [GeneratedRegex(@"/sign-in/link\?token=([A-Za-z0-9_\-]+)")]
    private static partial Regex LinkToken();
}
