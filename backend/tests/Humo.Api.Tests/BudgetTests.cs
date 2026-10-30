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

/// <summary>
/// Budgets on the API (D28). The test clock reads 19 October 2026: with a February year end, this year is 2026/27
/// (1 March 2026 to 28 February 2027) and eight months of levies have been billed.
/// </summary>
public sealed class BudgetTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Org, Guid Kc, HttpClient Admin);

    private async Task<Setup> Scheme()
    {
        var org = await api.Customer("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        // A levy roll of R 10 000 a month: R 120 000 a year.
        await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "1", description = "2-bed", sizeM2 = 86, participationQuota = 50, monthlyLevy = 5000, occupancy = "owner-occupied" }));
        await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "2", description = "2-bed", sizeM2 = 86, participationQuota = 50, monthlyLevy = 5000, occupancy = "owner-occupied" }));
        return new Setup(org, kc, admin);
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private static async Task NoContent(HttpResponseMessage res) =>
        Assert.True(res.StatusCode == HttpStatusCode.NoContent, $"{res.StatusCode}: {await res.Content.ReadAsStringAsync()}");

    private static Task<HttpResponseMessage> New(HttpClient c, Guid scheme, string year, decimal pct = 0, int? yearEnd = 2) =>
        c.PostAsJsonAsync("/api/budgets", new { schemeId = scheme.ToString(), year, increasePct = pct, financialYearEnd = yearEnd });

    private static async Task<JsonElement> View(HttpClient c, Guid id) => await (await c.GetAsync($"/api/budgets/{id}")).Json();

    private static async Task<HttpResponseMessage> Act(HttpClient c, Guid id, object action) =>
        await c.PostAsJsonAsync($"/api/budgets/{id}/actions", new { action, expectedVersion = (await View(c, id)).GetProperty("budget").GetProperty("version").GetInt32() });

    private static JsonElement Line(JsonElement view, string category) => view.GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("line").GetProperty("category").GetString() == category);

    [Fact]
    public async Task This_years_budget_is_captured_with_the_spending_before_Humo_PM_and_the_owners_approval()
    {
        var s = await Scheme();
        var id = await Id(await New(s.Admin, s.Kc, "current"));
        var v = await View(s.Admin, id);
        Assert.Equal(("2026/27", "2026-03-01", "2027-02-28", "draft"), (v.GetProperty("budget").GetProperty("year").GetString(), v.GetProperty("budget").GetProperty("from").GetString(),
            v.GetProperty("budget").GetProperty("to").GetString(), v.GetProperty("budget").GetProperty("status").GetString()));
        // A typical budget from the levy roll; the scheme's year end is now February.
        Assert.Equal(120_000m, Line(v, "Levies").GetProperty("line").GetProperty("annual").GetDecimal());
        Assert.Equal(20_000m, Line(v, "Insurance").GetProperty("line").GetProperty("annual").GetDecimal());
        Assert.Equal(2, await api.Db(db => db.Schemes.Where(x => x.Id == s.Kc).Select(x => x.FinancialYearEnd).SingleAsync()));

        await NoContent(await Act(s.Admin, id, new { type = "set-line", category = "Garden services", kind = "expense", annual = 12_000 }));
        // Spending before Humo PM, to 30 September; Humo PM's own records count from 1 October.
        await NoContent(await Act(s.Admin, id, new { type = "set-opening", to = "2026-09-30", amounts = new Dictionary<string, decimal> { ["Garden services"] = 8_000, ["Levies"] = 70_000 } }));
        using (var scope = api.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<HumoDbContext>();
            var account = await db.LevyAccounts.FirstAsync();
            await scope.ServiceProvider.GetRequiredService<AccountLedger>().PostAsync(account, new DateOnly(2026, 10, 1), TransactionTypes.Levy, "Levy — October", 10_000, "Test", ct: CancellationToken.None);
            await db.SaveChangesAsync();
        }
        var supplier = await Id(await s.Admin.PostAsJsonAsync("/api/suppliers", new
        {
            name = "GreenLeaf Gardens", trades = new[] { "Gardens" }, contactName = "Precious", phone = "082 555 0142", email = "a@greenleaf.example", schemeIds = new[] { s.Kc.ToString() },
        }));
        await api.Db(async db =>
        {
            db.SupplierInvoices.Add(new SupplierInvoiceRow { Id = Guid.CreateVersion7(), OrganisationId = s.Org, SchemeId = s.Kc, SupplierId = supplier, Number = "GL-1", Description = "Garden",
                Amount = 1_000, ReceivedAt = api.Clock.GetUtcNow(), DueOn = new DateOnly(2026, 11, 1), Status = "paid", PaidAt = api.Clock.GetUtcNow() });
            db.SupplierInvoices.Add(new SupplierInvoiceRow { Id = Guid.CreateVersion7(), OrganisationId = s.Org, SchemeId = s.Kc, SupplierId = supplier, Number = "GL-2", Description = "Garden",
                Amount = 800, ReceivedAt = api.Clock.GetUtcNow(), DueOn = new DateOnly(2026, 11, 1), Status = "approved" });
            return await db.SaveChangesAsync();
        });
        v = await View(s.Admin, id);
        var garden = Line(v, "Garden services");
        // 8 000 before + 1 000 paid; 800 approved and unpaid: more than 10% over the budget to date (12 000 × the share of the year gone).
        Assert.Equal((9_000m, 800m), (garden.GetProperty("actual").GetDecimal(), garden.GetProperty("committed").GetDecimal()));
        Assert.Equal(80_000m, Line(v, "Levies").GetProperty("actual").GetDecimal());
        Assert.Equal(80_000m, Line(v, "Levies").GetProperty("toDate").GetDecimal());
        Assert.Contains("Garden services", v.GetProperty("overspent").EnumerateArray().Select(x => x.GetString()));
        Assert.Equal(JsonValueKind.Null, Line(v, "Insurance").GetProperty("actual").ValueKind);

        // The owners' approval, recorded by hand: a passkey, then the figures are fixed.
        var approval = new { type = "record-approval", approvedOn = "2026-03-20", resolutionRef = "AGM 2026 resolution 4" };
        Assert.Equal("step-up-required", await (await Act(s.Admin, id, approval)).ProblemCode());
        await s.Admin.StepUp();
        Assert.True((await (await Act(s.Admin, id, new { type = "record-approval", approvedOn = "2026-12-01", resolutionRef = "AGM" })).FieldErrors()).TryGetProperty("approvedOn", out _));
        await NoContent(await Act(s.Admin, id, approval));
        v = await View(s.Admin, id);
        Assert.Equal(("approved", "AGM 2026 resolution 4"), (v.GetProperty("budget").GetProperty("status").GetString(), v.GetProperty("budget").GetProperty("approved").GetProperty("resolutionRef").GetString()));
        Assert.True((await (await Act(s.Admin, id, new { type = "remove-line", category = "Insurance" })).FieldErrors()).TryGetProperty("id", out _));
        Assert.True(await api.Db(db => db.Audit.AnyAsync(e => e.Category == "security" && e.Action.StartsWith("Recorded the owners’ approval"))));
    }

    [Fact]
    public async Task Next_years_draft_starts_from_this_years_and_follows_the_schemes_year_end()
    {
        var s = await Scheme();
        var current = await Id(await New(s.Admin, s.Kc, "current"));
        Assert.Contains("already a 2026/27 budget", (await (await New(s.Admin, s.Kc, "current")).FieldErrors()).GetProperty("schemeId").GetString());
        // The year end is set on the scheme now: asking for another one is refused.
        var other = await New(s.Admin, s.Kc, "next", 7, yearEnd: 6);
        Assert.True(other.StatusCode == HttpStatusCode.UnprocessableEntity, $"{other.StatusCode}: {await other.Content.ReadAsStringAsync()}");
        Assert.True((await other.FieldErrors()).TryGetProperty("financialYearEnd", out _));
        Assert.True((await (await New(s.Admin, s.Kc, "next", 50)).FieldErrors()).TryGetProperty("increasePct", out _));

        var next = await Id(await New(s.Admin, s.Kc, "next", 7, yearEnd: null));
        var v = await View(s.Admin, next);
        Assert.Equal(("2027/28", 0.0), (v.GetProperty("budget").GetProperty("year").GetString(), v.GetProperty("elapsed").GetDouble()));
        Assert.Equal(21_400m, Line(v, "Insurance").GetProperty("line").GetProperty("annual").GetDecimal());
        // Meetings aren't on the API yet.
        Assert.True((await (await Act(s.Admin, next, new { type = "propose", meetingId = "m-1" })).FieldErrors()).TryGetProperty("meetingId", out _));
        // A year that hasn't started has no spending before Humo PM.
        Assert.True((await (await Act(s.Admin, next, new { type = "set-opening", to = "2026-10-01", amounts = new Dictionary<string, decimal>() })).FieldErrors()).TryGetProperty("id", out _));

        var list = await (await s.Admin.GetAsync($"/api/budgets?schemeIds={s.Kc}")).Json();
        Assert.Equal([current.ToString(), next.ToString()], list.EnumerateArray().Select(b => b.GetProperty("budget").GetProperty("id").GetString()).ToList());

        // The year end is a scheme setting.
        Assert.Equal(2, (await (await s.Admin.GetAsync($"/api/settings/compliance-profiles?schemeIds={s.Kc}")).Json())[0].GetProperty("financialYearEnd").GetInt32());
        await NoContent(await s.Admin.PutAsJsonAsync($"/api/settings/compliance-profiles/{s.Kc}", new { financialYearEnd = 6, hasLifts = true }));
        var profile = (await (await s.Admin.GetAsync($"/api/settings/compliance-profiles?schemeIds={s.Kc}")).Json())[0];
        Assert.Equal((6, true), (profile.GetProperty("financialYearEnd").GetInt32(), profile.GetProperty("hasLifts").GetBoolean()));
    }

    [Fact]
    public async Task A_quote_waiting_for_approval_shows_its_budget_line()
    {
        var s = await Scheme();
        var id = await Id(await New(s.Admin, s.Kc, "current"));
        await s.Admin.StepUp();
        await NoContent(await Act(s.Admin, id, new { type = "record-approval", approvedOn = "2026-03-20", resolutionRef = "AGM 2026 resolution 4" }));
        var job = await s.Admin.PostAsJsonAsync("/api/jobs", new { schemeId = s.Kc.ToString(), location = "Block A", title = "Burst pipe", description = "Water", category = "Plumbing", priority = "urgent" });
        Assert.Equal(HttpStatusCode.Created, job.StatusCode);
        var jobId = await api.Db(db => db.Jobs.Select(j => j.Id).SingleAsync());
        await api.Db(async db =>
        {
            db.WorkItems.Add(new WorkItemRow
            {
                Id = Guid.CreateVersion7(), OrganisationId = s.Org, SchemeId = s.Kc, Ref = "MR-1001", Kind = "approval", Type = "quote-approval", Title = "Burst pipe", Detail = "",
                Amount = 9_000, CreatedAt = api.Clock.GetUtcNow(), DueAt = api.Clock.GetUtcNow().AddDays(3), ApproverRoles = "[\"agency-admin\"]", Evidence = "[]", Route = "/", SourceId = jobId,
            });
            return await db.SaveChangesAsync();
        });
        var item = (await (await s.Admin.GetAsync("/api/work-items")).Json()).EnumerateArray().Single(w => w.GetProperty("type").GetString() == "quote-approval");
        Assert.Equal(("Maintenance — plumbing", 4_000m), (item.GetProperty("budget").GetProperty("category").GetString(), item.GetProperty("budget").GetProperty("annual").GetDecimal()));
    }
}
