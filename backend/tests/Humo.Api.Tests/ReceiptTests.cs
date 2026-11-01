using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Levy accounts and receipts on the API (slice 2a; docs/11 §3, docs/22 §1).</summary>
public sealed class ReceiptTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Org, Guid Kc, Guid Unit42, Guid Unit12, Guid Account42, Guid Account12, HttpClient Finance);

    /// <summary>Kingfisher Court with units 42 (Sipho Khumalo, R1 850) and 12 (R2 400); Priya in Finance.</summary>
    private async Task<Setup> Scheme(string package = "professional")
    {
        var org = await api.Customer("Acacia", package);
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
        return new Setup(org, kc, u42, u12, accounts[u42], accounts[u12], await api.SignedIn("priya@acacia.example"));
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

    /// <summary>Levies charged straight to the ledger (the billing run arrives in slice 2b).</summary>
    private Task Charge(Guid account, int daysAgo, decimal amount) => api.Db(async db =>
    {
        db.Ledger.Add(new LedgerEntry { Id = Guid.CreateVersion7(), AccountId = account, Date = new DateOnly(2026, 10, 19).AddDays(-daysAgo), Type = "levy", Description = "Levy", Amount = amount, CreatedBy = "test" });
        return await db.SaveChangesAsync();
    });

    private static string Day(int offset) => new DateOnly(2026, 10, 19).AddDays(offset).ToString("dd/MM/yyyy");

    private static readonly object Mapping = new { date = "Date", dateFormat = "dd/mm/yyyy", amount = "Amount", reference = "Description", payer = "Name" };

    private static string Csv() => string.Join("\n",
        "Date,Description,Name,Amount",
        $"{Day(-2)},KC042 LEVY,S KHUMALO,\"1,850.00\"",
        $"{Day(-2)},KC042 LEVY,S KHUMALO,\"1,850.00\"",
        $"{Day(-1)},UNIT 12 OCT,P NAIDOO,2400.00",
        $"{Day(-1)},BANK CHARGES,,-35.00",
        "not a date,ODD ROW,,100.00");

    [Fact]
    public async Task Captures_a_receipt_unallocated_and_refuses_duplicates_bad_dates_and_zero()
    {
        var s = await Scheme();
        var body = new { schemeId = s.Kc.ToString(), date = "2026-10-18", amount = 1500, reference = "KC007 OCT" };
        await Id(await s.Finance.PostAsJsonAsync("/api/receipts", body));
        var r = await api.Db(db => db.Receipts.SingleAsync());
        Assert.Equal(("unallocated", "captured", "priya", 1500m), (r.Status, r.Source, r.CapturedBy, r.Amount));
        Assert.Equal("This receipt is already captured (same date, amount and reference).",
            (await (await s.Finance.PostAsJsonAsync("/api/receipts", body with { reference = "kc007 oct" })).FieldErrors()).GetProperty("reference").GetString());
        Assert.True((await (await s.Finance.PostAsJsonAsync("/api/receipts", body with { date = "2026-10-21" })).FieldErrors()).TryGetProperty("date", out _));
        Assert.True((await (await s.Finance.PostAsJsonAsync("/api/receipts", body with { date = "2025-09-01" })).FieldErrors()).TryGetProperty("date", out _));
        Assert.True((await (await s.Finance.PostAsJsonAsync("/api/receipts", body with { amount = 0 })).FieldErrors()).TryGetProperty("amount", out _));
    }

    [Fact]
    public async Task Previews_and_imports_a_bank_statement_remembering_the_mapping_and_skipping_duplicates()
    {
        var s = await Scheme();
        var preview = await Ok(await s.Finance.PostAsJsonAsync($"/api/schemes/{s.Kc}/statements/preview", new { fileName = "oct.csv", csv = Csv(), mapping = Mapping }));
        Assert.Equal(["KC042 LEVY", "UNIT 12 OCT"], preview.GetProperty("receipts").EnumerateArray().Select(l => l.GetProperty("reference").GetString()));
        Assert.Equal((1, 1, 1, 4250m), (preview.GetProperty("duplicates").GetArrayLength(), preview.GetProperty("debits").GetInt32(), preview.GetProperty("invalid").GetArrayLength(), preview.GetProperty("total").GetDecimal()));
        Assert.Equal(0, await api.Db(db => db.Receipts.CountAsync()));

        var result = await Ok(await s.Finance.PostAsJsonAsync($"/api/schemes/{s.Kc}/statements/import", new { fileName = "oct.csv", csv = Csv(), mapping = Mapping }));
        Assert.Equal(2, result.GetProperty("imported").GetInt32());
        Assert.True(await api.Db(db => db.Receipts.AllAsync(r => r.Status == "unallocated" && r.Source == "statement-import")));
        Assert.Equal("Description", (await Ok(await s.Finance.GetAsync($"/api/schemes/{s.Kc}/statement-mapping"))).GetProperty("reference").GetString());
        Assert.Equal("oct.csv", (await Ok(await s.Finance.GetAsync("/api/statement-imports")))[0].GetProperty("fileName").GetString());

        var again = await Ok(await s.Finance.PostAsJsonAsync($"/api/schemes/{s.Kc}/statements/import", new { fileName = "oct.csv", csv = Csv(), mapping = Mapping }));
        Assert.Equal((0, 3), (again.GetProperty("imported").GetInt32(), again.GetProperty("duplicates").GetInt32()));
        Assert.True((await (await s.Finance.PostAsJsonAsync($"/api/schemes/{s.Kc}/statements/preview", new { fileName = "x.csv", csv = Csv(), mapping = new { date = "Posting date", dateFormat = "dd/mm/yyyy", amount = "Amount", reference = "Description" } })).FieldErrors()).TryGetProperty("date", out _));
    }

    [Fact]
    public async Task Matches_with_reasons_allocates_across_accounts_and_the_ledger_ages_what_is_left()
    {
        var s = await Scheme();
        await Charge(s.Account42, 75, 1850);
        await Charge(s.Account42, 45, 1850);
        await Charge(s.Account42, 15, 1850);
        await Charge(s.Account12, 15, 2400);
        await Id(await s.Finance.PostAsJsonAsync("/api/receipts", new { schemeId = s.Kc.ToString(), date = "2026-10-18", amount = 3000, reference = "KC042 AND 12", payer = "S KHUMALO" }));
        var receipt = await api.Db(db => db.Receipts.SingleAsync());

        var matches = await Ok(await s.Finance.GetAsync($"/api/receipts/{receipt.Id}/matches"));
        Assert.Equal(s.Account42.ToString(), matches[0].GetProperty("accountId").GetString());
        Assert.Contains("Payer name matches owner Sipho Khumalo", matches[0].GetProperty("reasons").EnumerateArray().Select(r => r.GetString()));

        var wrongTotal = await s.Finance.PostAsJsonAsync($"/api/receipts/{receipt.Id}/allocate", new { allocations = new[] { new { accountId = s.Account42.ToString(), amount = 100 } }, rememberPayer = false, expectedVersion = 1 });
        Assert.True((await wrongTotal.FieldErrors()).TryGetProperty("allocations", out _));
        var split = new[] { new { accountId = s.Account42.ToString(), amount = 2000m }, new { accountId = s.Account12.ToString(), amount = 1000m } };
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.PostAsJsonAsync($"/api/receipts/{receipt.Id}/allocate", new { allocations = split, rememberPayer = false, expectedVersion = 1 })).StatusCode);

        // 42: R5 550 charged, R2 000 paid → the oldest charge is settled and R150 of the 45-day one.
        var detail = await Ok(await s.Finance.GetAsync($"/api/accounts/{s.Account42}"));
        var account = detail.GetProperty("account");
        Assert.Equal(3550m, account.GetProperty("balance").GetDecimal());
        Assert.Equal((1850m, 1700m, 0m), (account.GetProperty("ageing").GetProperty("current").GetDecimal(), account.GetProperty("ageing").GetProperty("d30").GetDecimal(), account.GetProperty("ageing").GetProperty("d60").GetDecimal()));
        Assert.Equal("arrears", account.GetProperty("status").GetString());
        Assert.Equal(("payment", -2000m, 3550m), (detail.GetProperty("transactions")[0].GetProperty("type").GetString(), detail.GetProperty("transactions")[0].GetProperty("amount").GetDecimal(), detail.GetProperty("transactions")[0].GetProperty("balance").GetDecimal()));
        Assert.Equal(1400m, await api.Db(db => db.LevyAccounts.Where(a => a.Id == s.Account12).Select(a => a.Balance).SingleAsync()));

        // Reversed: the payment lines come off and the balances go back.
        Assert.Equal(HttpStatusCode.Conflict, (await s.Finance.PostAsJsonAsync($"/api/receipts/{receipt.Id}/unallocate", new { expectedVersion = 1 })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.PostAsJsonAsync($"/api/receipts/{receipt.Id}/unallocate", new { expectedVersion = 2 })).StatusCode);
        Assert.Equal(5550m, await api.Db(db => db.LevyAccounts.Where(a => a.Id == s.Account42).Select(a => a.Balance).SingleAsync()));
        Assert.Equal(0, await api.Db(db => db.Ledger.CountAsync(e => e.Type == "payment")));
    }

    [Fact]
    public async Task Remembers_a_payer_and_removes_only_an_unallocated_receipt()
    {
        var s = await Scheme();
        await Id(await s.Finance.PostAsJsonAsync("/api/receipts", new { schemeId = s.Kc.ToString(), date = "2026-10-18", amount = 999, reference = "MONTHLY", payer = "ACME PROPS" }));
        var r = await api.Db(db => db.Receipts.SingleAsync());
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.PostAsJsonAsync($"/api/receipts/{r.Id}/allocate", new { allocations = new[] { new { accountId = s.Account12.ToString(), amount = 999 } }, rememberPayer = true })).StatusCode);
        Assert.True((await (await s.Finance.PostAsJsonAsync($"/api/receipts/{r.Id}/remove", new { reason = "Should not be possible" })).FieldErrors()).TryGetProperty("status", out _));

        await Id(await s.Finance.PostAsJsonAsync("/api/receipts", new { schemeId = s.Kc.ToString(), date = "2026-10-19", amount = 999, reference = "MONTHLY NOV", payer = "ACME PROPS" }));
        var next = await api.Db(db => db.Receipts.SingleAsync(x => x.Reference == "MONTHLY NOV"));
        var matches = await Ok(await s.Finance.GetAsync($"/api/receipts/{next.Id}/matches"));
        Assert.Equal((s.Account12.ToString(), "Remembered payer rule “ACME PROPS”"), (matches[0].GetProperty("accountId").GetString(), matches[0].GetProperty("reasons")[0].GetString()));
        Assert.Single((await Ok(await s.Finance.GetAsync($"/api/accounts/{s.Account12}/suggested-receipts"))).EnumerateArray());

        Assert.True((await (await s.Finance.PostAsJsonAsync($"/api/receipts/{next.Id}/remove", new { reason = "no" })).FieldErrors()).TryGetProperty("reason", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.PostAsJsonAsync($"/api/receipts/{next.Id}/remove", new { reason = "Captured twice by mistake" })).StatusCode);
        Assert.Contains(await api.Db(db => db.Audit.Select(a => a.Action).ToListAsync()), a => a.Contains("Captured twice by mistake"));
    }

    [Fact]
    public async Task Journal_adjustments_need_Billing_Run_a_reason_and_stay_under_the_cap()
    {
        var s = await Scheme();
        await api.Person("lerato@acacia.example", Roles.Operations, s.Org);
        var ops = await api.SignedIn("lerato@acacia.example");
        Assert.Equal(HttpStatusCode.NotFound, (await ops.PostAsJsonAsync($"/api/accounts/{s.Account42}/adjustments", new { amount = -100, reason = "Goodwill credit" })).StatusCode);
        Assert.True((await (await s.Finance.PostAsJsonAsync($"/api/accounts/{s.Account42}/adjustments", new { amount = 150_000, reason = "Big fix" })).FieldErrors()).TryGetProperty("amount", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.PostAsJsonAsync($"/api/accounts/{s.Account42}/adjustments", new { amount = -100, reason = "Goodwill credit" })).StatusCode);
        var t = (await Ok(await s.Finance.GetAsync($"/api/accounts/{s.Account42}"))).GetProperty("transactions")[0];
        Assert.Equal(("adjustment", -100m, "Adjustment — Goodwill credit"), (t.GetProperty("type").GetString(), t.GetProperty("amount").GetDecimal(), t.GetProperty("description").GetString()));
    }

    [Fact]
    public async Task Receipts_need_payment_allocation_in_the_plan_and_stay_within_the_person_s_schemes()
    {
        var s = await Scheme("essentials");
        var body = new { schemeId = s.Kc.ToString(), date = "2026-10-18", amount = 100, reference = "KC042" };
        Assert.Equal("not-entitled", await (await s.Finance.PostAsJsonAsync("/api/receipts", body)).ProblemCode());

        var other = await api.Customer("Fynbos", "professional");
        await api.Person("pieter@fynbos.example", Roles.Finance, other);
        var fynbos = await api.SignedIn("pieter@fynbos.example");
        Assert.True((await (await fynbos.PostAsJsonAsync("/api/receipts", body)).FieldErrors()).TryGetProperty("schemeId", out _));
        Assert.Equal(HttpStatusCode.NotFound, (await fynbos.GetAsync($"/api/accounts/{s.Account42}")).StatusCode);
    }

    // ---- Reversing a payment (docs/22 §1): reverse, never delete; a reason, always.

    private async Task<Guid> Allocated(Setup s, Guid account, decimal amount, string reference = "KC042 LEVY")
    {
        var id = await Id(await s.Finance.PostAsJsonAsync("/api/receipts", new { schemeId = s.Kc.ToString(), date = "2026-10-18", amount, reference }));
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.PostAsJsonAsync($"/api/receipts/{id}/allocate",
            new { allocations = new[] { new { accountId = account.ToString(), amount } }, rememberPayer = false, expectedVersion = 1 })).StatusCode);
        return id;
    }

    private Task<int> Version(Guid receipt) => api.Db(db => db.Receipts.Where(r => r.Id == receipt).Select(r => r.Version).SingleAsync());

    [Fact]
    public async Task A_payment_on_the_wrong_account_is_reversed_and_moved_in_one_step_and_the_history_stays()
    {
        var s = await Scheme();
        await Charge(s.Account42, 100, 1850);
        await Charge(s.Account12, 70, 2400);
        // Sipho's payment, allocated to unit 12 by mistake.
        var receipt = await Allocated(s, s.Account12, 1850);
        var version = await Version(receipt);

        // Moving needs the wrong-account reason, and an account other than the one it's on.
        Assert.True((await (await s.Finance.PostAsJsonAsync($"/api/receipts/{receipt}/reverse", new { reason = "wrong-amount", moveToAccountId = s.Account42.ToString(), expectedVersion = version })).FieldErrors()).TryGetProperty("moveToAccountId", out _));
        Assert.True((await (await s.Finance.PostAsJsonAsync($"/api/receipts/{receipt}/reverse", new { reason = "wrong-account", moveToAccountId = s.Account12.ToString(), expectedVersion = version })).FieldErrors()).TryGetProperty("moveToAccountId", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.PostAsJsonAsync($"/api/receipts/{receipt}/reverse",
            new { reason = "wrong-account", note = "Reference was KC042", moveToAccountId = s.Account42.ToString(), expectedVersion = version })).StatusCode);

        var accounts = await api.Db(db => db.LevyAccounts.ToDictionaryAsync(a => a.Id));
        // Unit 12 owes its levy again, aged from when it was raised (60 days), not as a new charge today.
        Assert.Equal((2400m, 2400m, 0m), (accounts[s.Account12].Balance, accounts[s.Account12].AgeingD60, accounts[s.Account12].AgeingCurrent));
        Assert.Equal(0m, accounts[s.Account42].Balance);
        // Nothing deleted: the payment and its reversal on 12, the payment on 42.
        var lines = await api.Db(db => db.Ledger.Where(e => e.ReceiptId == receipt).Select(e => new { e.AccountId, e.Type, e.Amount, e.Description, e.CreatedAt }).ToListAsync());
        lines = [.. lines.OrderBy(l => l.CreatedAt)];
        Assert.Equal([(s.Account12, "payment", -1850m), (s.Account12, "reversal", 1850m), (s.Account42, "payment", -1850m)], lines.Select(l => (l.AccountId, l.Type, l.Amount)).ToList());
        Assert.Contains("allocated to the wrong account: Reference was KC042", lines[1].Description);
        var r = await api.Db(db => db.Receipts.Include(x => x.Allocations).SingleAsync(x => x.Id == receipt));
        Assert.Equal(("allocated", s.Account42), (r.Status, Assert.Single(r.Allocations).AccountId));
        Assert.True(await api.Db(db => db.Audit.AnyAsync(e => e.Action.Contains("allocated to the wrong account"))));
    }

    [Fact]
    public async Task Undo_is_only_for_a_payment_no_statement_shows_and_a_reversal_needs_a_reason_and_tells_the_owner()
    {
        var s = await Scheme();
        await Charge(s.Account42, 10, 1850);
        // Before any statement: the quick undo takes it off as if never posted.
        var quick = await Allocated(s, s.Account42, 1850);
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.PostAsJsonAsync($"/api/receipts/{quick}/unallocate", new { expectedVersion = await Version(quick) })).StatusCode);
        Assert.Equal(0, await api.Db(db => db.Ledger.CountAsync(e => e.ReceiptId == quick)));

        // Sipho signs in.
        var sipho = await api.Db(async db =>
        {
            var person = await db.People.SingleAsync(p => p.Email == "sipho@mail.example");
            var u = new HumoUser { Id = Guid.CreateVersion7(), UserName = "sipho@mail.example", Email = "sipho@mail.example", NormalizedEmail = "SIPHO@MAIL.EXAMPLE", Name = "Sipho Khumalo",
                Kind = IdentityKinds.Customer, Status = IdentityStatuses.Active, PersonId = person.Id.ToString() };
            db.Users.Add(u);
            await db.SaveChangesAsync();
            return u.Id;
        });
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.PostAsJsonAsync($"/api/receipts/{quick}/allocate",
            new { allocations = new[] { new { accountId = s.Account42.ToString(), amount = 1850 } }, rememberPayer = false, expectedVersion = await Version(quick) })).StatusCode);
        // October's statement has gone out: undo is refused, reversing with a reason isn't.
        await api.Db(async db =>
        {
            db.IssuedStatements.Add(new IssuedStatement { Id = Guid.CreateVersion7(), AccountId = s.Account42, SchemeId = s.Kc, OrganisationId = s.Org, Period = "2026-10", Snapshot = "{}", IssuedAt = DateTimeOffset.UtcNow, IssuedBy = "test" });
            return await db.SaveChangesAsync();
        });
        Assert.Contains("reverse it with a reason", (await (await s.Finance.PostAsJsonAsync($"/api/receipts/{quick}/unallocate", new { expectedVersion = await Version(quick) })).FieldErrors()).GetProperty("receiptId").GetString());
        Assert.True((await (await s.Finance.PostAsJsonAsync($"/api/receipts/{quick}/reverse", new { reason = "", expectedVersion = await Version(quick) })).FieldErrors()).TryGetProperty("reason", out _));
        Assert.True((await (await s.Finance.PostAsJsonAsync($"/api/receipts/{quick}/reverse", new { reason = "other", expectedVersion = await Version(quick) })).FieldErrors()).TryGetProperty("note", out _));
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.PostAsJsonAsync($"/api/receipts/{quick}/reverse", new { reason = "returned", expectedVersion = await Version(quick) })).StatusCode);
        Assert.Equal("unallocated", await api.Db(db => db.Receipts.Where(r => r.Id == quick).Select(r => r.Status).SingleAsync()));
        Assert.Equal(1850m, await api.Db(db => db.LevyAccounts.Where(a => a.Id == s.Account42).Select(a => a.Balance).SingleAsync()));
        var notice = await api.Db(db => db.Notices.SingleAsync(n => n.ToIdentityId == sipho));
        Assert.Contains("returned unpaid by the bank", notice.Detail);

        // A Payfast payment was confirmed against its account: neither undo nor reverse.
        await api.Db(async db => { (await db.Receipts.SingleAsync(r => r.Id == quick)).Source = "payfast"; return await db.SaveChangesAsync(); });
        Assert.Equal(HttpStatusCode.NoContent, (await s.Finance.PostAsJsonAsync($"/api/receipts/{quick}/allocate",
            new { allocations = new[] { new { accountId = s.Account42.ToString(), amount = 1850 } }, rememberPayer = false, expectedVersion = await Version(quick) })).StatusCode);
        Assert.Contains("Payfast", (await (await s.Finance.PostAsJsonAsync($"/api/receipts/{quick}/reverse", new { reason = "wrong-amount", expectedVersion = await Version(quick) })).FieldErrors()).GetProperty("receiptId").GetString());
    }
}
