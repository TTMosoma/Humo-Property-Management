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
}
