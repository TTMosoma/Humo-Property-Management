using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>
/// Supplier payments (slice 3b, D27): bank details verified by a second person, payment batches approved and released by
/// someone other than the preparer, the payment file, and remittances.
/// </summary>
public sealed class PayablesTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Org, Guid Kc, HttpClient Admin, Guid Supplier);

    private async Task<Setup> Agency(bool withFinance = true)
    {
        var org = await api.Customer("Acacia");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        if (withFinance) await api.Person("priya@acacia.example", Roles.Finance, org);
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        var supplier = await Id(await admin.PostAsJsonAsync("/api/suppliers", new
        {
            name = "GreenLeaf Gardens", trades = new[] { "Gardens" }, contactName = "Precious Mabaso", phone = "082 555 0142", email = "accounts@greenleaf.example", schemeIds = new[] { kc.ToString() },
        }));
        return new Setup(org, kc, admin, supplier);
    }

    private static async Task<Guid> Id(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        return Guid.Parse((await res.Json()).GetProperty("id").GetString()!);
    }

    private static async Task NoContent(HttpResponseMessage res) =>
        Assert.True(res.StatusCode == HttpStatusCode.NoContent, $"{res.StatusCode}: {await res.Content.ReadAsStringAsync()}");

    private Task<Guid> Invoice(Setup s, string number, decimal amount) => api.Db(async db =>
    {
        var row = new SupplierInvoiceRow
        {
            Id = Guid.CreateVersion7(), OrganisationId = s.Org, SchemeId = s.Kc, SupplierId = s.Supplier, Number = number, Description = "Monthly garden service", Amount = amount,
            ReceivedAt = api.Clock.GetUtcNow(), DueOn = DateOnly.FromDateTime(api.Clock.GetUtcNow().DateTime).AddDays(30), Status = "approved",
        };
        db.SupplierInvoices.Add(row);
        await db.SaveChangesAsync();
        return row.Id;
    });

    private static Task<HttpResponseMessage> EnterBank(HttpClient c, Guid supplier, string number = "62012345678") =>
        c.PostAsJsonAsync($"/api/suppliers/{supplier}/bank-details", new { bankName = "FNB", branchCode = "250655", accountNumber = number, accountType = "cheque", accountHolder = "GreenLeaf Gardens (Pty) Ltd" });

    private Task<Guid> OpenItem(string type) => api.Db(db => db.WorkItems.Where(w => w.Type == type && w.Status == "open").Select(w => w.Id).SingleAsync());

    private static Task<HttpResponseMessage> Decide(HttpClient c, Guid item, string decision = "approved", string? comment = null) =>
        c.PostAsJsonAsync($"/api/work-items/{item}/decision", new { decision, comment });

    private static Task<HttpResponseMessage> NewBatch(HttpClient c, params Guid[] invoices) =>
        c.PostAsJsonAsync("/api/payables/batches", new { invoiceIds = invoices.Select(i => i.ToString()) });

    private async Task<JsonElement> Batch(HttpClient c, Setup s, Guid id) =>
        (await (await c.GetAsync($"/api/payables/batches?schemeIds={s.Kc}")).Json()).EnumerateArray().Single(b => b.GetProperty("batch").GetProperty("id").GetString() == id.ToString());

    private async Task<HttpResponseMessage> Release(HttpClient c, Setup s, Guid id) =>
        await c.PostAsJsonAsync($"/api/payables/batches/{id}/release", new { expectedVersion = (await Batch(c, s, id)).GetProperty("batch").GetProperty("version").GetInt32() });

    /// <summary>Bank details entered by the admin and verified by finance.</summary>
    private async Task Verified(Setup s, HttpClient finance)
    {
        await s.Admin.StepUp();
        await NoContent(await EnterBank(s.Admin, s.Supplier));
        await finance.StepUp();
        await NoContent(await Decide(finance, await OpenItem("bank-details-verification")));
    }

    [Fact]
    public async Task Bank_details_are_verified_by_someone_else_before_anyone_is_paid()
    {
        var s = await Agency();
        var finance = await api.SignedIn("priya@acacia.example");
        var inv = await Invoice(s, "GL-1001", 3_450);

        // Not verified: nothing can be paid to them.
        Assert.Contains("Bank details aren’t verified for GreenLeaf Gardens", (await (await NewBatch(s.Admin, inv)).FieldErrors()).GetProperty("invoiceIds").GetString());

        // Entering them needs the passkey; then they wait for someone else.
        Assert.Equal("step-up-required", await (await EnterBank(s.Admin, s.Supplier)).ProblemCode());
        await s.Admin.StepUp();
        Assert.True((await (await EnterBank(s.Admin, s.Supplier, "12")).FieldErrors()).TryGetProperty("accountNumber", out _));
        await NoContent(await EnterBank(s.Admin, s.Supplier));
        var sup = (await (await s.Admin.GetAsync($"/api/suppliers/{s.Supplier}")).Json()).GetProperty("supplier");
        Assert.Equal(("FNB ····5678", false, "thandeka"), (sup.GetProperty("bankAccount").GetString(), sup.GetProperty("bankVerified").GetBoolean(),
            sup.GetProperty("bankChange").GetProperty("by").GetString()![..8].ToLowerInvariant()));

        var item = await OpenItem("bank-details-verification");
        Assert.Equal("conflict-of-interest", await (await Decide(s.Admin, item)).ProblemCode());
        // Always the passkey, never an SMS code, whatever the amount.
        Assert.Equal("step-up-required", await (await Decide(finance, item)).ProblemCode());
        await finance.StepUp();
        await NoContent(await Decide(finance, item));
        sup = (await (await s.Admin.GetAsync($"/api/suppliers/{s.Supplier}")).Json()).GetProperty("supplier");
        Assert.True(sup.GetProperty("bankVerified").GetBoolean());

        // A new change holds payments again, and replaces a verification that was still waiting.
        await s.Admin.StepUp();
        await NoContent(await EnterBank(s.Admin, s.Supplier, "62099999999"));
        await NoContent(await EnterBank(s.Admin, s.Supplier, "62088888888"));
        Assert.Equal(1, await api.Db(db => db.WorkItems.CountAsync(w => w.Type == "bank-details-verification" && w.Status == "open")));
        Assert.Contains("Bank details aren’t verified", (await (await NewBatch(s.Admin, inv)).FieldErrors()).GetProperty("invoiceIds").GetString());
    }

    [Fact]
    public async Task A_batch_is_prepared_by_one_person_approved_and_released_by_another_with_the_file_and_remittances()
    {
        var s = await Agency();
        var finance = await api.SignedIn("priya@acacia.example");
        await Verified(s, finance);
        var a = await Invoice(s, "GL-1001", 3_450);
        var b = await Invoice(s, "GL-1002", 1_200.50m);

        var batch = await Id(await NewBatch(s.Admin, a, b));
        var view = await Batch(s.Admin, s, batch);
        Assert.Equal(("PB-KC-0001", "awaiting-approval", 4_650.50m), (view.GetProperty("batch").GetProperty("ref").GetString(), view.GetProperty("batch").GetProperty("status").GetString(),
            view.GetProperty("batch").GetProperty("total").GetDecimal()));
        Assert.Equal("FNB ····5678", view.GetProperty("batch").GetProperty("payees")[0].GetProperty("account").GetString());
        Assert.Equal(2, view.GetProperty("invoices").GetArrayLength());
        Assert.All(await api.Db(db => db.SupplierInvoices.Select(i => i.Status).ToListAsync()), x => Assert.Equal("in-batch", x));
        // An invoice can't be in two batches.
        Assert.True((await (await NewBatch(s.Admin, a)).FieldErrors()).TryGetProperty("invoiceIds", out _));

        // Maker and checker: the preparer neither approves nor releases.
        var item = await OpenItem("payment-batch-approval");
        Assert.Equal("conflict-of-interest", await (await Decide(s.Admin, item)).ProblemCode());
        Assert.True((await (await Release(finance, s, batch)).FieldErrors()).TryGetProperty("status", out _));
        await NoContent(await Decide(finance, item));
        await s.Admin.StepUp();
        Assert.Equal("conflict-of-interest", await (await Release(s.Admin, s, batch)).ProblemCode());

        // Releasing needs a fresh passkey.
        api.Clock.Advance(TimeSpan.FromMinutes(10));
        Assert.Equal("step-up-required", await (await Release(finance, s, batch)).ProblemCode());
        await finance.StepUp();
        var res = await Release(finance, s, batch);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("PB-KC-0001 payments.csv", res.Content.Headers.ContentDisposition?.FileNameStar ?? res.Content.Headers.ContentDisposition?.FileName?.Trim('"'));
        var csv = (await res.Content.ReadAsStringAsync()).TrimStart('﻿').Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal("Beneficiary name,Bank,Branch code,Account number,Account type,Amount,Beneficiary reference,Own reference", csv[0]);
        Assert.Equal("GreenLeaf Gardens (Pty) Ltd,FNB,250655,62012345678,cheque,4650.50,KC PB-KC-0001,PB-KC-0001 GreenLeaf", csv[1].TrimEnd('\r'));

        Assert.All(await api.Db(db => db.SupplierInvoices.Select(i => i.Status).ToListAsync()), x => Assert.Equal("paid", x));
        Assert.Equal("released", (await Batch(finance, s, batch)).GetProperty("batch").GetProperty("status").GetString());
        await HumoApiFactory.Until(() => api.Email.Sent.Any(m => m.To == "accounts@greenleaf.example"));
        var remittance = api.Email.Sent.Single(m => m.To == "accounts@greenleaf.example");
        Assert.StartsWith("Remittance advice: R", remittance.Subject);
        Assert.Contains("Invoice GL-1002", remittance.Text);
        Assert.Equal("released", (await Batch(finance, s, batch)).GetProperty("batch").GetProperty("status").GetString());

        // Once released, it can't be released again; the file can be downloaded again, audited.
        Assert.True((await (await Release(finance, s, batch)).FieldErrors()).TryGetProperty("status", out _));
        Assert.Equal(HttpStatusCode.OK, (await finance.PostAsync($"/api/payables/batches/{batch}/payment-file", null)).StatusCode);
        Assert.True(await api.Db(db => db.Audit.AnyAsync(e => e.Action == "Downloaded the payment file for PB-KC-0001")));
    }

    [Fact]
    public async Task Bank_details_changed_after_a_batch_was_made_stop_its_release_until_it_is_cancelled()
    {
        var s = await Agency();
        var finance = await api.SignedIn("priya@acacia.example");
        await Verified(s, finance);
        var inv = await Invoice(s, "GL-1001", 3_450);
        var batch = await Id(await NewBatch(s.Admin, inv));
        await NoContent(await Decide(finance, await OpenItem("payment-batch-approval")));

        // Someone changes the account, and someone else verifies it: the batch still holds the old one, so it can't go.
        await s.Admin.StepUp();
        await NoContent(await EnterBank(s.Admin, s.Supplier, "62077777777"));
        await finance.StepUp();
        await NoContent(await Decide(finance, await OpenItem("bank-details-verification")));
        Assert.Contains("Bank details changed after this batch was made", (await (await Release(finance, s, batch)).FieldErrors()).GetProperty("status").GetString());

        var version = (await Batch(s.Admin, s, batch)).GetProperty("batch").GetProperty("version").GetInt32();
        await NoContent(await s.Admin.PostAsJsonAsync($"/api/payables/batches/{batch}/cancel", new { reason = "New bank account", expectedVersion = version }));
        Assert.Equal(("approved", (Guid?)null), await api.Db(db => db.SupplierInvoices.Select(i => ValueTuple.Create(i.Status, i.BatchId)).SingleAsync()));
        // Prepared again, it pays the new account.
        var again = await Id(await NewBatch(s.Admin, inv));
        Assert.Equal("FNB ····7777", (await Batch(s.Admin, s, again)).GetProperty("batch").GetProperty("payees")[0].GetProperty("account").GetString());
    }

    [Fact]
    public async Task A_rejected_batch_lets_its_invoices_go()
    {
        var s = await Agency();
        var finance = await api.SignedIn("priya@acacia.example");
        await Verified(s, finance);
        var inv = await Invoice(s, "GL-1001", 3_450);
        var batch = await Id(await NewBatch(s.Admin, inv));
        await NoContent(await Decide(finance, await OpenItem("payment-batch-approval"), "rejected", "Wrong scheme for this invoice"));
        Assert.Equal("rejected", (await Batch(s.Admin, s, batch)).GetProperty("batch").GetProperty("status").GetString());
        Assert.Equal("approved", await api.Db(db => db.SupplierInvoices.Select(i => i.Status).SingleAsync()));
    }

    [Fact]
    public async Task With_one_authoriser_a_trustee_approves_and_the_preparer_releases()
    {
        var s = await Agency(withFinance: false);
        await api.Person("bongani@trustee.example", Roles.Trustee, s.Org, [s.Kc]);
        var trustee = await api.SignedIn("bongani@trustee.example");
        // The only approver entered the bank details: a trustee on Humo verifies them (D24).
        await s.Admin.StepUp();
        await NoContent(await EnterBank(s.Admin, s.Supplier));
        await trustee.StepUp();
        await NoContent(await Decide(trustee, await OpenItem("bank-details-verification")));

        var batch = await Id(await NewBatch(s.Admin, await Invoice(s, "GL-1001", 3_450)));
        Assert.Equal("conflict-of-interest", await (await Decide(s.Admin, await OpenItem("payment-batch-approval"))).ProblemCode());
        await NoContent(await Decide(trustee, await OpenItem("payment-batch-approval")));
        // Nobody else at the agency can release it: the trustee's approval was the second person.
        await s.Admin.StepUp();
        Assert.Equal(HttpStatusCode.OK, (await Release(s.Admin, s, batch)).StatusCode);
    }
}
