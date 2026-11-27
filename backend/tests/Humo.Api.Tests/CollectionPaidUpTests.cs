using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Humo.Api.Tests;

/// <summary>D43: collection ends by itself once nothing is overdue; with the attorneys the agency closes it; a quick reversal reopens it.</summary>
public sealed class CollectionPaidUpTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Kc, Guid Account, HttpClient Admin, HttpClient Finance, HttpClient Trustee);

    /// <summary>Kingfisher Court unit 42 (Sipho): R1 800 overdue for 30+ days.</summary>
    private async Task<Setup> Scheme()
    {
        var org = await api.Customer("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        await api.Person("priya@acacia.example", Roles.Finance, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        await api.Person("bongani@trustee.example", Roles.Trustee, org, [kc]);
        var u42 = await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "42", description = "2-bed", sizeM2 = 86, participationQuota = 1.25, monthlyLevy = 1800, occupancy = "owner-occupied" }));
        await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Sipho", lastName = "Khumalo", kind = "individual", email = "sipho@mail.example", phone = "083 551 0274", preferredChannel = "email" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = u42.ToString(), since = "2019-05-01" },
        }));
        var account = await api.Db(db => db.LevyAccounts.Where(a => a.UnitId == u42).Select(a => a.Id).SingleAsync());
        await api.Db(async db =>
        {
            db.Ledger.Add(new LedgerEntry { Id = Guid.CreateVersion7(), AccountId = account, Date = new DateOnly(2026, 9, 1), Type = "levy", Description = "Levy — September", Amount = 1800, CreatedBy = "test" });
            var a = await db.LevyAccounts.SingleAsync(x => x.Id == account);
            (a.Balance, a.AgeingD30, a.Status) = (1800, 1800, "arrears");
            db.TrustAccounts.Add(new TrustAccountRow { SchemeId = kc, Bank = "FNB", AccountName = "Kingfisher Court Body Corporate", AccountNumber = "62345678901", BranchCode = "250655", Verified = true });
            return await db.SaveChangesAsync();
        });
        return new Setup(kc, account, admin, await api.SignedIn("priya@acacia.example"), await api.SignedIn("bongani@trustee.example"));
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private static async Task NoContent(HttpResponseMessage res) =>
        Assert.True(res.StatusCode == HttpStatusCode.NoContent, $"{res.StatusCode}: {await res.Content.ReadAsStringAsync()}");

    private static async Task<JsonElement> Case(HttpClient c, Guid account) => (await (await c.GetAsync($"/api/collections/{account}")).Json()).GetProperty("case");

    private async Task Act(Setup s, object action)
    {
        var version = await api.Db(db => db.CollectionCases.Where(c => c.AccountId == s.Account).Select(c => c.Version).FirstOrDefaultAsync());
        await NoContent(await s.Finance.PostAsJsonAsync($"/api/collections/{s.Account}/actions", new { action, expectedVersion = version }));
    }

    private async Task<HttpResponseMessage> TryAct(Setup s, object action)
    {
        var version = await api.Db(db => db.CollectionCases.Where(c => c.AccountId == s.Account).Select(c => c.Version).FirstOrDefaultAsync());
        return await s.Finance.PostAsJsonAsync($"/api/collections/{s.Account}/actions", new { action, expectedVersion = version });
    }

    /// <summary>A payment captured and allocated to the account.</summary>
    private async Task<Guid> Pay(Setup s, decimal amount)
    {
        var id = await Id(await s.Finance.PostAsJsonAsync("/api/receipts", new { schemeId = s.Kc.ToString(), date = "2026-10-18", amount, reference = "KC042 LEVY" }));
        await NoContent(await s.Finance.PostAsJsonAsync($"/api/receipts/{id}/allocate",
            new { allocations = new[] { new { accountId = s.Account.ToString(), amount } }, rememberPayer = false, expectedVersion = 1 }));
        return id;
    }

    private Task<List<WorkItemRow>> Tasks(Setup s) => api.Db(db => db.WorkItems.Where(w => w.SourceId == s.Account).ToListAsync());

    private static async Task<List<string>> Bell(HttpClient c) =>
        [.. (await (await c.GetAsync("/api/notifications")).Json()).EnumerateArray().Select(n => n.GetProperty("title").GetString()!)];

    [Fact]
    public async Task Paying_off_the_arrears_ends_collection_and_its_task_and_finance_hears_in_the_app()
    {
        var s = await Scheme();
        await Act(s, new { type = "send-letter", kind = "reminder", channel = "post" });
        Assert.Single(await Tasks(s), t => t.Status == "open");

        // Part-paid: still R300 overdue, collection carries on.
        await Pay(s, 1500);
        Assert.Equal("reminder", (await Case(s.Finance, s.Account)).GetProperty("stage").GetString());

        await Pay(s, 300);

        var c = await Case(s.Finance, s.Account);
        Assert.Equal("not-started", c.GetProperty("stage").GetString());
        Assert.Equal("Paid up: nothing is overdue, so collection has ended", c.GetProperty("steps")[0].GetProperty("text").GetString());
        var task = Assert.Single(await Tasks(s));
        Assert.Equal(("done", "Humo credit control"), (task.Status, task.DecidedBy));
        Assert.Contains("Paid up: Unit 42 (Sipho Khumalo)", await Bell(s.Finance));
        Assert.DoesNotContain(api.Email.Sent, m => m.Subject.StartsWith("Paid up", StringComparison.Ordinal));
        Assert.True(await api.Db(db => db.Audit.AnyAsync(a => a.Action.Contains("ended: paid up"))));
        // Off the credit control list: nothing to chase.
        Assert.Equal(0, (await (await s.Finance.GetAsync($"/api/collections?schemeIds={s.Kc}")).Json()).GetProperty("total").GetInt32());
    }

    [Fact]
    public async Task A_letter_of_demand_waiting_for_the_trustees_is_withdrawn_when_it_is_paid()
    {
        var s = await Scheme();
        await Act(s, new { type = "send-letter", kind = "reminder", channel = "post" });
        await Act(s, new { type = "send-letter", kind = "final-demand", channel = "post" });
        await Act(s, new { type = "request-demand-approval" });

        await Pay(s, 1800);

        var approval = Assert.Single(await Tasks(s), t => t.Type == "demand-approval");
        Assert.Equal("withdrawn", approval.Status);
        Assert.False((await Case(s.Finance, s.Account)).TryGetProperty("demandApproval", out var d) && d.ValueKind != JsonValueKind.Null);
    }

    [Fact]
    public async Task With_the_attorneys_the_agency_is_asked_to_tell_them_and_closes_the_case_itself()
    {
        var s = await Scheme();
        await Act(s, new { type = "send-letter", kind = "reminder", channel = "post" });
        await Act(s, new { type = "send-letter", kind = "final-demand", channel = "post" });
        await Act(s, new { type = "request-demand-approval" });
        var approval = Assert.Single(await Tasks(s), t => t.Type == "demand-approval");
        await NoContent(await s.Trustee.PostAsJsonAsync($"/api/work-items/{approval.Id}/decision", new { decision = "approved" }));
        await Act(s, new { type = "send-letter", kind = "letter-of-demand", channel = "post" });
        await Act(s, new { type = "hand-over", attorney = "Botha & Partners" });

        await Pay(s, 1800);

        Assert.Equal("handed-over", (await Case(s.Finance, s.Account)).GetProperty("stage").GetString());
        var tell = Assert.Single(await Tasks(s), t => t.Status == "open");
        Assert.Equal("Unit 42 (Sipho Khumalo) is paid up: tell Botha & Partners, then close the case", tell.Title);

        Assert.True((await (await TryAct(s, new { type = "close", reason = "ok" })).FieldErrors()).TryGetProperty("reason", out _));
        await Act(s, new { type = "close", reason = "Botha & Partners told on 19 Oct; no costs owed" });

        var c = await Case(s.Finance, s.Account);
        Assert.Equal("not-started", c.GetProperty("stage").GetString());
        Assert.Equal("Closed: Botha & Partners told on 19 Oct; no costs owed", c.GetProperty("steps")[0].GetProperty("text").GetString());
        Assert.Equal("done", (await Tasks(s)).Single(t => t.Id == tell.Id).Status);
        Assert.Equal("up-to-date", await api.Db(db => db.LevyAccounts.Where(a => a.Id == s.Account).Select(a => a.Status).SingleAsync()));
    }

    [Fact]
    public async Task A_case_with_arrears_cant_be_closed_by_hand()
    {
        var s = await Scheme();
        await Act(s, new { type = "send-letter", kind = "reminder", channel = "post" });

        var refused = await (await TryAct(s, new { type = "close", reason = "Owner promised to pay" })).FieldErrors();

        Assert.Contains("still overdue", refused.GetProperty("stage").GetString());
    }

    [Fact]
    public async Task A_payment_reversed_soon_after_reopens_collection_where_it_was()
    {
        var s = await Scheme();
        await Act(s, new { type = "send-letter", kind = "reminder", channel = "post" });
        await Act(s, new { type = "send-letter", kind = "final-demand", channel = "post" });
        var receipt = await Pay(s, 1800);
        Assert.Equal("not-started", (await Case(s.Finance, s.Account)).GetProperty("stage").GetString());

        var version = await api.Db(db => db.Receipts.Where(r => r.Id == receipt).Select(r => r.Version).SingleAsync());
        await NoContent(await s.Finance.PostAsJsonAsync($"/api/receipts/{receipt}/reverse", new { reason = "returned", note = "Bounced", expectedVersion = version }));

        var c = await Case(s.Finance, s.Account);
        Assert.Equal("final-demand", c.GetProperty("stage").GetString());
        Assert.StartsWith("Reopened: a payment that cleared it was reversed", c.GetProperty("steps")[0].GetProperty("text").GetString());
        Assert.Single(await Tasks(s), t => t.Status == "open" && t.Type == "debtor-follow-up");
    }

    [Fact]
    public async Task The_daily_check_ends_a_case_that_was_paid_before_this_rule()
    {
        var s = await Scheme();
        await Act(s, new { type = "send-letter", kind = "reminder", channel = "post" });
        // Paid off without the rule (as happened before D43): the account is clear but the case and its task still run.
        await api.Db(async db =>
        {
            db.Ledger.Add(new LedgerEntry { Id = Guid.CreateVersion7(), AccountId = s.Account, Date = new DateOnly(2026, 10, 18), Type = "payment", Description = "Payment", Amount = -1800, CreatedBy = "test" });
            var a = await db.LevyAccounts.SingleAsync(x => x.Id == s.Account);
            (a.Balance, a.AgeingD30, a.Status) = (0, 0, "up-to-date");
            return await db.SaveChangesAsync();
        });

        using var scope = api.Services.CreateScope();
        var ended = await scope.ServiceProvider.GetRequiredService<Humo.Api.Finance.CreditControl>().SettleAllAsync(CancellationToken.None);

        Assert.Equal(1, ended);
        Assert.Equal("not-started", (await Case(s.Finance, s.Account)).GetProperty("stage").GetString());
        Assert.All(await Tasks(s), t => Assert.Equal("done", t.Status));
    }
}
