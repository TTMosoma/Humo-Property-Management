using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;

namespace Humo.Api.Tests;

/// <summary>
/// The package limits (docs/18 D16): units and people with a sign-in are limited by package; schemes are not. At 80% a
/// customer is warned, and at the limit adding more is refused with what the next package includes.
/// </summary>
public sealed class PackageLimitTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(HttpClient Admin, Guid Org, Guid Kc);

    /// <summary>An Essentials customer (50 units, 5 people) with one scheme and an agency administrator.</summary>
    private async Task<Setup> Essentials()
    {
        // The approved terms of 22 October 2026 (D16) take effect from that day; the test clock starts on 19 October.
        api.Clock.Advance(TimeSpan.FromDays(4));
        var org = await api.Customer("Acacia", "essentials");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var res = await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" });
        var kc = Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
        return new Setup(admin, org, kc);
    }

    private static object UnitBody(int number) => new { number = number.ToString(), description = "2-bed", sizeM2 = 86, participationQuota = 1.25, monthlyLevy = 1800, occupancy = "owner-occupied" };

    private async Task<HttpResponseMessage> AddUnit(Setup s, int number) => await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", UnitBody(number));

    private static async Task<JsonElement> Limits(HttpClient client)
    {
        var res = await client.GetAsync("/api/me/limits");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return await res.Json();
    }

    [Fact]
    public async Task An_essentials_customer_is_warned_at_80_percent_and_refused_at_the_unit_limit()
    {
        var s = await Essentials();
        for (var n = 1; n <= 40; n++) Assert.Equal(HttpStatusCode.Created, (await AddUnit(s, n)).StatusCode);
        var warned = (await Limits(s.Admin)).GetProperty("units");
        Assert.Equal(("warning", 40, 50), (warned.GetProperty("state").GetString(), warned.GetProperty("used").GetInt32(), warned.GetProperty("included").GetInt32()));

        for (var n = 41; n <= 50; n++) Assert.Equal(HttpStatusCode.Created, (await AddUnit(s, n)).StatusCode);
        var refused = await AddUnit(s, 51);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);
        var message = (await refused.FieldErrors()).GetProperty("units").GetString()!;
        Assert.Contains("Humo Essentials", message);
        Assert.Contains("50 units", message);
        Assert.Equal("reached", (await Limits(s.Admin)).GetProperty("units").GetProperty("state").GetString());
    }

    [Fact]
    public async Task Schemes_are_unlimited_on_every_package()
    {
        var s = await Essentials();
        for (var n = 2; n <= 8; n++)
        {
            var res = await s.Admin.PostAsJsonAsync("/api/schemes", new { name = $"Scheme {n}", code = $"Z{(char)('A' + n)}", type = "Sectional Title", suburb = "Sandton", city = "Sandton", province = "Gauteng" });
            Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        }
        Assert.Equal(HttpStatusCode.Created, (await AddUnit(s, 1)).StatusCode);
    }

    [Fact]
    public async Task People_with_a_sign_in_are_limited_but_re_inviting_one_of_them_is_allowed()
    {
        var s = await Essentials();
        var members = new List<string>();
        for (var n = 1; n <= 4; n++)
        {
            var email = $"staff{n}@acacia.example";
            members.Add(email);
            await api.Person(email, Roles.Finance, s.Org);
        }
        // The administrator and four staff: five people, the Essentials limit.
        Assert.Equal(5, (await Limits(s.Admin)).GetProperty("users").GetProperty("used").GetInt32());

        await s.Admin.StepUp(); // inviting someone needs a fresh passkey check (Users.Manage)
        var newcomer = await s.Admin.PostAsJsonAsync("/api/access/invitations", Invitation(s.Org, "lerato@acacia.example"));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, newcomer.StatusCode);
        Assert.Contains("5 users", (await newcomer.FieldErrors()).GetProperty("email").GetString());

        // Someone already in the agency isn't a new seat: the only objection is that they already have this access.
        var again = await s.Admin.PostAsJsonAsync("/api/access/invitations", Invitation(s.Org, members[0]));
        Assert.Contains("already has access", (await again.FieldErrors()).GetProperty("email").GetString());
    }

    [Fact]
    public async Task The_usage_names_the_package_and_its_included_amounts()
    {
        var s = await Essentials();
        var usage = await Limits(s.Admin);
        Assert.Equal("Humo Essentials", usage.GetProperty("package").GetString());
        Assert.Equal(50, usage.GetProperty("units").GetProperty("included").GetInt32());
        Assert.Equal(5, usage.GetProperty("users").GetProperty("included").GetInt32());
    }

    private static object Invitation(Guid org, string email) => new
    {
        organisationId = org.ToString(), name = "Lerato Mokoena", email,
        assignment = new { role = Roles.Finance, scope = new { type = "organisation", organisationId = org.ToString(), schemeIds = Array.Empty<string>() }, label = "Acacia" },
    };
}
