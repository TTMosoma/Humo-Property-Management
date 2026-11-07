using System.Net;
using System.Net.Http.Json;
using Humo.Api.Portfolio;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Humo.Api.Tests;

/// <summary>
/// Who holds a unit's levy account (and so gets its statements and letters) when the unit changes hands: the current
/// owner, however the change was recorded.
/// </summary>
public sealed class AccountHolderTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private async Task<(HttpClient Admin, Guid Scheme, Guid Unit)> Unit()
    {
        var org = await api.Customer("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var scheme = Guid.Parse((await (await admin.PostAsJsonAsync("/api/schemes", new { name = "Acacia Dunes", code = "AD", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" })).Json())
            .GetProperty("id").GetString()!);
        var unit = Guid.Parse((await (await admin.PostAsJsonAsync($"/api/schemes/{scheme}/units", new { number = "77", description = "2-bed", sizeM2 = 86, participationQuota = 1, monthlyLevy = 1800, occupancy = "owner-occupied" })).Json())
            .GetProperty("id").GetString()!);
        return (admin, scheme, unit);
    }

    private static async Task<Guid> Owner(HttpClient admin, Guid scheme, Guid unit, string first, string since, string? ownership = null)
    {
        var res = await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = first, lastName = "Owner", kind = "individual", email = $"{first.ToLowerInvariant()}@mail.example", phone = "082 555 0101", preferredChannel = "email" },
            link = new { type = "owner", schemeId = scheme.ToString(), unitId = unit.ToString(), since, ownership },
        });
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private string Day(int days) => DateOnly.FromDateTime(api.Clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).DateTime).AddDays(days).ToString("yyyy-MM-dd");

    private Task<Guid?> Holder(Guid unit) => api.Db(db => db.LevyAccounts.Where(a => a.UnitId == unit).Select(a => a.HolderPersonId).SingleAsync());

    private async Task End(HttpClient admin, Guid person, string endedOn)
    {
        var rel = await api.Db(db => db.Relationships.Where(r => r.PersonId == person && r.Type == "owner").Select(r => r.Id).SingleAsync());
        var res = await admin.PostAsJsonAsync($"/api/relationships/{rel}/end", new { endedOn });
        Assert.True(res.IsSuccessStatusCode, await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Ending_the_only_owner_is_refused_and_the_buyer_replaces_them_instead()
    {
        var (admin, scheme, unit) = await Unit();
        var andile = await Owner(admin, scheme, unit, "Andile", Day(-30));
        Assert.Equal(andile, await Holder(unit));

        // D36: a unit always has an owner, so ending the only one would leave a gap.
        var rel = await api.Db(db => db.Relationships.Where(r => r.PersonId == andile && r.Type == "owner").Select(r => r.Id).SingleAsync());
        var refused = await admin.PostAsJsonAsync($"/api/relationships/{rel}/end", new { endedOn = Day(-4) });
        Assert.Contains("They replace the owner", (await refused.FieldErrors()).GetProperty("endedOn").GetString());

        var tshwari = await Owner(admin, scheme, unit, "Tshwari", Day(-4), ownership: "replaces");
        Assert.Equal(tshwari, await Holder(unit));
    }

    [Fact]
    public async Task A_gap_already_on_record_is_listed_and_correcting_the_dates_clears_it()
    {
        var (admin, scheme, unit) = await Unit();
        var andile = await Owner(admin, scheme, unit, "Andile", Day(-30));
        var tshwari = await Owner(admin, scheme, unit, "Tshwari", Day(10), ownership: "replaces");
        // As captured before D36: the seller's last day set apart from the buyer's first.
        await api.Db(async db =>
        {
            (await db.Relationships.SingleAsync(r => r.PersonId == andile)).Until = DateOnly.Parse(Day(-5));
            return await db.SaveChangesAsync();
        });

        var gap = Assert.Single((await (await admin.GetAsync($"/api/units/owner-gaps?schemeIds={scheme}")).Json()).EnumerateArray());
        Assert.Equal((Day(-4), Day(9)), (gap.GetProperty("from").GetString(), gap.GetProperty("to").GetString()));

        // Making it bigger is refused; closing it is allowed, and the account follows at once.
        var rel = await api.Db(db => db.Relationships.Where(r => r.PersonId == andile).Select(r => r.Id).SingleAsync());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await admin.PutAsJsonAsync($"/api/relationships/{rel}", new { since = Day(-30), until = Day(-6) })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsJsonAsync($"/api/relationships/{rel}", new { since = Day(-30), until = Day(9) })).StatusCode);

        Assert.Empty((await (await admin.GetAsync($"/api/units/owner-gaps?schemeIds={scheme}")).Json()).EnumerateArray());
        Assert.Equal(andile, await Holder(unit));
        Assert.NotEqual(tshwari, await Holder(unit));
    }

    [Fact]
    public async Task An_ownership_ended_from_a_later_date_hands_the_account_over_when_that_day_passes()
    {
        var (admin, scheme, unit) = await Unit();
        var andile = await Owner(admin, scheme, unit, "Andile", Day(-30));
        var tshwari = await Owner(admin, scheme, unit, "Tshwari", Day(0), ownership: "joint");
        await End(admin, andile, Day(3));
        Assert.Equal(andile, await Holder(unit));

        api.Clock.Advance(TimeSpan.FromDays(4));
        using (var scope = api.Services.CreateScope())
            await PeopleEndpoints.HandOverEndedAsync(scope.ServiceProvider.GetRequiredService<HumoDbContext>(), scope.ServiceProvider.GetRequiredService<PortfolioReads>(), CancellationToken.None);
        Assert.Equal(tshwari, await Holder(unit));
    }

    [Fact]
    public async Task A_joint_owner_leaves_the_current_holder_in_place()
    {
        var (admin, scheme, unit) = await Unit();
        var andile = await Owner(admin, scheme, unit, "Andile", Day(-30));
        await Owner(admin, scheme, unit, "Spouse", Day(0), ownership: "joint");
        Assert.Equal(andile, await Holder(unit));
    }
}
