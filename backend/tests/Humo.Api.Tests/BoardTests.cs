using System.Net;
using System.Net.Http.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>The trustee board is the source of truth for trustee access (D2, doc 24 §6).</summary>
public sealed class BoardTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private record Setup(Guid Org, Guid Kc, Guid Unit, Guid Owner, HttpClient Admin);

    private async Task<Setup> SchemeWithOwner()
    {
        var org = await api.Organisation("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        var unit = await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "12", description = "3-bed", sizeM2 = 120, participationQuota = 2, monthlyLevy = 2400, occupancy = "owner-occupied" }));
        var owner = await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Sipho", lastName = "Khumalo", kind = "individual", email = "sipho@mail.example", phone = "083 551 0274", preferredChannel = "email" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = unit.ToString(), since = "2019-05-01" },
        }));
        return new Setup(org, kc, unit, owner, admin);
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private static Task<HttpResponseMessage> Act(HttpClient client, Guid scheme, object action) => client.PostAsJsonAsync($"/api/boards/{scheme}/actions", action);

    [Fact]
    public async Task Owners_are_the_candidates_and_a_co_opted_owner_joins_the_board()
    {
        var s = await SchemeWithOwner();
        var candidates = await (await s.Admin.GetAsync($"/api/boards/{s.Kc}/candidates")).Json();
        Assert.Equal("KC-012", candidates[0].GetProperty("units")[0].GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await Act(s.Admin, s.Kc, new { type = "appoint", personId = s.Owner.ToString(), portfolio = "Chairperson", how = "co-opted", since = "2026-03-01" })).StatusCode);
        var board = await (await s.Admin.GetAsync($"/api/boards/{s.Kc}")).Json();
        Assert.Equal("Sipho Khumalo", board.GetProperty("trustees")[0].GetProperty("person").GetProperty("displayName").GetString());
        Assert.Equal(1, board.GetProperty("coOpted").GetInt32());
        Assert.Equal(3, board.GetProperty("minimum").GetInt32());
        Assert.Empty((await (await s.Admin.GetAsync($"/api/boards/{s.Kc}/candidates")).Json()).EnumerateArray());
    }

    [Fact]
    public async Task Board_rules_hold()
    {
        var s = await SchemeWithOwner();
        var future = await Act(s.Admin, s.Kc, new { type = "appoint", personId = s.Owner.ToString(), portfolio = "Trustee", how = "co-opted", since = "2099-01-01" });
        Assert.Equal("Record the appointment once it has happened.", (await future.FieldErrors()).GetProperty("since").GetString());
        var noResolution = await Act(s.Admin, s.Kc, new { type = "appoint", personId = s.Owner.ToString(), portfolio = "Trustee", how = "elected", since = "2026-03-01" });
        Assert.True((await noResolution.FieldErrors()).TryGetProperty("resolutionId", out _));
        var stranger = await Act(s.Admin, s.Kc, new { type = "appoint", personId = Guid.NewGuid().ToString(), portfolio = "Trustee", how = "co-opted", since = "2026-03-01" });
        Assert.True((await stranger.FieldErrors()).TryGetProperty("personId", out _));
        Assert.True((await (await Act(s.Admin, s.Kc, new { type = "set-minimum", minimum = 20 })).FieldErrors()).TryGetProperty("minimum", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await Act(s.Admin, s.Kc, new { type = "set-minimum", minimum = 5 })).StatusCode);
    }

    [Fact]
    public async Task Appointing_a_trustee_with_a_sign_in_grants_access_and_ending_the_term_takes_it_away()
    {
        var s = await SchemeWithOwner();
        // Sipho can sign in as an owner (linked to his People record).
        var sipho = await api.Person("sipho@mail.example", Roles.Owner, s.Org);
        await api.Db(db => db.Users.Where(u => u.Id == sipho).ExecuteUpdateAsync(x => x.SetProperty(u => u.PersonId, s.Owner.ToString())));

        await Act(s.Admin, s.Kc, new { type = "appoint", personId = s.Owner.ToString(), portfolio = "Trustee", how = "elected", resolutionId = "AGM 2026, resolution 4", since = "2026-03-01" });
        var trustee = await api.Db(db => db.RoleAssignments.Where(a => a.UserId == sipho && a.Role == Roles.Trustee).SingleAsync());
        Assert.Equal(AssignmentStatuses.Active, trustee.Status);
        Assert.Equal([s.Kc.ToString()], trustee.SchemeIds);
        var board = await (await s.Admin.GetAsync($"/api/boards/{s.Kc}")).Json();
        Assert.True(board.GetProperty("trustees")[0].GetProperty("hasSignIn").GetBoolean());
        var rel = board.GetProperty("trustees")[0].GetProperty("relationship").GetProperty("id").GetString();

        Assert.Equal(HttpStatusCode.NoContent, (await Act(s.Admin, s.Kc, new { type = "end", relationshipId = rel, on = "2026-09-30", reason = "Sold their unit" })).StatusCode);
        Assert.Equal(AssignmentStatuses.Ended, await api.Db(db => db.RoleAssignments.Where(a => a.Id == trustee.Id).Select(a => a.Status).SingleAsync()));
        var after = await (await s.Admin.GetAsync($"/api/boards/{s.Kc}")).Json();
        Assert.Empty(after.GetProperty("trustees").EnumerateArray());
        Assert.Equal("2026-09-29", after.GetProperty("former")[0].GetProperty("relationship").GetProperty("until").GetString());
    }

    [Fact]
    public async Task Only_staff_with_Meetings_Manage_change_the_board()
    {
        var s = await SchemeWithOwner();
        await api.Person("finance@acacia.example", Roles.Finance, s.Org);
        var finance = await api.SignedIn("finance@acacia.example");
        var res = await Act(finance, s.Kc, new { type = "set-minimum", minimum = 4 });
        Assert.Equal("forbidden", await res.ProblemCode());
    }
}
