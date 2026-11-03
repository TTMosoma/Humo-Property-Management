using System.Net;
using System.Net.Http.Json;
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
