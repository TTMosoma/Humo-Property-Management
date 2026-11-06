using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Api.Portfolio;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Humo.Api.Tests;

/// <summary>An owner's portal access follows the units they own: a second unit adds access to it, and selling one ends it.</summary>
public sealed class ResidentAccessTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private string Day(int days) => DateOnly.FromDateTime(api.Clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).DateTime).AddDays(days).ToString("yyyy-MM-dd");

    private Task<List<(string? Unit, string Status)>> Access(Guid user) =>
        api.Db(async db => (await db.RoleAssignments.Where(a => a.UserId == user && a.Role == Roles.Owner).ToListAsync()).Select(a => (a.UnitId, a.Status)).ToList());

    [Fact]
    public async Task An_owner_who_signs_in_gets_each_unit_they_own_and_loses_one_they_no_longer_own()
    {
        var org = await api.Customer("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var scheme = Guid.Parse((await (await admin.PostAsJsonAsync("/api/schemes", new { name = "Adante", code = "AD", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" })).Json())
            .GetProperty("id").GetString()!);
        var units = new List<Guid>();
        foreach (var n in new[] { "28", "77" })
            units.Add(Guid.Parse((await (await admin.PostAsJsonAsync($"/api/schemes/{scheme}/units", new { number = n, description = "2-bed", sizeM2 = 86, participationQuota = 1, monthlyLevy = 1800, occupancy = "owner-occupied" })).Json())
                .GetProperty("id").GetString()!));
        var person = Guid.Parse((await (await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Tshwari", lastName = "Mosoma", kind = "individual", email = "tshwari@mail.example", phone = "078 587 3841", preferredChannel = "email" },
            link = new { type = "owner", schemeId = scheme.ToString(), unitId = units[0].ToString(), since = Day(-30) },
        })).Json()).GetProperty("id").GetString()!);

        // Tshwari signs in to unit 28's portal (as an invitation gives it).
        var user = await api.Db(async db =>
        {
            var u = new HumoUser { Id = Guid.CreateVersion7(), UserName = "tshwari@mail.example", Email = "tshwari@mail.example", NormalizedEmail = "TSHWARI@MAIL.EXAMPLE",
                Name = "Tshwari Mosoma", Kind = IdentityKinds.Customer, Status = IdentityStatuses.Active, PersonId = person.ToString() };
            db.Users.Add(u);
            db.Memberships.Add(new Membership { Id = Guid.CreateVersion7(), UserId = u.Id, OrganisationId = org, Since = DateTimeOffset.UtcNow });
            db.RoleAssignments.Add(new RoleAssignment { Id = Guid.CreateVersion7(), UserId = u.Id, Role = Roles.Owner, ScopeType = ScopeTypes.Unit, OrganisationId = org,
                SchemeIds = [scheme.ToString()], UnitId = units[0].ToString(), Label = "Adante · Unit 28" });
            await db.SaveChangesAsync();
            return u.Id;
        });

        // A second unit: access to it straight away.
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync($"/api/people/{person}/relationships", new { type = "owner", schemeId = scheme.ToString(), unitId = units[1].ToString(), since = Day(0) })).StatusCode);
        var access = await Access(user);
        Assert.Equal([units[0].ToString(), units[1].ToString()], access.Where(a => a.Status == AssignmentStatuses.Active).Select(a => a.Unit).Order().ToList());

        // Unit 28 sold from a later date: access ends once that day has passed.
        var rel = await api.Db(db => db.Relationships.Where(r => r.PersonId == person && r.UnitId == units[0]).Select(r => r.Id).SingleAsync());
        Assert.True((await admin.PostAsJsonAsync($"/api/relationships/{rel}/end", new { endedOn = Day(2) })).IsSuccessStatusCode);
        Assert.Equal(2, (await Access(user)).Count(a => a.Status == AssignmentStatuses.Active));
        api.Clock.Advance(TimeSpan.FromDays(3));
        using (var scope = api.Services.CreateScope())
            await PeopleEndpoints.SyncAllResidentAccessAsync(scope.ServiceProvider.GetRequiredService<HumoDbContext>(), scope.ServiceProvider.GetRequiredService<PortfolioReads>(), CancellationToken.None);
        access = await Access(user);
        Assert.Equal([units[1].ToString()], access.Where(a => a.Status == AssignmentStatuses.Active).Select(a => a.Unit).ToList());
    }

    private sealed record Owner(Guid Org, HttpClient Admin, Guid Scheme, Guid Unit, Guid Person);

    /// <summary>Someone who owns a unit and has no sign-in yet.</summary>
    private async Task<Owner> AnOwner()
    {
        var org = await api.Customer("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var scheme = Guid.Parse((await (await admin.PostAsJsonAsync("/api/schemes", new { name = "Die Eike", code = "DE", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" })).Json())
            .GetProperty("id").GetString()!);
        var unit = Guid.Parse((await (await admin.PostAsJsonAsync($"/api/schemes/{scheme}/units", new { number = "9", description = "2-bed", sizeM2 = 80, participationQuota = 1, monthlyLevy = 2150, occupancy = "owner-occupied" })).Json())
            .GetProperty("id").GetString()!);
        var person = Guid.Parse((await (await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Johanna", lastName = "Visser", kind = "individual", email = "johanna@mail.example", phone = "084 990 3346", preferredChannel = "email" },
            link = new { type = "owner", schemeId = scheme.ToString(), unitId = unit.ToString(), since = Day(-30) },
        })).Json()).GetProperty("id").GetString()!);
        return new Owner(org, admin, scheme, unit, person);
    }

    private Task<HttpResponseMessage> Appoint(Owner o) =>
        o.Admin.PostAsJsonAsync($"/api/boards/{o.Scheme}/actions", new { type = "appoint", personId = o.Person.ToString(), portfolio = "Trustee", how = "co-opted", since = Day(-1) });

    private Task<HttpResponseMessage> InviteAsOwner(Owner o) => o.Admin.PostAsJsonAsync("/api/access/invitations", new
    {
        organisationId = o.Org.ToString(), name = "Johanna Visser", email = "johanna@mail.example", personId = o.Person.ToString(),
        assignment = new { role = Roles.Owner, scope = new { type = "unit", organisationId = o.Org.ToString(), schemeIds = new[] { o.Scheme.ToString() }, unitId = o.Unit.ToString() }, label = "Die Eike · Unit 9" },
    });

    private async Task<List<string>> ActiveRoles(string email)
    {
        var me = await (await (await api.SignedIn(email)).GetAsync("/api/me")).Json();
        return [.. me.GetProperty("assignments").EnumerateArray().Select(a => a.GetProperty("role").GetString()!).Order()];
    }

    [Fact]
    public async Task Invited_as_an_owner_while_already_on_the_board_they_can_work_as_either()
    {
        var o = await AnOwner();
        Assert.Equal(HttpStatusCode.NoContent, (await Appoint(o)).StatusCode);

        await o.Admin.StepUp();
        Assert.Equal(HttpStatusCode.Created, (await InviteAsOwner(o)).StatusCode);

        Assert.Equal([Roles.Owner, Roles.Trustee], await ActiveRoles("johanna@mail.example"));
    }

    private async Task<JsonElement> Me(string email) => await (await (await api.SignedIn(email)).GetAsync("/api/me")).Json();

    private async Task Sweep()
    {
        using var scope = api.Services.CreateScope();
        await PeopleEndpoints.SyncAllResidentAccessAsync(scope.ServiceProvider.GetRequiredService<HumoDbContext>(), scope.ServiceProvider.GetRequiredService<PortfolioReads>(), CancellationToken.None);
    }

    private Task<Guid> OwnershipOf(Owner o) => api.Db(db => db.Relationships.Where(r => r.PersonId == o.Person && r.Type == "owner").Select(r => r.Id).SingleAsync());

    private async Task<Owner> AnInvitedOwner()
    {
        var o = await AnOwner();
        await o.Admin.StepUp();
        Assert.Equal(HttpStatusCode.Created, (await InviteAsOwner(o)).StatusCode);
        return o;
    }

    [Fact]
    public async Task Editing_a_persons_details_saves_them_and_keeps_their_access()
    {
        var o = await AnInvitedOwner();
        var version = await api.Db(db => db.People.Where(p => p.Id == o.Person).Select(p => p.Version).SingleAsync());

        var edit = await o.Admin.PutAsJsonAsync($"/api/people/{o.Person}", new { firstName = "Johanna", lastName = "Visser-Botha", kind = "individual", email = "johanna@mail.example", phone = "082 000 1111", preferredChannel = "sms", expectedVersion = version });
        Assert.Equal(HttpStatusCode.NoContent, edit.StatusCode);

        var person = await api.Db(db => db.People.SingleAsync(p => p.Id == o.Person));
        Assert.Equal(("Johanna Visser-Botha", "082 000 1111", "sms"), (person.DisplayName, person.Phone, person.PreferredChannel));
        Assert.Equal([Roles.Owner], await ActiveRoles("johanna@mail.example"));

        // Someone else saved first: the older copy doesn't overwrite it.
        var stale = await o.Admin.PutAsJsonAsync($"/api/people/{o.Person}", new { firstName = "Johanna", lastName = "Visser", kind = "individual", email = "johanna@mail.example", phone = "082 000 1111", preferredChannel = "sms", expectedVersion = version });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
    }

    [Fact]
    public async Task An_owner_who_sells_stays_signed_in_with_no_property_and_nothing_else()
    {
        var o = await AnInvitedOwner();
        Assert.Equal(HttpStatusCode.NoContent, (await o.Admin.PostAsJsonAsync($"/api/relationships/{await OwnershipOf(o)}/end", new { endedOn = Day(-1) })).StatusCode);

        var me = await Me("johanna@mail.example");
        Assert.True(me.GetProperty("signedIn").GetBoolean());
        Assert.Equal(new[] { "Security.ManageOwn", "Statements.ViewPast" }, me.GetProperty("permissions").EnumerateArray().Select(p => p.GetString()!).Order().ToArray());
        Assert.Equal([Roles.PastResident], await ActiveRoles("johanna@mail.example"));

        var former = await api.SignedIn("johanna@mail.example");
        var view = await (await former.GetAsync("/api/me/past-resident")).Json();
        Assert.StartsWith("Acacia", view.GetProperty("agency").GetProperty("name").GetString());
        var home = Assert.Single(view.GetProperty("homes").EnumerateArray());
        Assert.Equal(("owner", "9"), (home.GetProperty("type").GetString(), home.GetProperty("unit").GetString()));

        // Nothing of the scheme's any more.
        Assert.Empty((await (await former.GetAsync("/api/me/jobs")).Json()).EnumerateArray());
        Assert.Empty((await (await former.GetAsync("/api/schemes")).Json()).EnumerateArray());
        Assert.Equal("forbidden", await (await former.PostAsJsonAsync("/api/jobs", new { title = "Leak", description = "Drip", category = "Plumbing" })).ProblemCode());
    }

    [Fact]
    public async Task Selling_with_a_future_date_keeps_the_owner_until_that_day()
    {
        var o = await AnInvitedOwner();
        Assert.Equal(HttpStatusCode.NoContent, (await o.Admin.PostAsJsonAsync($"/api/relationships/{await OwnershipOf(o)}/end", new { endedOn = Day(7) })).StatusCode);
        Assert.Equal([Roles.Owner], await ActiveRoles("johanna@mail.example"));

        api.Clock.Advance(TimeSpan.FromDays(8));
        await Sweep();
        Assert.Equal([Roles.PastResident], await ActiveRoles("johanna@mail.example"));
    }

    [Fact]
    public async Task A_purchase_dated_next_week_gives_access_to_that_unit_on_that_day()
    {
        var o = await AnInvitedOwner();
        var second = Guid.Parse((await (await o.Admin.PostAsJsonAsync($"/api/schemes/{o.Scheme}/units", new { number = "10", description = "2-bed", sizeM2 = 80, participationQuota = 1, monthlyLevy = 2150, occupancy = "owner-occupied" })).Json())
            .GetProperty("id").GetString()!);
        Assert.True((await o.Admin.PostAsJsonAsync($"/api/people/{o.Person}/relationships", new { type = "owner", schemeId = o.Scheme.ToString(), unitId = second.ToString(), since = Day(7) })).IsSuccessStatusCode);
        async Task<int> OwnerRoles() => await api.Db(db => db.RoleAssignments.CountAsync(a => a.Role == Roles.Owner && a.Status == AssignmentStatuses.Active && a.UnitId == second.ToString()));

        Assert.Equal(0, await OwnerRoles());

        api.Clock.Advance(TimeSpan.FromDays(8));
        await Sweep();
        Assert.Equal(1, await OwnerRoles());
    }

    [Fact]
    public async Task Leaving_the_board_while_still_an_owner_only_takes_trustee_access_away()
    {
        var o = await AnInvitedOwner();
        Assert.Equal(HttpStatusCode.NoContent, (await Appoint(o)).StatusCode);
        Assert.Equal([Roles.Owner, Roles.Trustee], await ActiveRoles("johanna@mail.example"));
        var seat = await api.Db(db => db.Relationships.Where(r => r.PersonId == o.Person && r.Type == "trustee").Select(r => r.Id).SingleAsync());

        Assert.Equal(HttpStatusCode.NoContent, (await o.Admin.PostAsJsonAsync($"/api/boards/{o.Scheme}/actions", new { type = "end", relationshipId = seat.ToString(), on = Day(-1), reason = "Resigned at the AGM" })).StatusCode);

        Assert.Equal([Roles.Owner], await ActiveRoles("johanna@mail.example"));
    }

    [Fact]
    public async Task Owning_again_goes_back_to_the_owners_home_and_the_past_stays_on_offer()
    {
        var o = await AnInvitedOwner();
        Assert.Equal(HttpStatusCode.NoContent, (await o.Admin.PostAsJsonAsync($"/api/relationships/{await OwnershipOf(o)}/end", new { endedOn = Day(-1) })).StatusCode);
        var unit = await api.Db(db => db.Units.Where(u => u.SchemeId == o.Scheme).Select(u => u.Id).FirstAsync());

        var back = await o.Admin.PostAsJsonAsync($"/api/people/{o.Person}/relationships", new { type = "owner", schemeId = o.Scheme.ToString(), unitId = unit.ToString(), since = Day(0) });
        Assert.True(back.IsSuccessStatusCode, await back.Content.ReadAsStringAsync());

        var me = await Me("johanna@mail.example");
        var active = me.GetProperty("activeAssignmentId").GetString();
        Assert.Equal(Roles.Owner, me.GetProperty("assignments").EnumerateArray().Single(a => a.GetProperty("id").GetString() == active).GetProperty("role").GetString());
        Assert.Equal([Roles.Owner, Roles.PastResident], await ActiveRoles("johanna@mail.example"));
    }

    [Fact]
    public async Task An_administrator_can_end_it_for_good_and_nobody_can_grant_it()
    {
        var o = await AnInvitedOwner();
        Assert.Equal(HttpStatusCode.NoContent, (await o.Admin.PostAsJsonAsync($"/api/relationships/{await OwnershipOf(o)}/end", new { endedOn = Day(-1) })).StatusCode);
        var (user, role, version) = await api.Db(async db =>
        {
            var a = await db.RoleAssignments.SingleAsync(x => x.Role == Roles.PastResident);
            return (a.UserId, a.Id, a.Version);
        });

        await o.Admin.StepUp();
        var grant = await o.Admin.PostAsJsonAsync($"/api/access/identities/{user}/assignments", new { role = Roles.PastResident, scope = new { type = "schemes", schemeIds = new[] { o.Scheme.ToString() } }, label = "x" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, grant.StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await o.Admin.PostAsJsonAsync($"/api/access/identities/{user}/assignments/{role}/end", new { expectedVersion = version })).StatusCode);
        await Sweep();
        Assert.Empty(await ActiveRoles("johanna@mail.example"));
    }

    [Fact]
    public async Task Someone_with_no_property_left_doesnt_use_the_agencys_allowance()
    {
        var o = await AnInvitedOwner();
        async Task<decimal> Used() => (await (await o.Admin.GetAsync("/api/me/limits")).Json()).GetProperty("users").GetProperty("used").GetDecimal();
        var before = await Used();

        Assert.Equal(HttpStatusCode.NoContent, (await o.Admin.PostAsJsonAsync($"/api/relationships/{await OwnershipOf(o)}/end", new { endedOn = Day(-1) })).StatusCode);

        Assert.Equal(before - 1, await Used());
    }

    [Fact]
    public async Task Someone_who_already_signs_in_gets_their_board_seat_within_the_minute_and_leaving_ends_it()
    {
        var o = await AnOwner();
        await o.Admin.StepUp();
        Assert.Equal(HttpStatusCode.Created, (await InviteAsOwner(o)).StatusCode);

        // A seat on record with no access to match, as an invitation sent before this fix left it.
        await api.Db(async db =>
        {
            db.Relationships.Add(new Relationship { Id = Guid.CreateVersion7(), PersonId = o.Person, Type = "trustee", SchemeId = o.Scheme, Since = DateOnly.Parse(Day(-400)), AppointmentHow = "elected" });
            await db.SaveChangesAsync();
            return true;
        });
        using (var scope = api.Services.CreateScope())
            await PeopleEndpoints.SyncAllResidentAccessAsync(scope.ServiceProvider.GetRequiredService<HumoDbContext>(), scope.ServiceProvider.GetRequiredService<PortfolioReads>(), CancellationToken.None);
        Assert.Equal([Roles.Owner, Roles.Trustee], await ActiveRoles("johanna@mail.example"));

        // Leaving next week: still a trustee until then, and still an owner afterwards.
        var seat = await api.Db(db => db.Relationships.Where(r => r.PersonId == o.Person && r.Type == "trustee").Select(r => r.Id).SingleAsync());
        var end = await o.Admin.PostAsJsonAsync($"/api/boards/{o.Scheme}/actions", new { type = "end", relationshipId = seat.ToString(), on = Day(7), reason = "Resigned at the AGM" });
        Assert.Equal(HttpStatusCode.NoContent, end.StatusCode);
        Assert.Equal([Roles.Owner, Roles.Trustee], await ActiveRoles("johanna@mail.example"));

        api.Clock.Advance(TimeSpan.FromDays(8));
        using (var scope = api.Services.CreateScope())
            await PeopleEndpoints.SyncAllResidentAccessAsync(scope.ServiceProvider.GetRequiredService<HumoDbContext>(), scope.ServiceProvider.GetRequiredService<PortfolioReads>(), CancellationToken.None);
        Assert.Equal([Roles.Owner], await ActiveRoles("johanna@mail.example"));
    }

    [Fact]
    public async Task Appointing_someone_who_signs_in_gives_trustee_access_once_and_ending_today_takes_it_away()
    {
        var o = await AnOwner();
        await o.Admin.StepUp();
        Assert.Equal(HttpStatusCode.Created, (await InviteAsOwner(o)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Appoint(o)).StatusCode);
        Assert.Equal([Roles.Owner, Roles.Trustee], await ActiveRoles("johanna@mail.example"));

        var seat = await api.Db(db => db.Relationships.Where(r => r.PersonId == o.Person && r.Type == "trustee").Select(r => r.Id).SingleAsync());
        var end = await o.Admin.PostAsJsonAsync($"/api/boards/{o.Scheme}/actions", new { type = "end", relationshipId = seat.ToString(), on = Day(0), reason = "Resigned at the AGM" });
        Assert.Equal(HttpStatusCode.NoContent, end.StatusCode);
        Assert.Equal([Roles.Owner], await ActiveRoles("johanna@mail.example"));
    }
}
