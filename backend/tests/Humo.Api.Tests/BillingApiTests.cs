using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Humo.Domain.Access;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Humo's invoices and manual EFT payments on the API (docs/23 §6, register R-14). No payment provider yet.</summary>
public sealed class BillingApiTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        Assert.True(res.StatusCode == HttpStatusCode.OK, await res.Content.ReadAsStringAsync());
        return await res.Json();
    }

    private static async Task Expect(HttpStatusCode status, HttpResponseMessage res) => Assert.True(res.StatusCode == status, $"{res.StatusCode}: {await res.Content.ReadAsStringAsync()}");

    /// <summary>
    /// A customer with an agreed price and a billing email (set by the System Administrator), and Humo Finance
    /// with a fresh step-up: billing sits with Humo Finance (doc 17, D15). "Admin" below is Humo Finance.
    /// </summary>
    private async Task<(Guid Org, HttpClient Admin, Guid Mashoto)> Priced()
    {
        var mashoto = await api.Person("mashoto@humo.co.za", Roles.AccountManager, null);
        await api.Person("refilwe@humo.co.za", Roles.HumoFinance, null);
        var org = await api.Customer("Acacia", "professional", mashoto);
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();
        await Expect(HttpStatusCode.NoContent, await admin.PostAsJsonAsync($"/api/platform/customers/{org}/agreement/changes", new { change = new { type = "package", packageId = "enterprise", effectiveFrom = "2026-10-19", monthlyPrice = 15000, reason = "Agreed at onboarding: Enterprise at R15 000" } }));
        await Expect(HttpStatusCode.NoContent, await admin.PostAsJsonAsync($"/api/platform/customers/{org}/agreement/changes", new { change = new { type = "billing-preference", preference = "manual-eft", billingEmail = "accounts@acacia.example", reason = "Their accounts department pays by EFT" } }));
        // A System Administrator no longer issues invoices.
        Assert.Equal("forbidden", await (await admin.PostAsync($"/api/platform/customers/{org}/invoices", null)).ProblemCode());
        var finance = await api.SignedIn("refilwe@humo.co.za");
        await finance.StepUp();
        return (org, finance, mashoto);
    }

    [Fact]
    public async Task An_invoice_needs_agreed_prices_and_a_billing_email()
    {
        var org = await api.Customer("Acacia");
        await api.Person("refilwe@humo.co.za", Roles.HumoFinance, null);
        var admin = await api.SignedIn("refilwe@humo.co.za");
        await admin.StepUp();
        // The approved catalogue prices Professional at R2 400 now; this customer's trial line was opened before, unpriced.
        await api.Db(async db => { var row = await db.Agreements.SingleAsync(); row.Document = row.Document.Replace("\"monthlyPrice\":2400", "\"monthlyPrice\":null"); return await db.SaveChangesAsync(); });
        var errors = await (await admin.PostAsync($"/api/platform/customers/{org}/invoices", null)).FieldErrors();
        Assert.Equal("Some charges have no price yet. Agree the price in Billing & agreement first.", errors.GetProperty("period").GetString());
        Assert.True(errors.TryGetProperty("billingEmail", out _));
        Assert.Equal(0, await api.Db(db => db.Invoices.CountAsync()));
    }

    [Fact]
    public async Task Issuing_snapshots_the_agreement_emails_the_link_and_moves_billing_on_a_month()
    {
        var (org, admin, _) = await Priced();
        var am = await api.SignedIn("mashoto@humo.co.za");
        await am.StepUp();
        Assert.Equal("forbidden", await (await am.PostAsync($"/api/platform/customers/{org}/invoices", null)).ProblemCode());

        api.Email.Sent.Clear();
        var res = await admin.PostAsync($"/api/platform/customers/{org}/invoices", null);
        await Expect(HttpStatusCode.Created, res);
        var id = (await res.Json()).GetProperty("id").GetString();
        var doc = await Ok(await admin.GetAsync($"/api/platform/invoices/{id}"));
        var inv = doc.GetProperty("invoice");
        // The trial runs to 18 November, so the first period is December.
        Assert.Equal(("HPM-ACACIA-202612", "2026-12-01", "2027-01-01"), (inv.GetProperty("reference").GetString(), inv.GetProperty("periodStart").GetString(), inv.GetProperty("periodEnd").GetString()));
        Assert.Equal((15000m, "issued", false), (inv.GetProperty("total").GetDecimal(), inv.GetProperty("status").GetString(), inv.GetProperty("simulated").GetBoolean()));
        Assert.Equal("Humo Enterprise", inv.GetProperty("lines")[0].GetProperty("description").GetString());

        var mail = Assert.Single(api.Email.Sent);
        Assert.Equal("accounts@acacia.example", mail.To);
        Assert.Contains($"https://localhost/settings/billing/{id}", mail.Text);

        var view = await Ok(await admin.GetAsync($"/api/platform/customers/{org}/commercial"));
        Assert.Equal("2027-01-01", view.GetProperty("agreement").GetProperty("billing").GetProperty("nextBillingDate").GetString());
        Assert.Single(view.GetProperty("invoices").EnumerateArray());
        Assert.StartsWith("Issued invoice HPM-ACACIA-202612", view.GetProperty("agreement").GetProperty("history")[0].GetProperty("action").GetString());
        // A price change in the catalogue later doesn't touch an issued invoice: it's a snapshot.
        Assert.Contains("\"total\":15000", await api.Db(db => db.Invoices.Select(i => i.Document).SingleAsync()));

        // The next one is January's.
        var next = await admin.PostAsync($"/api/platform/customers/{org}/invoices", null);
        await Expect(HttpStatusCode.Created, next);
        Assert.Equal(["HPM-ACACIA-202612", "HPM-ACACIA-202701"], await api.Db(db => db.Invoices.OrderBy(i => i.PeriodStart).Select(i => i.Reference).ToListAsync()));
    }

    [Fact]
    public async Task Manual_EFT_stays_unpaid_on_a_proof_until_it_is_reconciled_with_the_bank_statement()
    {
        var (org, admin, _) = await Priced();
        var id = (await (await admin.PostAsync($"/api/platform/customers/{org}/invoices", null)).Json()).GetProperty("id").GetString();
        Assert.Contains("payment provider", (await (await admin.PostAsync($"/api/platform/invoices/{id}/checkout", null)).FieldErrors()).GetProperty("invoiceId").GetString());

        var am = await api.SignedIn("mashoto@humo.co.za");
        await Expect(HttpStatusCode.NoContent, await am.PostAsJsonAsync($"/api/platform/invoices/{id}/eft-proof", new { note = "Proof of payment emailed by their bookkeeper" }));
        var doc = await Ok(await admin.GetAsync($"/api/platform/invoices/{id}"));
        Assert.Equal(("issued", 15000m), (doc.GetProperty("invoice").GetProperty("status").GetString(), doc.GetProperty("balance").GetDecimal()));

        var payment = await api.Db(db => db.Payments.SingleAsync());
        Assert.Equal("forbidden", await (await am.PostAsJsonAsync($"/api/platform/payments/{payment.Id}/reconcile", new { bankReference = "FNB 2026-10-20 #4471" })).ProblemCode());
        await Expect(HttpStatusCode.NoContent, await admin.PostAsJsonAsync($"/api/platform/payments/{payment.Id}/reconcile", new { bankReference = "FNB 2026-10-20 #4471" }));
        doc = await Ok(await admin.GetAsync($"/api/platform/invoices/{id}"));
        Assert.Equal(("paid", 0m), (doc.GetProperty("invoice").GetProperty("status").GetString(), doc.GetProperty("balance").GetDecimal()));
        Assert.True((await (await admin.PostAsJsonAsync($"/api/platform/payments/{payment.Id}/reconcile", new { bankReference = "FNB again" })).FieldErrors()).TryGetProperty("paymentId", out _));
        Assert.True((await (await am.PostAsJsonAsync($"/api/platform/invoices/{id}/eft-proof", new { note = "Another proof" })).FieldErrors()).TryGetProperty("invoiceId", out _));
    }

    [Fact]
    public async Task Customers_see_their_own_invoices_only_and_an_unpaid_invoice_goes_overdue()
    {
        var (org, admin, _) = await Priced();
        var other = await api.Customer("Fynbos");
        var id = (await (await admin.PostAsync($"/api/platform/customers/{org}/invoices", null)).Json()).GetProperty("id").GetString();
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        await api.Person("pieter@fynbos.example", Roles.AgencyAdmin, other);
        var agency = await api.SignedIn("thandeka@acacia.example");
        var mine = await Ok(await agency.GetAsync($"/api/organisations/{org}/invoices"));
        Assert.Equal("HPM-ACACIA-202612", Assert.Single(mine.EnumerateArray()).GetProperty("invoice").GetProperty("reference").GetString());
        await Ok(await agency.GetAsync($"/api/organisations/{org}/invoices/{id}"));
        Assert.Equal("forbidden", await (await agency.GetAsync("/api/platform/invoices")).ProblemCode());

        var fynbos = await api.SignedIn("pieter@fynbos.example");
        Assert.Equal(HttpStatusCode.NotFound, (await fynbos.GetAsync($"/api/organisations/{other}/invoices/{id}")).StatusCode);
        Assert.Equal("forbidden", await (await fynbos.GetAsync($"/api/organisations/{org}/invoices")).ProblemCode());

        // Due seven days after issue (26 October); unpaid after that, it's overdue, and health says so.
        api.Clock.Advance(TimeSpan.FromDays(8));
        admin = await api.SignedIn("refilwe@humo.co.za");
        var list = await Ok(await admin.GetAsync("/api/platform/invoices"));
        Assert.Equal("overdue", list[0].GetProperty("status").GetString());
        var customer = await Ok(await admin.GetAsync($"/api/platform/customers/{org}"));
        Assert.Equal("overdue", customer.GetProperty("snapshot").GetProperty("paymentStatus").GetString());
    }
}
