using System.Net;
using System.Net.Http.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Payments;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Humo.Api.Tests;

/// <summary>The daily billing run and card debit orders (docs/23 §6, register R-14).</summary>
public sealed class BillingRunTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    private TestPayfast Payfast => (TestPayfast)api.Services.GetRequiredService<IPayfast>();

    /// <summary>Acacia on a Professional trial (R2 400 from the approved catalogue) with a billing email; Humo Finance exists.</summary>
    private async Task<Guid> Customer(string preference = "manual-eft")
    {
        var org = await api.Customer("Acacia", "professional");
        await api.Person("refilwe@humo.co.za", Roles.HumoFinance, null);
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();
        var res = await admin.PostAsJsonAsync($"/api/platform/customers/{org}/agreement/changes",
            new { change = new { type = "billing-preference", preference, billingEmail = "accounts@acacia.example", reason = "Set at onboarding" } });
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        return org;
    }

    private HttpClient? finance;

    /// <summary>Humo Finance runs the billing run. One session, signed in again only once the clock has moved past it (sign-ins are rate limited).</summary>
    private async Task<System.Text.Json.JsonElement> Run()
    {
        if (finance is null || (await finance.GetAsync("/api/me")).StatusCode == HttpStatusCode.Unauthorized) finance = await api.SignedIn("refilwe@humo.co.za");
        await finance.StepUp();
        var res = await finance.PostAsync("/api/platform/billing/run", null);
        Assert.True(res.StatusCode == HttpStatusCode.OK, await res.Content.ReadAsStringAsync());
        return await res.Json();
    }

    /// <summary>Moves the test clock to 08:00 South African time on a day.</summary>
    private void On(string day) => api.Clock.Advance(DateTimeOffset.Parse($"{day}T08:00:00+02:00") - api.Clock.GetUtcNow());

    [Fact]
    public async Task The_run_ends_trials_invoices_what_is_due_once_and_reminds_until_the_subscription_is_past_due()
    {
        await Customer();
        var nothing = await Run();
        Assert.Equal((0, 0), (nothing.GetProperty("issued").GetInt32(), nothing.GetProperty("trialsEnded").GetInt32()));

        // The trial ran to 18 November; billing starts on 1 December.
        On("2026-12-01");
        api.Email.Sent.Clear();
        var run = await Run();
        Assert.Equal((1, 1), (run.GetProperty("issued").GetInt32(), run.GetProperty("trialsEnded").GetInt32()));
        Assert.Equal("active", await api.Db(db => db.Subscriptions.Select(s => s.Status).SingleAsync()));
        var inv = await api.Db(db => db.Invoices.SingleAsync());
        Assert.Equal(("HPM-ACACIA-202612", 2400m), (inv.Reference, inv.Total));
        Assert.StartsWith("Billing run started by", inv.IssuedBy);
        Assert.Contains(api.Email.Sent, e => e.To == "accounts@acacia.example" && e.Subject.StartsWith("Humo invoice HPM-ACACIA-202612"));
        Assert.Contains(await api.Db(db => db.Audit.Select(a => a.ActorName).ToListAsync()), n => n.StartsWith("Billing run started by"));

        // The same day again: nothing is invoiced twice.
        Assert.Equal(0, (await Run()).GetProperty("issued").GetInt32());
        Assert.Equal(1, await api.Db(db => db.Invoices.CountAsync()));

        // Due on 8 December: reminders 1, 7 and 14 days late, then past due (Humo Finance is told; nothing is suspended).
        api.Email.Sent.Clear();
        On("2026-12-09");
        Assert.Equal(1, (await Run()).GetProperty("reminders").GetInt32());
        Assert.Equal(0, (await Run()).GetProperty("reminders").GetInt32());
        Assert.Contains(api.Email.Sent, e => e.Subject == "Reminder: Humo invoice HPM-ACACIA-202612 is overdue");
        On("2026-12-15");
        Assert.Equal(1, (await Run()).GetProperty("reminders").GetInt32());
        On("2026-12-22");
        Assert.Equal(1, (await Run()).GetProperty("reminders").GetInt32());
        Assert.Equal("past-due", await api.Db(db => db.Subscriptions.Select(s => s.Status).SingleAsync()));
        Assert.Contains(await api.Db(db => db.Notices.Select(n => n.Title).ToListAsync()), t => t == "Past due: Acacia");
    }

    [Fact]
    public async Task A_customer_without_agreed_prices_is_skipped_and_named()
    {
        var org = await Customer();
        await api.Db(async db => { var row = await db.Agreements.SingleAsync(); row.Document = row.Document.Replace("\"monthlyPrice\":2400", "\"monthlyPrice\":null"); return await db.SaveChangesAsync(); });
        On("2026-12-01");
        var run = await Run();
        Assert.Equal(0, run.GetProperty("issued").GetInt32());
        Assert.Contains("Acacia: Some charges have no price yet", run.GetProperty("skipped")[0].GetString());
        Assert.Equal(org, await api.Db(db => db.Agreements.Select(a => a.OrganisationId).SingleAsync()));
    }

    [Fact]
    public async Task A_saved_card_is_charged_by_the_run_and_the_customer_can_cancel_the_debit_order()
    {
        var org = await Customer("instant-eft");
        On("2026-12-01");
        await Run();
        var first = await api.Db(db => db.Invoices.SingleAsync());

        // Pay now, saving the card: Payfast's confirmation carries the token.
        var agency = await api.SignedIn("thandeka@acacia.example");
        var checkout = await (await agency.PostAsync($"/api/organisations/{org}/invoices/{first.Id}/checkout?saveCard=true", null)).Json();
        var fields = checkout.GetProperty("form").GetProperty("fields").EnumerateArray().ToDictionary(f => f.GetProperty("key").GetString()!, f => f.GetProperty("value").GetString()!);
        Assert.Equal(("2", "save-card"), (fields["subscription_type"], fields["custom_str2"]));
        var paymentId = checkout.GetProperty("paymentId").GetString()!;
        Assert.Equal(HttpStatusCode.OK, (await Notify(("m_payment_id", paymentId), ("pf_payment_id", "1"), ("payment_status", "COMPLETE"), ("amount_gross", "2400.00"),
            ("custom_str2", "save-card"), ("token", "dc0521d3-55fe-269b-fa00-b647310d760f"), ("merchant_id", "10000100"))).StatusCode);
        var mandate = (await (await (await api.SignedIn(HumoApiFactory.AdminEmail)).GetAsync($"/api/platform/customers/{org}/commercial")).Json()).GetProperty("agreement").GetProperty("billing");
        Assert.Equal(("card-recurring", "active"), (mandate.GetProperty("preference").GetString(), mandate.GetProperty("mandate").GetProperty("status").GetString()));

        // January: the run charges the new invoice to the saved card. It's paid only when Payfast confirms the charge.
        On("2027-01-01");
        api.Email.Sent.Clear();
        Assert.Equal(1, (await Run()).GetProperty("charged").GetInt32());
        var charge = Assert.Single(Payfast.Charges);
        Assert.Equal(("dc0521d3-55fe-269b-fa00-b647310d760f", 2400m), (charge.Token, charge.Amount));
        Assert.Contains("charged to your saved card", Assert.Single(api.Email.Sent, e => e.Subject.StartsWith("Humo invoice HPM-ACACIA-202701")).Text);
        Assert.Equal("issued", await api.Db(db => db.Invoices.Where(i => i.Reference == "HPM-ACACIA-202701").Select(i => i.Status).SingleAsync()));
        Assert.Equal(HttpStatusCode.OK, (await Notify(("m_payment_id", charge.PaymentId), ("pf_payment_id", "2"), ("payment_status", "COMPLETE"), ("amount_gross", "2400.00"),
            ("token", "dc0521d3-55fe-269b-fa00-b647310d760f"), ("merchant_id", "10000100"))).StatusCode);
        Assert.Equal("paid", await api.Db(db => db.Invoices.Where(i => i.Reference == "HPM-ACACIA-202701").Select(i => i.Status).SingleAsync()));

        // A declined card: the invoice stands and is emailed with Pay now.
        Payfast.Refuse = true;
        On("2027-02-01");
        Assert.Equal(0, (await Run()).GetProperty("charged").GetInt32());
        Assert.Equal("failed", await api.Db(db => db.Payments.Where(p => p.Note!.StartsWith("Payfast refused")).Select(p => p.Status).SingleAsync()));

        // The customer stops the debit order: cancelled at Payfast first.
        agency = await api.SignedIn("thandeka@acacia.example");
        Assert.Equal(HttpStatusCode.NoContent, (await agency.PostAsJsonAsync($"/api/organisations/{org}/card-mandate/cancel", new { reason = "We'd rather pay each invoice ourselves" })).StatusCode);
        Assert.Equal("dc0521d3-55fe-269b-fa00-b647310d760f", Assert.Single(Payfast.Cancelled));
        Assert.DoesNotContain("dc0521d3", await api.Db(db => db.Agreements.Select(a => a.Document).SingleAsync()));
    }

    private Task<HttpResponseMessage> Notify(params (string Key, string Value)[] fields)
    {
        var list = fields.Select(f => new KeyValuePair<string, string>(f.Key, f.Value)).ToList();
        list.Add(new("signature", PayfastClient.Signature(list, null)));
        var body = string.Join("&", list.Select(f => $"{f.Key}={PayfastClient.Encode(f.Value)}"));
        return api.Client().PostAsync("/api/payments/notifications/payfast", new StringContent(body, System.Text.Encoding.UTF8, "application/x-www-form-urlencoded"));
    }
}
