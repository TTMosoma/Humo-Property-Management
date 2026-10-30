using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Api.Finance;
using Humo.Domain.Access;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Humo.Api.Tests;

/// <summary>Reports on the API: the catalogue by permission and plan, each report from live records, and real scheme health.</summary>
public sealed class ReportTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private async Task<(Guid Kc, HttpClient Admin)> Scheme(string package = "professional")
    {
        var org = await api.Customer("Acacia", package);
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var res = await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" });
        var kc = Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
        foreach (var (n, levy, occupancy) in new[] { ("1", 2000, "owner-occupied"), ("2", 3000, "tenanted") })
            Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = n, description = "2-bed", sizeM2 = 86, participationQuota = 50, monthlyLevy = levy, occupancy })).StatusCode);
        var unit2 = await api.Db(db => db.Units.Where(u => u.Number == "2").Select(u => u.Id).SingleAsync());
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Grace", lastName = "Mokoena", kind = "individual", email = "grace@mail.example", phone = "076 118 4420", preferredChannel = "email" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = unit2.ToString(), since = "2019-05-01" },
        })).StatusCode);
        return (kc, admin);
    }

    /// <summary>Unit 2 owes four months: R 3 000 a month, the oldest 120 days back.</summary>
    private async Task Arrears()
    {
        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HumoDbContext>();
        var ledger = scope.ServiceProvider.GetRequiredService<AccountLedger>();
        var account = await db.LevyAccounts.SingleAsync(a => a.AccountNo.EndsWith("2"));
        var today = DateOnly.FromDateTime(api.Clock.GetUtcNow().DateTime);
        for (var m = 0; m < 4; m++) await ledger.PostAsync(account, today.AddDays(-30 * m - 5), TransactionTypes.Levy, "Levy", 3000, "Test", ct: CancellationToken.None);
        await db.SaveChangesAsync();
    }

    private static async Task<JsonElement> Run(HttpClient c, string id, Guid scheme) => await (await c.GetAsync($"/api/reports/{id}?schemeIds={scheme}")).Json();

    [Fact]
    public async Task The_catalogue_follows_permission_and_plan_and_leaves_out_what_isnt_on_the_api()
    {
        var (_, admin) = await Scheme();
        var ids = (await (await admin.GetAsync("/api/reports")).Json()).EnumerateArray().Select(r => r.GetProperty("id").GetString()).ToList();
        Assert.Contains("debtors", ids);
        Assert.Contains("scheme-health", ids);
        Assert.DoesNotContain("resolutions", ids);
        Assert.DoesNotContain("compliance-status", ids);

        using var small = new HumoApiFactory();
        var org = await small.Customer("Small", "essentials");
        await small.Person("admin@small.example", Roles.AgencyAdmin, org);
        var essentials = (await (await (await small.SignedIn("admin@small.example")).GetAsync("/api/reports")).Json()).EnumerateArray().Select(r => r.GetProperty("id").GetString()).ToList();
        Assert.Contains("levy-roll", essentials);
        Assert.DoesNotContain("debtors", essentials);
        Assert.Equal(HttpStatusCode.NotFound, (await (await small.SignedIn("admin@small.example")).GetAsync("/api/reports/debtors?schemeIds=x")).StatusCode);
    }

    [Fact]
    public async Task Reports_are_worked_out_from_live_records_with_totals()
    {
        var (kc, admin) = await Scheme();
        await Arrears();

        var roll = await Run(admin, "levy-roll", kc);
        Assert.Equal((5000m, 60000m), (roll.GetProperty("rows")[0].GetProperty("roll").GetDecimal(), roll.GetProperty("totals").GetProperty("annual").GetDecimal()));
        Assert.Equal("1 scheme", roll.GetProperty("scope").GetString());

        var age = await Run(admin, "age-analysis", kc);
        Assert.Equal(12000m, age.GetProperty("totals").GetProperty("total").GetDecimal());
        Assert.True(age.GetProperty("rows")[0].GetProperty("d90").GetDecimal() > 0);

        var debtors = await Run(admin, "debtors", kc);
        Assert.Equal(1, debtors.GetProperty("rows").GetArrayLength());

        var occupancy = (await Run(admin, "occupancy", kc)).GetProperty("rows")[0];
        Assert.Equal((2, 1, 1, 1), (occupancy.GetProperty("units").GetInt32(), occupancy.GetProperty("owner").GetInt32(), occupancy.GetProperty("tenanted").GetInt32(), occupancy.GetProperty("arrears").GetInt32()));

        // Scheme health is real now: arrears, an account 90+ days, and a rating that says so.
        var health = (await Run(admin, "scheme-health", kc)).GetProperty("rows")[0];
        Assert.Equal("At risk", health.GetProperty("rating").GetString());
        Assert.Equal(1, health.GetProperty("ninety").GetInt32());
        var dashboard = (await (await admin.GetAsync("/api/schemes/health")).Json())[0];
        Assert.Equal(("at-risk", 1), (dashboard.GetProperty("rating").GetString(), dashboard.GetProperty("accounts90Plus").GetInt32()));

        // A period report takes the months.
        var billing = await (await admin.GetAsync($"/api/reports/billing-summary?schemeIds={kc}&months=6")).Json();
        Assert.Equal("1 scheme · last 6 months", billing.GetProperty("scope").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/reports/resolutions?schemeIds={kc}")).StatusCode);
    }
}
