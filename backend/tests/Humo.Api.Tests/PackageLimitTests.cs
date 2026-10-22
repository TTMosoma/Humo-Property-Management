using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Humo.Api.Commercial;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;

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

    private static async Task<string> TrialStatus(HttpClient client) =>
        (await Limits(client)).GetProperty("trial").GetProperty("status").GetString()!;

    private static async Task<bool> FeatureOn(HttpClient client, string feature)
    {
        var me = await (await client.GetAsync("/api/me")).Json();
        return me.GetProperty("entitlements").EnumerateArray().Single(e => e.GetProperty("feature").GetString() == feature).GetProperty("enabled").GetBoolean();
    }

    [Fact]
    public async Task The_professional_trial_is_offered_only_at_80_percent_and_the_agency_starts_it()
    {
        var s = await Essentials();
        for (var n = 1; n <= 10; n++) await AddUnit(s, n);
        Assert.Equal("not-applicable", await TrialStatus(s.Admin));
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Admin.PostAsync("/api/me/limits/professional-trial", null)).StatusCode);

        for (var n = 11; n <= 40; n++) await AddUnit(s, n);
        Assert.Equal("available", await TrialStatus(s.Admin));
        Assert.False(await FeatureOn(s.Admin, "billing"));

        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsync("/api/me/limits/professional-trial", null)).StatusCode);
        Assert.Equal("active", await TrialStatus(s.Admin));
        Assert.True(await FeatureOn(s.Admin, "billing"));

        // Once an agency has had the trial, it isn't offered again, even after it has ended.
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Admin.PostAsync("/api/me/limits/professional-trial", null)).StatusCode);
        api.Clock.Advance(TimeSpan.FromDays(31));
        var later = await api.SignedIn("thandeka@acacia.example"); // the earlier session has been idle too long
        Assert.Equal("used", await TrialStatus(later));
        Assert.False(await FeatureOn(later, "billing"));
    }

    private static List<string> Titled(HumoApiFactory api, string fragment) =>
        api.Email.Sent.Where(m => m.Subject.Contains(fragment)).Select(m => m.To).ToList();

    [Fact]
    public async Task The_administrator_is_emailed_once_at_80_percent_and_again_when_the_limit_is_reached()
    {
        var s = await Essentials();
        for (var n = 1; n <= 40; n++) await AddUnit(s, n);
        Assert.Equal(new[] { "thandeka@acacia.example" }, Titled(api, "at 80%"));

        await AddUnit(s, 41); // still at 80%: no second warning
        Assert.Single(Titled(api, "at 80%"));
        Assert.Empty(Titled(api, "limit reached"));

        for (var n = 42; n <= 50; n++) await AddUnit(s, n);
        Assert.Equal(new[] { "thandeka@acacia.example" }, Titled(api, "limit reached"));
    }

    [Fact]
    public async Task Other_staff_see_the_warning_in_the_app_and_are_not_emailed()
    {
        var s = await Essentials();
        await api.Person("sipho@acacia.example", Roles.PortfolioManager, s.Org);
        var manager = await api.SignedIn("sipho@acacia.example");
        for (var n = 1; n <= 40; n++) await AddUnit(s, n);

        Assert.DoesNotContain("sipho@acacia.example", Titled(api, "at 80%"));
        var notices = await (await manager.GetAsync("/api/notifications")).Json();
        Assert.Contains(notices.EnumerateArray(), n => n.GetProperty("title").GetString()!.Contains("at 80%"));
    }

    [Fact]
    public async Task Inviting_someone_into_the_last_seat_tells_the_administrator_the_limit_is_reached()
    {
        var s = await Essentials();
        // The administrator and three staff: four of five seats, 80%. The next invitation takes the last one.
        for (var n = 1; n <= 3; n++) await api.Person($"staff{n}@acacia.example", Roles.Finance, s.Org);
        Assert.Empty(Titled(api, "limit reached"));

        await s.Admin.StepUp();
        var invited = await s.Admin.PostAsJsonAsync("/api/access/invitations", Invitation(s.Org, "lerato@acacia.example"));
        Assert.NotEqual(HttpStatusCode.UnprocessableEntity, invited.StatusCode);
        Assert.Equal(new[] { "thandeka@acacia.example" }, Titled(api, "limit reached"));
    }

    private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n%%EOF\n");

    /// <summary>Stands in for files already stored: a row of this size counts towards the agency's storage.</summary>
    private async Task StoreBytes(Setup s, long bytes)
    {
        await api.Db(async db =>
        {
            db.UploadedFiles.Add(new UploadedFile
            {
                Id = Guid.CreateVersion7(), OrganisationId = s.Org, SchemeId = s.Kc, Name = "earlier.pdf", ContentType = "application/pdf",
                SizeBytes = bytes, Sha256 = "", StorageKey = "", ScanResult = "clean", UploadedBy = "Thandeka", UploadedAt = DateTimeOffset.UtcNow,
            });
            return await db.SaveChangesAsync();
        });
    }

    private static async Task<HttpResponseMessage> UploadFile(Setup s, byte[] content)
    {
        var form = new MultipartFormDataContent { { new StringContent(s.Kc.ToString()), "schemeId" } };
        var file = new ByteArrayContent(content);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        form.Add(file, "file", "notice.pdf");
        return await s.Admin.PostAsync("/api/files", form);
    }

    [Fact]
    public async Task A_file_that_would_take_the_agency_past_its_storage_limit_is_refused()
    {
        var s = await Essentials();
        var small = Pdf.Concat(new byte[1000]).ToArray();
        await StoreBytes(s, 5 * PackageLimits.BytesPerGb - small.Length);

        // Exactly the 5 GB limit is allowed; one byte more is refused.
        Assert.Equal(HttpStatusCode.OK, (await UploadFile(s, small)).StatusCode);
        var refused = await UploadFile(s, Pdf.Concat(new byte[1]).ToArray());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);
        Assert.Contains("5 GB of storage", (await refused.FieldErrors()).GetProperty("file").GetString());
        var storage = (await Limits(s.Admin)).GetProperty("storage");
        Assert.Equal(("reached", 5m), (storage.GetProperty("state").GetString(), storage.GetProperty("used").GetDecimal()));
    }

    [Fact]
    public async Task A_library_document_is_refused_past_the_storage_limit_too()
    {
        var s = await Essentials();
        await StoreBytes(s, 5 * PackageLimits.BytesPerGb);
        var form = new MultipartFormDataContent
        {
            { new StringContent(s.Kc.ToString()), "schemeId" },
            { new StringContent("Building insurance 2027"), "title" },
            { new StringContent("insurance"), "category" },
            { new StringContent("trustees"), "visibility" },
        };
        var file = new ByteArrayContent(Pdf);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        form.Add(file, "file", "insurance.pdf");
        var res = await s.Admin.PostAsync("/api/documents/library", form);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        Assert.Contains("5 GB of storage", (await res.FieldErrors()).GetProperty("file").GetString());
    }

    [Fact]
    public async Task The_administrator_is_warned_at_80_percent_of_storage_by_email_and_in_the_app()
    {
        var s = await Essentials();
        // Just under 4 GB (80% of 5 GB): no warning yet.
        await StoreBytes(s, 4 * PackageLimits.BytesPerGb - 2000);
        Assert.Empty(Titled(api, "Storage at 80%"));

        Assert.Equal(HttpStatusCode.OK, (await UploadFile(s, Pdf.Concat(new byte[3000]).ToArray())).StatusCode);
        Assert.Equal(new[] { "thandeka@acacia.example" }, Titled(api, "Storage at 80%"));
        var notices = await (await s.Admin.GetAsync("/api/notifications")).Json();
        Assert.Contains(notices.EnumerateArray(), n => n.GetProperty("title").GetString()!.Contains("Storage at 80%"));
    }

    private static object Invitation(Guid org, string email) => new
    {
        organisationId = org.ToString(), name = "Lerato Mokoena", email,
        assignment = new { role = Roles.Finance, scope = new { type = "organisation", organisationId = org.ToString(), schemeIds = Array.Empty<string>() }, label = "Acacia" },
    };
}
