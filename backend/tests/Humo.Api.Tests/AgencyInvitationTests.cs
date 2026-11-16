using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Humo.Api.Tests;

/// <summary>
/// D46: one Humo sign-in, many agencies. A second agency's invitation waits for the person to accept; the agency never learns
/// they already use Humo, and neither agency sees or changes the other's record of them.
/// </summary>
public sealed class AgencyInvitationTests : IDisposable
{
    private const string Lindiwe = "lindiwe@mail.example";
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private string Day(int days) => DateOnly.FromDateTime(api.Clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).DateTime).AddDays(days).ToString("yyyy-MM-dd");

    private sealed record Agency(Guid Org, HttpClient Admin, Guid Scheme, Guid Unit, Guid Person);

    /// <summary>An agency with a scheme, a unit, and Lindiwe on its records as the owner, under the name it knows her by.</summary>
    private async Task<Agency> AnAgency(string name, string adminEmail, string firstName, string lastName)
    {
        var org = await api.Customer(name);
        await api.Person(adminEmail, Roles.AgencyAdmin, org);
        var admin = await api.SignedIn(adminEmail);
        var scheme = Guid.Parse((await (await admin.PostAsJsonAsync("/api/schemes", new { name = $"{name} Gardens", code = name[..2].ToUpperInvariant(), type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" })).Json())
            .GetProperty("id").GetString()!);
        var unit = Guid.Parse((await (await admin.PostAsJsonAsync($"/api/schemes/{scheme}/units", new { number = "100", description = "2-bed", sizeM2 = 80, participationQuota = 1, monthlyLevy = 2000, occupancy = "owner-occupied" })).Json())
            .GetProperty("id").GetString()!);
        var person = Guid.Parse((await (await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName, lastName, kind = "individual", email = Lindiwe, phone = "", preferredChannel = "email" },
            link = new { type = "owner", schemeId = scheme.ToString(), unitId = unit.ToString(), since = Day(-30) },
        })).Json()).GetProperty("id").GetString()!);
        return new Agency(org, admin, scheme, unit, person);
    }

    private static async Task<HttpResponseMessage> Invite(Agency a, string name)
    {
        await a.Admin.StepUp();
        return await a.Admin.PostAsJsonAsync("/api/access/invitations", new
        {
            organisationId = a.Org.ToString(), name, email = Lindiwe, personId = a.Person.ToString(),
            assignment = new { role = Roles.Owner, scope = new { type = "unit", organisationId = a.Org.ToString(), schemeIds = new[] { a.Scheme.ToString() }, unitId = a.Unit.ToString() }, label = "Unit 100" },
        });
    }

    /// <summary>Lindiwe already signs in to Acacia as the owner of its unit 100 (as an accepted invitation leaves her).</summary>
    private async Task<(Agency Acacia, Agency Tshik, Guid User)> TwoAgencies()
    {
        var acacia = await AnAgency("Acacia", "thandeka@acacia.example", "Lindiwe", "Dube");
        var tshik = await AnAgency("TshikRand", "priya@tshik.example", "Lindi", "Dube-Nkosi");
        Assert.Equal(HttpStatusCode.Created, (await Invite(acacia, "Lindiwe Dube")).StatusCode);
        var user = await api.Db(async db =>
        {
            var u = await db.Users.SingleAsync(x => x.NormalizedEmail == Lindiwe.ToUpperInvariant());
            u.Status = IdentityStatuses.Active;
            await db.SaveChangesAsync();
            return u.Id;
        });
        api.Email.Sent.Clear();
        return (acacia, tshik, user);
    }

    private async Task<List<(string Role, string Org)>> Roles_(string email) =>
        [.. (await (await (await api.SignedIn(email)).GetAsync("/api/me")).Json()).GetProperty("assignments").EnumerateArray()
            .Select(a => (a.GetProperty("role").GetString()!, a.GetProperty("scope").GetProperty("organisationId").GetString()!))];

    private async Task<JsonElement> InDirectory(Agency a, Guid user) =>
        (await (await a.Admin.GetAsync("/api/access/directory")).Json()).EnumerateArray().Single(u => u.GetProperty("id").GetString() == user.ToString());

    [Fact]
    public async Task A_second_agency_invites_without_learning_anything_and_nothing_applies_until_she_accepts()
    {
        var (acacia, tshik, user) = await TwoAgencies();

        var invited = await Invite(tshik, "Lindi Dube-Nkosi");
        Assert.Equal(HttpStatusCode.Created, invited.StatusCode);

        // She's asked by email, by her own name (the sign-in's), not TshikRand's.
        var mail = Assert.Single(api.Email.Sent, m => m.To == Lindiwe);
        Assert.Equal("TshikRand invites you to Humo Property Management", mail.Subject);
        Assert.StartsWith("Hello Lindiwe Dube,", mail.Text);

        // TshikRand sees what it would for anyone new: its own name for her, and "invited".
        var seen = await InDirectory(tshik, user);
        Assert.Equal("Lindi Dube-Nkosi", seen.GetProperty("name").GetString());
        Assert.Equal(IdentityStatuses.Invited, seen.GetProperty("status").GetString());
        Assert.Equal(tshik.Person.ToString(), seen.GetProperty("personId").GetString());
        Assert.All(seen.GetProperty("memberships").EnumerateArray(), m => Assert.Equal(tshik.Org.ToString(), m.GetProperty("organisationId").GetString()));
        var audit = await api.Db(db => db.Audit.Where(e => e.OrganisationId == tshik.Org && e.Action.StartsWith("Invited")).Select(e => e.Action).ToListAsync());
        Assert.Equal([$"Invited Lindi Dube-Nkosi ({Lindiwe}) as Owner · Unit 100"], audit);

        // Lindiwe still works only for Acacia, whose record of her is untouched; she's asked, by her own name.
        Assert.Equal([(Roles.Owner, acacia.Org.ToString())], await Roles_(Lindiwe));
        Assert.Equal("Lindiwe Dube", await api.Db(db => db.People.Where(p => p.Id == acacia.Person).Select(p => p.DisplayName).SingleAsync()));

        var waiting = (await (await (await api.SignedIn(Lindiwe)).GetAsync("/api/me/invitations")).Json()).EnumerateArray().ToList();
        var invitation = Assert.Single(waiting);
        Assert.Equal("Lindi Dube-Nkosi", invitation.GetProperty("name").GetString());
        Assert.Equal(tshik.Org.ToString(), invitation.GetProperty("organisationId").GetString());

        // Acacia's directory never shows TshikRand.
        Assert.All((await InDirectory(acacia, user)).GetProperty("memberships").EnumerateArray(), m => Assert.Equal(acacia.Org.ToString(), m.GetProperty("organisationId").GetString()));
    }

    [Fact]
    public async Task Accepting_adds_the_agency_and_corrects_only_its_record()
    {
        var (acacia, tshik, user) = await TwoAgencies();
        await Invite(tshik, "Lindi Dube-Nkosi");

        var me = await api.SignedIn(Lindiwe);
        var accepted = await me.PostAsJsonAsync($"/api/me/invitations/{tshik.Org}/accept", new { name = "Lindiwe Dube-Nkosi", phone = "082 123 4567" });
        Assert.Equal(HttpStatusCode.NoContent, accepted.StatusCode);

        Assert.Equal([acacia.Org.ToString(), tshik.Org.ToString()], (await Roles_(Lindiwe)).Select(r => r.Org).Order().ToList());
        var records = await api.Db(db => db.People.Where(p => p.Id == acacia.Person || p.Id == tshik.Person).ToDictionaryAsync(p => p.Id, p => (p.DisplayName, p.Phone)));
        Assert.Equal(("Lindiwe Dube", ""), records[acacia.Person]);
        Assert.Equal(("Lindiwe Dube-Nkosi", "0821234567"), records[tshik.Person]);
        Assert.Equal("Lindiwe Dube-Nkosi", (await InDirectory(tshik, user)).GetProperty("name").GetString());
        Assert.Equal("Lindiwe Dube", (await InDirectory(acacia, user)).GetProperty("name").GetString());

        var audit = await api.Db(db => db.Audit.Where(e => e.OrganisationId == tshik.Org && e.Action.Contains("accepted")).Select(e => e.Action).SingleAsync());
        Assert.Equal("Lindiwe Dube-Nkosi accepted the invitation and corrected their name (Lindi Dube-Nkosi → Lindiwe Dube-Nkosi) and mobile number (added)", audit);
        Assert.True(await api.Db(db => db.Notices.AnyAsync(n => n.OrganisationId == tshik.Org && n.ToRole == Roles.AgencyAdmin && n.Title == "Lindiwe Dube-Nkosi accepted their invitation")));

        // Acting for TshikRand, her own record is TshikRand's.
        var session = await (await me.GetAsync("/api/me")).Json();
        var tshikRole = session.GetProperty("assignments").EnumerateArray().Single(a => a.GetProperty("scope").GetProperty("organisationId").GetString() == tshik.Org.ToString());
        Assert.Equal(HttpStatusCode.OK, (await me.PutAsJsonAsync("/api/me/assignment", new { assignmentId = tshikRole.GetProperty("id").GetString() })).StatusCode);
    }

    [Fact]
    public async Task Declining_tells_the_agency_and_leaves_the_other_alone()
    {
        var (acacia, tshik, user) = await TwoAgencies();
        await Invite(tshik, "Lindi Dube-Nkosi");

        var me = await api.SignedIn(Lindiwe);
        Assert.Equal(HttpStatusCode.NoContent, (await me.PostAsync($"/api/me/invitations/{tshik.Org}/decline", null)).StatusCode);

        Assert.Equal([(Roles.Owner, acacia.Org.ToString())], await Roles_(Lindiwe));
        Assert.False(await api.Db(db => db.RoleAssignments.AnyAsync(a => a.UserId == user && a.OrganisationId == tshik.Org && a.Status == AssignmentStatuses.Active)));
        Assert.True(await api.Db(db => db.Notices.AnyAsync(n => n.OrganisationId == tshik.Org && n.Title == "Lindi Dube-Nkosi declined their invitation")));
        Assert.Empty((await (await me.GetAsync("/api/me/invitations")).Json()).EnumerateArray());
        // Nothing to accept any more.
        Assert.Equal(HttpStatusCode.NotFound, (await me.PostAsJsonAsync($"/api/me/invitations/{tshik.Org}/accept", new { })).StatusCode);
    }

    [Fact]
    public async Task An_agency_can_neither_accept_for_her_nor_rename_or_move_her_sign_in()
    {
        var (acacia, tshik, user) = await TwoAgencies();
        await Invite(tshik, "Lindi Dube-Nkosi");

        await tshik.Admin.StepUp();
        var restore = await tshik.Admin.PostAsJsonAsync($"/api/access/identities/{user}/membership", new { organisationId = tshik.Org.ToString(), status = "active", reason = "She said yes on the phone" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, restore.StatusCode);
        Assert.Equal([(Roles.Owner, acacia.Org.ToString())], await Roles_(Lindiwe));

        var version = (await InDirectory(tshik, user)).GetProperty("version").GetInt32();
        var moved = await tshik.Admin.PutAsJsonAsync($"/api/access/identities/{user}", new { name = "Lindi Nkosi", email = "lindi@other.example", expectedVersion = version });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, moved.StatusCode);
        var renamed = await tshik.Admin.PutAsJsonAsync($"/api/access/identities/{user}", new { name = "Lindi Nkosi", email = Lindiwe, expectedVersion = version });
        Assert.Equal(HttpStatusCode.NoContent, renamed.StatusCode);
        Assert.Equal("Lindi Nkosi", (await InDirectory(tshik, user)).GetProperty("name").GetString());
        Assert.Equal("Lindiwe Dube", (await InDirectory(acacia, user)).GetProperty("name").GetString());
        Assert.Equal("Lindiwe Dube", await api.Db(db => db.Users.Where(u => u.Id == user).Select(u => u.Name).SingleAsync()));
    }

    [Fact]
    public async Task One_agencys_records_never_end_her_roles_at_another()
    {
        var (acacia, tshik, _) = await TwoAgencies();
        await Invite(tshik, "Lindi Dube-Nkosi");
        await (await api.SignedIn(Lindiwe)).PostAsJsonAsync($"/api/me/invitations/{tshik.Org}/accept", new { });

        // The nightly sweep looks at each agency's records: neither ends the other's roles.
        using (var scope = api.Services.CreateScope())
            await Portfolio.PeopleEndpoints.SyncAllResidentAccessAsync(
                scope.ServiceProvider.GetRequiredService<HumoDbContext>(),
                scope.ServiceProvider.GetRequiredService<Portfolio.PortfolioReads>(), CancellationToken.None);

        Assert.Equal([acacia.Org.ToString(), tshik.Org.ToString()], (await Roles_(Lindiwe)).Select(r => r.Org).Order().ToList());
    }
}
