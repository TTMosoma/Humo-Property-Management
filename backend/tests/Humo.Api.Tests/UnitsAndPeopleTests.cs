using System.Net;
using System.Net.Http.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Units, levy accounts, people and relationships (doc 24 §5–§6).</summary>
public sealed class UnitsAndPeopleTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private static object Unit(string number = "42", decimal levy = 1850.5m, int? expectedVersion = null) =>
        new { number, description = "2-bed apartment", sizeM2 = 86, participationQuota = 1.25m, monthlyLevy = levy, occupancy = "owner-occupied", expectedVersion };

    private static object Person(string first = "Anele", string last = "Mthembu", string email = "anele@mail.example") =>
        new { firstName = first, lastName = last, kind = "individual", email, phone = "082 418 2290", preferredChannel = "email" };

    private record Setup(Guid Org, Guid Kc, Guid Tw, HttpClient Admin);

    private async Task<Setup> Agency()
    {
        var org = await api.Organisation("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        var tw = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "The Willows", code = "TW", type = "Sectional Title", suburb = "Lynnwood", city = "Pretoria", province = "Gauteng" }));
        return new Setup(org, kc, tw, admin);
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    [Fact]
    public async Task A_unit_comes_with_its_levy_account()
    {
        var s = await Agency();
        var unit = await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", Unit()));
        var summary = await (await s.Admin.GetAsync($"/api/schemes/{s.Kc}/units/42")).Json();
        Assert.Equal(unit.ToString(), summary.GetProperty("unit").GetProperty("id").GetString());
        Assert.Equal("KC-042", summary.GetProperty("unit").GetProperty("accountNo").GetString());
        Assert.Equal("KC-042", summary.GetProperty("account").GetProperty("accountNo").GetString());
        Assert.Equal(0m, summary.GetProperty("account").GetProperty("balance").GetDecimal());
        Assert.Equal(1, (await (await s.Admin.GetAsync($"/api/schemes/{s.Kc}")).Json()).GetProperty("unitCount").GetInt32());
        Assert.Equal(1850.5m, (await (await s.Admin.GetAsync("/api/schemes/health")).Json()).EnumerateArray().First(h => h.GetProperty("schemeId").GetString() == s.Kc.ToString()).GetProperty("monthlyLevyRoll").GetDecimal());
    }

    [Fact]
    public async Task Units_are_validated_and_unique_in_their_scheme()
    {
        var s = await Agency();
        await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", Unit()));
        Assert.Equal("There’s already a unit 42 in Kingfisher Court.", (await (await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", Unit())).FieldErrors()).GetProperty("number").GetString());
        await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Tw}/units", Unit())); // the same number elsewhere is fine

        var bad = await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", new { number = "too-long-7", description = "x", sizeM2 = 0, participationQuota = 120, monthlyLevy = -1, occupancy = "castle" });
        var errors = await bad.FieldErrors();
        foreach (var f in new[] { "number", "description", "sizeM2", "participationQuota", "monthlyLevy", "occupancy" }) Assert.True(errors.TryGetProperty(f, out _), f);
        Assert.Equal("KC-12B", await api.Db(async db => { await Task.CompletedTask; return Humo.Api.Portfolio.UnitEndpoints.AccountNumber("KC", "12b"); }));
    }

    [Fact]
    public async Task A_Portfolio_Manager_changes_units_only_in_their_schemes_D1()
    {
        var s = await Agency();
        var kcUnit = await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", Unit()));
        var twUnit = await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Tw}/units", Unit("7")));
        await api.Person("sarah@acacia.example", Roles.PortfolioManager, s.Org, [s.Kc], "Portfolio.BrowseAgency");
        var sarah = await api.SignedIn("sarah@acacia.example");

        Assert.Equal(HttpStatusCode.NoContent, (await sarah.PutAsJsonAsync($"/api/units/{kcUnit}", Unit(levy: 1900, expectedVersion: 1))).StatusCode);
        // She can read The Willows (browse grant) but not change it.
        Assert.Equal(HttpStatusCode.OK, (await sarah.GetAsync($"/api/units/{twUnit}")).StatusCode);
        var change = await sarah.PutAsJsonAsync($"/api/units/{twUnit}", Unit("7", 2000, 1));
        Assert.Equal("out-of-scope", await change.ProblemCode());
        Assert.Equal(1850.5m, await api.Db(db => db.Units.Where(u => u.Id == twUnit).Select(u => u.MonthlyLevy).SingleAsync()));
    }

    [Fact]
    public async Task People_are_linked_to_units_and_the_first_owner_holds_the_account()
    {
        var s = await Agency();
        var unit = await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", Unit()));
        var anele = await Id(await s.Admin.PostAsJsonAsync("/api/people", new { details = Person(), link = new { type = "owner", schemeId = s.Kc.ToString(), unitId = unit.ToString(), since = "2021-03-01" } }));

        var summary = await (await s.Admin.GetAsync($"/api/units/{unit}")).Json();
        Assert.Equal("Anele Mthembu", summary.GetProperty("owners")[0].GetProperty("displayName").GetString());
        Assert.Equal(anele.ToString(), summary.GetProperty("account").GetProperty("holderPersonId").GetString());

        var person = await (await s.Admin.GetAsync($"/api/people/{anele}")).Json();
        Assert.Equal("KC-042", person.GetProperty("relationships")[0].GetProperty("account").GetProperty("accountNo").GetString());
        Assert.Single((await (await s.Admin.GetAsync("/api/people/search?q=anele")).Json()).EnumerateArray());
        Assert.Single((await (await s.Admin.GetAsync("/api/people/search?q=4182")).Json()).EnumerateArray());
        Assert.Single((await (await s.Admin.GetAsync("/api/units/search?q=KC 42")).Json()).EnumerateArray());
        Assert.Empty((await (await s.Admin.GetAsync("/api/units/search?q=willows 42")).Json()).EnumerateArray());
    }

    [Fact]
    public async Task Relationship_rules_hold_and_trustees_come_from_the_board_D2()
    {
        var s = await Agency();
        var unit = await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", Unit()));
        var tenantLink = new { type = "tenant", schemeId = s.Kc.ToString(), unitId = unit.ToString(), since = "2025-01-01", until = "2026-12-31" };
        await Id(await s.Admin.PostAsJsonAsync("/api/people", new { details = Person("Lindiwe", "Dube", "lindiwe@mail.example"), link = tenantLink }));

        var second = await s.Admin.PostAsJsonAsync("/api/people", new { details = Person("Pieter", "Botha", "pieter@mail.example"), link = tenantLink });
        Assert.Equal("Unit 42 already has a tenant. End that lease first.", (await second.FieldErrors()).GetProperty("unitId").GetString());

        var trustee = await s.Admin.PostAsJsonAsync("/api/people", new { details = Person("Pieter", "Botha", "pieter@mail.example"), link = new { type = "trustee", schemeId = s.Kc.ToString(), since = "2025-01-01" } });
        Assert.Contains("board", (await trustee.FieldErrors()).GetProperty("type").GetString());

        var backwards = await s.Admin.PostAsJsonAsync("/api/people", new { details = Person("Pieter", "Botha", "pieter@mail.example"), link = tenantLink with { since = "2026-01-01", until = "2025-01-01" } });
        Assert.True((await backwards.FieldErrors()).TryGetProperty("until", out _));
    }

    [Fact]
    public async Task One_owner_owns_several_units_and_holds_each_account()
    {
        var s = await Agency();
        var u42 = await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", Unit("42")));
        var u43 = await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", Unit("43")));
        var anele = await Id(await s.Admin.PostAsJsonAsync("/api/people", new { details = Person(), link = new { type = "owner", schemeId = s.Kc.ToString(), unitId = u42.ToString(), since = "2021-03-01" } }));

        var second = await s.Admin.PostAsJsonAsync($"/api/people/{anele}/relationships", new { type = "owner", schemeId = s.Kc.ToString(), unitId = u43.ToString(), since = "2024-07-01" });
        Assert.Equal(HttpStatusCode.NoContent, second.StatusCode);
        var person = await (await s.Admin.GetAsync($"/api/people/{anele}")).Json();
        Assert.Equal(["KC-042", "KC-043"], person.GetProperty("relationships").EnumerateArray().Select(r => r.GetProperty("account").GetProperty("accountNo").GetString()).Order());
        Assert.Equal(2, await api.Db(db => db.LevyAccounts.CountAsync(a => a.HolderPersonId == anele)));

        // Linking the same unit twice is refused.
        var again = await s.Admin.PostAsJsonAsync($"/api/people/{anele}/relationships", new { type = "owner", schemeId = s.Kc.ToString(), unitId = u43.ToString(), since = "2024-07-01" });
        Assert.Equal("They already own this unit.", (await again.FieldErrors()).GetProperty("unitId").GetString());
    }

    [Fact]
    public async Task A_second_owner_is_asked_whether_they_own_it_jointly_or_replace_the_owner()
    {
        var s = await Agency();
        var u42 = await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", Unit("42")));
        var anele = await Id(await s.Admin.PostAsJsonAsync("/api/people", new { details = Person(), link = new { type = "owner", schemeId = s.Kc.ToString(), unitId = u42.ToString(), since = "2021-03-01" } }));
        var spouse = await Id(await s.Admin.PostAsJsonAsync("/api/people", new { details = Person("Zodwa", "Mthembu", "zodwa@mail.example") }));
        var buyer = await Id(await s.Admin.PostAsJsonAsync("/api/people", new { details = Person("Pieter", "Botha", "pieter@mail.example") }));
        object Owner(string since, string? ownership = null) => new { type = "owner", schemeId = s.Kc.ToString(), unitId = u42.ToString(), since, ownership };

        // Never assumed: the API asks.
        var ask = await s.Admin.PostAsJsonAsync($"/api/people/{spouse}/relationships", Owner("2022-01-01"));
        Assert.StartsWith("Unit 42 is owned by Anele Mthembu. Do they own it together", (await ask.FieldErrors()).GetProperty("ownership").GetString());

        // Joint owners: both own it; Anele stays the account holder.
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/people/{spouse}/relationships", Owner("2022-01-01", "joint"))).StatusCode);
        Assert.Equal(anele, await api.Db(db => db.LevyAccounts.Where(a => a.UnitId == u42).Select(a => a.HolderPersonId).SingleAsync()));

        // Sold: the new owner can't take over before the current owners became owners.
        Assert.True((await (await s.Admin.PostAsJsonAsync($"/api/people/{buyer}/relationships", Owner("2021-12-31", "replaces"))).FieldErrors()).TryGetProperty("since", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/people/{buyer}/relationships", Owner("2026-08-01", "replaces"))).StatusCode);
        var owners = await api.Db(db => db.Relationships.Where(r => r.UnitId == u42 && r.Type == "owner").OrderBy(r => r.Since).Select(r => new { r.PersonId, r.Until }).ToListAsync());
        Assert.Equal([new DateOnly(2026, 7, 31), new DateOnly(2026, 7, 31), (DateOnly?)null], owners.Select(o => o.Until));
        Assert.Equal(buyer, await api.Db(db => db.LevyAccounts.Where(a => a.UnitId == u42).Select(a => a.HolderPersonId).SingleAsync()));
    }

    [Fact]
    public async Task A_unit_added_by_mistake_can_be_deleted_but_not_one_with_history()
    {
        var s = await Agency();
        var mistake = await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", Unit("99")));
        await Id(await s.Admin.PostAsJsonAsync("/api/people", new { details = Person(), link = new { type = "owner", schemeId = s.Kc.ToString(), unitId = mistake.ToString(), since = "2021-03-01" } }));
        var billed = await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", Unit("42")));
        await api.Db(async db =>
        {
            var account = await db.LevyAccounts.SingleAsync(a => a.UnitId == billed);
            db.Ledger.Add(new LedgerEntry { Id = Guid.CreateVersion7(), AccountId = account.Id, Date = new DateOnly(2026, 10, 1), Type = "levy", Description = "October levy", Amount = 1850, CreatedAt = DateTimeOffset.UtcNow, CreatedBy = "Test" });
            return await db.SaveChangesAsync();
        });

        Assert.True((await (await s.Admin.PostAsJsonAsync($"/api/units/{mistake}/delete", new { reason = "" })).FieldErrors()).TryGetProperty("reason", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/units/{mistake}/delete", new { reason = "Typed 99 instead of 9" })).StatusCode);
        Assert.False(await api.Db(db => db.Units.AnyAsync(u => u.Id == mistake)));
        Assert.False(await api.Db(db => db.Relationships.AnyAsync(r => r.UnitId == mistake)));
        Assert.False(await api.Db(db => db.LevyAccounts.AnyAsync(a => a.UnitId == mistake)));

        var refused = await s.Admin.PostAsJsonAsync($"/api/units/{billed}/delete", new { reason = "Sold last month" });
        Assert.StartsWith("Unit 42 has charges or payments, so its records stay.", (await refused.FieldErrors()).GetProperty("unit").GetString());
    }

    [Fact]
    public async Task Contact_details_are_validated_and_emails_unique_in_the_directory()
    {
        var s = await Agency();
        var unit = await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", Unit()));
        var link = new { type = "owner", schemeId = s.Kc.ToString(), unitId = unit.ToString(), since = "2021-03-01" };
        await Id(await s.Admin.PostAsJsonAsync("/api/people", new { details = Person(), link }));

        var dup = await s.Admin.PostAsJsonAsync("/api/people", new { details = Person("Other", "Person", "ANELE@mail.example"), link });
        // The message names the existing record and says how to give them another unit.
        Assert.Equal("Anele Mthembu is already in People with this email. To give them another unit, open Anele Mthembu and use “Add a role”.",
            (await dup.FieldErrors()).GetProperty("email").GetString());
        var none = await s.Admin.PostAsJsonAsync("/api/people", new { details = new { firstName = "No", lastName = "Contact", kind = "individual", email = "", phone = "", preferredChannel = "email" } });
        var errors = await none.FieldErrors();
        Assert.True(errors.TryGetProperty("phone", out _));
        Assert.True(errors.TryGetProperty("preferredChannel", out _));
    }

    [Fact]
    public async Task Ending_a_relationship_keeps_the_history()
    {
        var s = await Agency();
        var unit = await Id(await s.Admin.PostAsJsonAsync($"/api/schemes/{s.Kc}/units", Unit()));
        var anele = await Id(await s.Admin.PostAsJsonAsync("/api/people", new { details = Person(), link = new { type = "owner", schemeId = s.Kc.ToString(), unitId = unit.ToString(), since = "2021-03-01" } }));
        var rel = (await (await s.Admin.GetAsync($"/api/people/{anele}")).Json()).GetProperty("relationships")[0].GetProperty("relationship").GetProperty("id").GetString();

        Assert.True((await (await s.Admin.PostAsJsonAsync($"/api/relationships/{rel}/end", new { until = "2020-01-01" })).FieldErrors()).TryGetProperty("until", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/relationships/{rel}/end", new { until = "2026-01-31" })).StatusCode);

        Assert.Empty((await (await s.Admin.GetAsync($"/api/units/{unit}")).Json()).GetProperty("owners").EnumerateArray());
        var history = (await (await s.Admin.GetAsync($"/api/people/{anele}")).Json()).GetProperty("relationships")[0].GetProperty("relationship");
        Assert.Equal("2026-01-31", history.GetProperty("until").GetString());
    }
}
