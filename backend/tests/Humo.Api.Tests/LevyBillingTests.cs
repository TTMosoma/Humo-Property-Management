using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Levy billing runs, approvals in My work, and water meter readings on the API (slice 2b; docs/11 §1, docs/22 §2).</summary>
public sealed class LevyBillingTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Kc, Guid Account42, Guid Account12, HttpClient Admin, HttpClient Finance);

    /// <summary>Kingfisher Court: unit 42 (Sipho Khumalo, R1 850) and unit 12 (no owner yet, R2 400). Thandeka is the agency administrator, Priya is finance.</summary>
    private async Task<Setup> Scheme()
    {
        var org = await api.Customer("Acacia", "professional");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        await api.Person("priya@acacia.example", Roles.Finance, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        var u42 = await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "42", description = "2-bed", sizeM2 = 86, participationQuota = 1.25, monthlyLevy = 1850, occupancy = "owner-occupied" }));
        var u12 = await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "12", description = "3-bed", sizeM2 = 120, participationQuota = 2, monthlyLevy = 2400, occupancy = "owner-occupied" }));
        await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Sipho", lastName = "Khumalo", kind = "individual", email = "sipho@mail.example", phone = "083 551 0274", preferredChannel = "email" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = u42.ToString(), since = "2019-05-01" },
        }));
        var accounts = await api.Db(db => db.LevyAccounts.ToDictionaryAsync(a => a.UnitId, a => a.Id));
        return new Setup(kc, accounts[u42], accounts[u12], admin, await api.SignedIn("priya@acacia.example"));
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.OK, await res.Content.ReadAsStringAsync());
        return await res.Json();
    }

    private static Task<HttpResponseMessage> Act(HttpClient c, Guid run, object action, int version) => c.PostAsJsonAsync($"/api/billing/runs/{run}/actions", new { action, expectedVersion = version });

    private static async Task<JsonElement> Run(HttpClient c, Guid id) => (await Ok(await c.GetAsync($"/api/billing/runs/{id}"))).GetProperty("run");

    /// <summary>A levy charged 45 days ago, so it's 30 days overdue when the run is prepared.</summary>
    private Task Overdue(Guid account, decimal amount) => api.Db(async db =>
    {
        db.Ledger.Add(new LedgerEntry { Id = Guid.CreateVersion7(), AccountId = account, Date = new DateOnly(2026, 9, 1), Type = "levy", Description = "Levy — September", Amount = amount, CreatedBy = "test" });
        var a = await db.LevyAccounts.SingleAsync(x => x.Id == account);
        a.Balance = amount;
        a.AgeingD30 = amount;
        a.Status = "arrears";
        return await db.SaveChangesAsync();
    });

    [Fact]
    public async Task Prepare_decide_approve_by_someone_else_post_and_lock()
    {
        var s = await Scheme();
        await Overdue(s.Account42, 1800);
        var status = await Ok(await s.Finance.GetAsync("/api/billing/status"));
        Assert.Equal(("2026-11", 4250m), (status[0].GetProperty("nextPeriod").GetString(), status[0].GetProperty("levyRoll").GetDecimal()));
        Assert.True((await (await s.Finance.PostAsJsonAsync("/api/billing/runs", new { schemeId = s.Kc.ToString(), period = "2026-12" })).FieldErrors()).TryGetProperty("period", out _));

        var id = await Id(await s.Finance.PostAsJsonAsync("/api/billing/runs", new { schemeId = s.Kc.ToString(), period = "2026-11" }));
        var run = await Run(s.Finance, id);
        Assert.Equal("BR-KC-2611", run.GetProperty("ref").GetString());
        var line42 = run.GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("unitNumber").GetString() == "42");
        // Levy R1 850, the levy changed from R1 800, and 2% interest on the R1 800 overdue.
        Assert.Equal([("levy", 1850m), ("interest", 36m)], line42.GetProperty("charges").EnumerateArray().Select(c => (c.GetProperty("kind").GetString()!, c.GetProperty("amount").GetDecimal())));
        var exceptions = run.GetProperty("exceptions").EnumerateArray().ToList();
        Assert.Equal(["levy-changed", "no-holder"], exceptions.Select(e => e.GetProperty("kind").GetString()).Order());
        Assert.True((await (await Act(s.Finance, id, new { type = "send-for-approval" }, 1)).FieldErrors()).TryGetProperty("exceptions", out _));
        Assert.True((await (await s.Finance.PostAsJsonAsync("/api/billing/runs", new { schemeId = s.Kc.ToString(), period = "2026-11" })).FieldErrors()).TryGetProperty("schemeId", out _));

        var v = 1;
        foreach (var e in exceptions)
            Assert.Equal(HttpStatusCode.NoContent, (await Act(s.Finance, id, new { type = "decide", exceptionId = e.GetProperty("id").GetString(), decision = e.GetProperty("options")[0].GetString() }, v++)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Act(s.Finance, id, new { type = "send-for-approval" }, v++)).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await Act(s.Finance, id, new { type = "post" }, v)).StatusCode);

        // In Approvals: for agency administrators and finance, but never the person who prepared it.
        var work = await Ok(await s.Admin.GetAsync("/api/work-items"));
        var approval = Assert.Single(work.EnumerateArray());
        Assert.Equal(("billing-run-approval", 1886m), (approval.GetProperty("type").GetString(), approval.GetProperty("amount").GetDecimal()));
        var approvalId = approval.GetProperty("id").GetString();
        Assert.Equal("conflict-of-interest", await (await s.Finance.PostAsJsonAsync($"/api/work-items/{approvalId}/decision", new { decision = "approved" })).ProblemCode());
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/work-items/{approvalId}/decision", new { decision = "approved", comment = "Checked against last month" })).StatusCode);
        Assert.Equal("approved", (await Run(s.Finance, id)).GetProperty("stage").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await Act(s.Finance, id, new { type = "post" }, v + 1)).StatusCode);
        var posted = await Run(s.Finance, id);
        Assert.Equal(("posted", 1886m), (posted.GetProperty("stage").GetString(), posted.GetProperty("posted").GetProperty("total").GetDecimal()));
        var ledger = await api.Db(db => db.Ledger.Where(e => e.Reference == "BR-KC-2611").ToListAsync());
        Assert.All(ledger, e => Assert.Equal(new DateOnly(2026, 11, 1), e.Date));
        Assert.Equal(3686m, await api.Db(db => db.LevyAccounts.Where(a => a.Id == s.Account42).Select(a => a.Balance).SingleAsync()));
        // Unit 12 has no owner: left out of the run.
        Assert.DoesNotContain(ledger, e => e.AccountId == s.Account12);

        // Locked: no more decisions or cancelling; the next period can be prepared.
        Assert.True((await (await Act(s.Finance, id, new { type = "cancel", reason = "Changed our minds" }, v + 2)).FieldErrors()).TryGetProperty("stage", out _));
        Assert.Equal("2026-12", (await Ok(await s.Finance.GetAsync("/api/billing/status")))[0].GetProperty("nextPeriod").GetString());
    }

    [Fact]
    public async Task Rejecting_sends_the_run_back_to_preparing_and_large_approvals_need_a_passkey()
    {
        var s = await Scheme();
        await api.Db(async db => { (await db.Organisations.SingleAsync()).ApprovalStepUpAmount = 1000; return await db.SaveChangesAsync(); });
        var id = await Id(await s.Finance.PostAsJsonAsync("/api/billing/runs", new { schemeId = s.Kc.ToString(), period = "2026-11" }));
        var no = (await Run(s.Finance, id)).GetProperty("exceptions")[0].GetProperty("id").GetString();
        await Act(s.Finance, id, new { type = "decide", exceptionId = no, decision = "exclude" }, 1);
        await Act(s.Finance, id, new { type = "send-for-approval" }, 2);
        var approvalId = (await Ok(await s.Admin.GetAsync("/api/work-items")))[0].GetProperty("id").GetString();

        Assert.Equal("step-up-required", await (await s.Admin.PostAsJsonAsync($"/api/work-items/{approvalId}/decision", new { decision = "approved" })).ProblemCode());
        Assert.True((await (await s.Admin.PostAsJsonAsync($"/api/work-items/{approvalId}/decision", new { decision = "rejected" })).FieldErrors()).TryGetProperty("comment", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.PostAsJsonAsync($"/api/work-items/{approvalId}/decision", new { decision = "rejected", comment = "Unit 12's owner moved in on the 1st" })).StatusCode);
        var run = await Run(s.Finance, id);
        Assert.Equal("preview", run.GetProperty("stage").GetString());
        Assert.Contains("Sent back by thandeka", run.GetProperty("events")[0].GetProperty("text").GetString());
        Assert.Equal("Approvals are decided, not completed.", (await (await s.Admin.PostAsJsonAsync("/api/work-items/complete", new { ids = new[] { approvalId } })).FieldErrors()).GetProperty("ids").GetString());
    }

    [Fact]
    public async Task Water_is_billed_from_meter_readings_with_estimates_and_unusual_readings_flagged()
    {
        var s = await Scheme();
        Assert.True((await (await s.Finance.PutAsJsonAsync($"/api/schemes/{s.Kc}/meter-readings/2026-11", new { readOn = "2026-10-18", entries = new[] { new { unitNumber = "42", reading = 100 } } })).FieldErrors()).TryGetProperty("schemeId", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.PutAsJsonAsync($"/api/schemes/{s.Kc}/water-rate", new { ratePerKl = 40, reason = "Municipal tariff for 2026" })).StatusCode);
        // History: both units used about 10 kl a month.
        foreach (var (period, r42, r12) in new[] { ("2026-08", 100m, 500m), ("2026-09", 110m, 510m), ("2026-10", 120m, 520m) })
            Assert.Equal(HttpStatusCode.OK, (await s.Finance.PutAsJsonAsync($"/api/schemes/{s.Kc}/meter-readings/{period}", new { readOn = "2026-10-01", entries = new[] { new { unitNumber = "42", reading = r42 }, new { unitNumber = "12", reading = r12 } } })).StatusCode);
        Assert.True((await (await s.Finance.PutAsJsonAsync($"/api/schemes/{s.Kc}/meter-readings/2026-11", new { readOn = "2026-10-18", entries = new[] { new { unitNumber = "42", reading = 50 } } })).FieldErrors()).TryGetProperty("unit-42", out _));

        var id = await Id(await s.Finance.PostAsJsonAsync("/api/billing/runs", new { schemeId = s.Kc.ToString(), period = "2026-11" }));
        var run = await Run(s.Finance, id);
        Assert.Contains("meter-missing", run.GetProperty("exceptions").EnumerateArray().Select(e => e.GetProperty("kind").GetString()));
        // Unit 42: 165 kl this month against a usual 10 kl: billed, but flagged.
        var saved = await s.Finance.PutAsJsonAsync($"/api/schemes/{s.Kc}/meter-readings/2026-11", new { readOn = "2026-10-18", entries = new[] { new { unitNumber = "42", reading = 285 }, new { unitNumber = "12", reading = 531 } } });
        Assert.Equal(2, await Ok(saved) is var n ? n.GetInt32() : 0);
        run = await Run(s.Finance, id);
        var water42 = run.GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("unitNumber").GetString() == "42").GetProperty("charges").EnumerateArray().Single(c => c.GetProperty("kind").GetString() == "utility");
        Assert.Equal(6600m, water42.GetProperty("amount").GetDecimal());
        var kinds = run.GetProperty("exceptions").EnumerateArray().Select(e => e.GetProperty("kind").GetString()).ToList();
        Assert.Contains("unusual-reading", kinds);
        Assert.DoesNotContain("meter-missing", kinds);
        var sheet = await Ok(await s.Finance.GetAsync($"/api/schemes/{s.Kc}/meter-readings/2026-11"));
        Assert.Equal((2, "preview"), (sheet.GetProperty("captured").GetInt32(), sheet.GetProperty("runStage").GetString()));
    }
}
