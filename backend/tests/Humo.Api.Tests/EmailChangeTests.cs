using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>D34: one email per person. A sign-in moves only when the new address confirms it, the old one is told, and the audit log says what changed.</summary>
public sealed class EmailChangeTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Org, HttpClient Admin, Guid Person, Guid User, Guid Scheme);

    private async Task<Setup> AnOwnerWhoSignsIn()
    {
        var org = await api.Customer("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var scheme = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        var unit = await Id(await admin.PostAsJsonAsync($"/api/schemes/{scheme}/units", new { number = "14", description = "2-bed", sizeM2 = 86, participationQuota = 1, monthlyLevy = 1800, occupancy = "owner-occupied" }));
        var person = await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Nadia", lastName = "Abdul", kind = "individual", email = "nadia@absa.example", phone = "082 000 1111", preferredChannel = "email" },
            link = new { type = "owner", schemeId = scheme.ToString(), unitId = unit.ToString(), since = "2020-01-01" },
        }));
        var user = await api.Db(async db =>
        {
            var u = new HumoUser { Id = Guid.CreateVersion7(), UserName = "nadia@absa.example", NormalizedUserName = "NADIA@ABSA.EXAMPLE", Email = "nadia@absa.example", NormalizedEmail = "NADIA@ABSA.EXAMPLE", Name = "Nadia Abdul",
                Kind = IdentityKinds.Customer, Status = IdentityStatuses.Active, PersonId = person.ToString(), SecurityStamp = Guid.NewGuid().ToString() };
            db.Users.Add(u);
            db.Memberships.Add(new Membership { Id = Guid.CreateVersion7(), UserId = u.Id, OrganisationId = org, Since = DateTimeOffset.UtcNow });
            db.RoleAssignments.Add(new RoleAssignment { Id = Guid.CreateVersion7(), UserId = u.Id, Role = Roles.Owner, ScopeType = ScopeTypes.Unit, OrganisationId = org, SchemeIds = [scheme.ToString()], UnitId = unit.ToString(), Label = "Kingfisher Court · Unit 14" });
            await db.SaveChangesAsync();
            return u.Id;
        });
        return new Setup(org, admin, person, user, scheme);
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.True(res.IsSuccessStatusCode, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private Task<HttpResponseMessage> EditEmail(Setup s, string email) =>
        s.Admin.PutAsJsonAsync($"/api/people/{s.Person}", new { firstName = "Nadia", lastName = "Abdul", kind = "individual", email, phone = "082 000 1111", preferredChannel = "email" });

    private Task<(string? SignIn, string Contact)> Addresses(Setup s) => api.Db(async db =>
        ((await db.Users.SingleAsync(u => u.Id == s.User)).Email, (await db.People.SingleAsync(p => p.Id == s.Person)).Email));

    private async Task<string> TokenSentTo(string address)
    {
        await HumoApiFactory.Until(() => api.Email.Sent.Any(m => m.To == address && m.Text.Contains("confirm-email")));
        return Regex.Match(api.Email.Sent.Last(m => m.To == address && m.Text.Contains("confirm-email")).Text, "token=([A-Za-z0-9_-]+)").Groups[1].Value;
    }

    private static Task<HttpResponseMessage> Confirm(HttpClient c, string token) => c.PostAsJsonAsync("/api/auth/email-change/confirm", new { token });

    private Task<List<string>> Audit(string text) => api.Db(db => db.Audit.Where(a => a.Action.Contains(text)).Select(a => a.Action).ToListAsync());

    [Fact]
    public async Task Changing_the_email_of_someone_who_signs_in_waits_for_the_new_address_and_tells_the_old_one()
    {
        var s = await AnOwnerWhoSignsIn();
        Assert.Equal(HttpStatusCode.NoContent, (await EditEmail(s, "nadia@example.mail")).StatusCode);

        // Nothing moves yet: statements and sign-in links stay with the address that's proven.
        Assert.Equal(("nadia@absa.example", "nadia@absa.example"), await Addresses(s));
        var token = await TokenSentTo("nadia@example.mail");
        await HumoApiFactory.Until(() => api.Email.Sent.Any(m => m.To == "nadia@absa.example"));
        Assert.Contains("nadia@example.mail", api.Email.Sent.Single(m => m.To == "nadia@absa.example").Text);

        var state = await (await s.Admin.GetAsync($"/api/people/{s.Person}/email-change")).Json();
        Assert.True(state.GetProperty("signsIn").GetBoolean());
        Assert.Equal("nadia@example.mail", state.GetProperty("pending").GetProperty("newEmail").GetString());

        // The link needs no session: they may have lost the old address.
        Assert.Equal(HttpStatusCode.OK, (await Confirm(api.CreateClient(), token)).StatusCode);
        Assert.Equal(("nadia@example.mail", "nadia@example.mail"), await Addresses(s));
        await HumoApiFactory.Until(() => api.Email.Sent.Any(m => m.To == "nadia@absa.example" && m.Subject.Contains("has changed")));

        // It works once.
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Confirm(api.CreateClient(), token)).StatusCode);
    }

    [Fact]
    public async Task The_audit_log_says_what_the_email_changed_from_and_to()
    {
        var s = await AnOwnerWhoSignsIn();
        await EditEmail(s, "nadia@example.mail");
        Assert.Single(await Audit("email nadia@absa.example to nadia@example.mail (waiting for them to confirm)"));

        await Confirm(api.CreateClient(), await TokenSentTo("nadia@example.mail"));
        Assert.Single(await Audit("Confirmed the change of email from nadia@absa.example to nadia@example.mail"));
    }

    [Fact]
    public async Task With_no_sign_in_the_email_changes_straight_away_and_is_audited()
    {
        var s = await AnOwnerWhoSignsIn();
        var unit = await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Scheme}/units", new { number = "15", description = "2-bed", sizeM2 = 86, participationQuota = 1, monthlyLevy = 1800, occupancy = "owner-occupied" }));
        var other = await Id(await s.Admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Andile", lastName = "Malindisa", kind = "individual", email = "andile@old.example", phone = "082 000 2222", preferredChannel = "email" },
            link = new { type = "owner", schemeId = s.Scheme.ToString(), unitId = unit.ToString(), since = "2020-01-01" },
        }));

        var edit = await s.Admin.PutAsJsonAsync($"/api/people/{other}", new { firstName = "Andile", lastName = "Malindisa", kind = "individual", email = "andile@new.example", phone = "082 000 2222", preferredChannel = "email" });

        Assert.Equal(HttpStatusCode.NoContent, edit.StatusCode);
        Assert.Equal("andile@new.example", await api.Db(db => db.People.Where(p => p.Id == other).Select(p => p.Email).SingleAsync()));
        Assert.DoesNotContain(api.Email.Sent, m => m.To == "andile@new.example");
        Assert.Single(await Audit("email andile@old.example to andile@new.example"));
        Assert.Empty(await Audit("andile@new.example (waiting"));
    }

    [Fact]
    public async Task A_newer_request_replaces_the_old_link_and_cancelling_stops_it()
    {
        var s = await AnOwnerWhoSignsIn();
        await EditEmail(s, "first@new.example");
        var first = await TokenSentTo("first@new.example");
        await EditEmail(s, "second@new.example");
        var second = await TokenSentTo("second@new.example");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Confirm(api.CreateClient(), first)).StatusCode);

        var state = await (await s.Admin.GetAsync($"/api/people/{s.Person}/email-change")).Json();
        var pending = state.GetProperty("pending").GetProperty("id").GetString();
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsync($"/api/email-changes/{pending}/cancel", null)).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Confirm(api.CreateClient(), second)).StatusCode);
        Assert.Equal(("nadia@absa.example", "nadia@absa.example"), await Addresses(s));
    }

    [Fact]
    public async Task A_link_expires_after_a_week()
    {
        var s = await AnOwnerWhoSignsIn();
        await EditEmail(s, "nadia@example.mail");
        var token = await TokenSentTo("nadia@example.mail");

        api.Clock.Advance(TimeSpan.FromDays(8));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Confirm(api.CreateClient(), token)).StatusCode);
        Assert.Equal(("nadia@absa.example", "nadia@absa.example"), await Addresses(s));
    }

    [Fact]
    public async Task An_address_someone_else_signs_in_with_is_refused_even_if_taken_after_asking()
    {
        var s = await AnOwnerWhoSignsIn();
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await EditEmail(s, "thandeka@acacia.example")).StatusCode);

        await EditEmail(s, "soon.taken@new.example");
        var token = await TokenSentTo("soon.taken@new.example");
        await api.Person("soon.taken@new.example", Roles.Finance, s.Org);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Confirm(api.CreateClient(), token)).StatusCode);
        Assert.Equal(("nadia@absa.example", "nadia@absa.example"), await Addresses(s));
    }

    [Fact]
    public async Task Confirming_ends_their_sessions_and_a_sign_in_link_out_at_the_old_address()
    {
        var s = await AnOwnerWhoSignsIn();
        var nadia = await api.SignedIn("nadia@absa.example");
        Assert.Equal(HttpStatusCode.OK, (await nadia.GetAsync("/api/me")).StatusCode);
        await EditEmail(s, "nadia@example.mail");
        var token = await TokenSentTo("nadia@example.mail");
        var oldLink = await api.Db(async db =>
        {
            var link = new SignInLink { Id = Guid.CreateVersion7(), UserId = s.User, TokenHash = "old", CodeHash = "x", CreatedAt = api.Clock.GetUtcNow(), ExpiresAt = api.Clock.GetUtcNow().AddMinutes(10) };
            db.SignInLinks.Add(link);
            await db.SaveChangesAsync();
            return link.Id;
        });

        await Confirm(api.CreateClient(), token);

        Assert.NotNull(await api.Db(db => db.SignInLinks.Where(l => l.Id == oldLink).Select(l => l.UsedAt).SingleAsync()));
        Assert.Equal(1, await api.Db(db => db.Users.CountAsync(u => u.NormalizedEmail == "NADIA@EXAMPLE.MAIL" && u.Id == s.User)));
    }

    [Fact]
    public async Task Someone_still_invited_gets_a_new_invitation_at_the_new_address()
    {
        var s = await AnOwnerWhoSignsIn();
        await api.Db(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == s.User)).Status = IdentityStatuses.Invited;
            return await db.SaveChangesAsync();
        });
        await EditEmail(s, "nadia@example.mail");

        Assert.Equal(HttpStatusCode.OK, (await Confirm(api.CreateClient(), await TokenSentTo("nadia@example.mail"))).StatusCode);

        await HumoApiFactory.Until(() => api.Email.Sent.Any(m => m.To == "nadia@example.mail" && m.Text.Contains("invite=1")));
    }

    [Fact]
    public async Task Moving_a_sign_in_from_users_and_access_needs_a_passkey_and_also_waits()
    {
        var s = await AnOwnerWhoSignsIn();
        var request = new { name = "Nadia Abdul", email = "nadia@example.mail", title = "" };

        Assert.Equal("step-up-required", await (await s.Admin.PutAsJsonAsync($"/api/access/identities/{s.User}", request)).ProblemCode());

        await s.Admin.StepUp();
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PutAsJsonAsync($"/api/access/identities/{s.User}", request)).StatusCode);
        Assert.Equal(("nadia@absa.example", "nadia@absa.example"), await Addresses(s));

        await Confirm(api.CreateClient(), await TokenSentTo("nadia@example.mail"));
        Assert.Equal(("nadia@example.mail", "nadia@example.mail"), await Addresses(s));
        Assert.Single(await Audit("asked to change their sign-in email from nadia@absa.example to nadia@example.mail"));
    }

    [Fact]
    public async Task A_finance_user_cant_see_or_settle_the_review_list()
    {
        var s = await AnOwnerWhoSignsIn();
        await api.Person("priya@acacia.example", Roles.Finance, s.Org);
        var finance = await api.SignedIn("priya@acacia.example");
        await MakeMismatch(s);

        var review = await (await finance.GetAsync("/api/access/email-review")).Json();
        Assert.Empty(review.GetProperty("mismatches").EnumerateArray());
        Assert.Equal("forbidden", await (await finance.PostAsJsonAsync($"/api/access/identities/{s.User}/email-mismatch", new { use = "sign-in" })).ProblemCode());
    }

    /// <summary>What an edit in People left behind before D34: the two addresses disagree.</summary>
    private Task<int> MakeMismatch(Setup s) => api.Db(async db =>
    {
        (await db.People.SingleAsync(p => p.Id == s.Person)).Email = "nadia@example.mail";
        return await db.SaveChangesAsync();
    });

    private static async Task<JsonElement> Mismatches(Setup s) => (await (await s.Admin.GetAsync("/api/access/email-review")).Json()).GetProperty("mismatches");

    [Fact]
    public async Task An_administrator_sees_records_that_disagree_and_can_keep_the_sign_in_address()
    {
        var s = await AnOwnerWhoSignsIn();
        await MakeMismatch(s);
        var found = Assert.Single((await Mismatches(s)).EnumerateArray());
        Assert.Equal(("Nadia Abdul", "nadia@example.mail", "nadia@absa.example"), (found.GetProperty("name").GetString(), found.GetProperty("contactEmail").GetString(), found.GetProperty("signInEmail").GetString()));

        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/access/identities/{s.User}/email-mismatch", new { use = "sign-in" })).StatusCode);

        Assert.Equal(("nadia@absa.example", "nadia@absa.example"), await Addresses(s));
        Assert.Empty((await Mismatches(s)).EnumerateArray());
        Assert.Single(await Audit("contact email from nadia@example.mail to their sign-in email, nadia@absa.example"));
    }

    [Fact]
    public async Task Choosing_the_contact_address_asks_it_to_confirm_with_a_passkey_first()
    {
        var s = await AnOwnerWhoSignsIn();
        await MakeMismatch(s);
        Assert.Equal("step-up-required", await (await s.Admin.PostAsJsonAsync($"/api/access/identities/{s.User}/email-mismatch", new { use = "contact" })).ProblemCode());

        await s.Admin.StepUp();
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/access/identities/{s.User}/email-mismatch", new { use = "contact" })).StatusCode);

        Assert.Equal("nadia@absa.example", (await Addresses(s)).SignIn);
        Assert.Empty((await Mismatches(s)).EnumerateArray());
        await Confirm(api.CreateClient(), await TokenSentTo("nadia@example.mail"));
        Assert.Equal(("nadia@example.mail", "nadia@example.mail"), await Addresses(s));
    }
}
