using System.Net;
using System.Net.Http.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Payments;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Online payment through Payfast (D15): a checkout is not a payment; only a genuine notification for the right amount pays the invoice.</summary>
public sealed class PayfastTests : IDisposable
{
    private readonly HumoApiFactory api = new();

    public void Dispose() => api.Dispose();

    [Fact]
    public void Signatures_encode_values_as_Payfast_does()
    {
        Assert.Equal("a+b%26c%2Fd-_.%7E", PayfastClient.Encode("a b&c/d-_.~"));
        var fields = new List<KeyValuePair<string, string>> { new("merchant_id", "10000100"), new("empty", ""), new("item_name", "Humo invoice HPM-ACACIA-202612") };
        Assert.Equal("merchant_id=10000100&item_name=Humo+invoice+HPM-ACACIA-202612", PayfastClient.ParamString(fields));
        Assert.NotEqual(PayfastClient.Signature(fields, null), PayfastClient.Signature(fields, "salt"));
        Assert.Equal(32, PayfastClient.Signature(fields, null).Length);
    }

    /// <summary>An invoice for Acacia (Professional, R2 400), and its administrator signed in.</summary>
    private async Task<(Guid Org, string InvoiceId, HttpClient Agency)> Invoiced()
    {
        var org = await api.Customer("Acacia", "professional");
        await api.Person("refilwe@humo.co.za", Roles.HumoFinance, null);
        var admin = await api.SignedIn(HumoApiFactory.AdminEmail);
        await admin.StepUp();
        var pref = await admin.PostAsJsonAsync($"/api/platform/customers/{org}/agreement/changes",
            new { change = new { type = "billing-preference", preference = "instant-eft", billingEmail = "accounts@acacia.example", reason = "They pay online" } });
        Assert.Equal(HttpStatusCode.NoContent, pref.StatusCode);
        var finance = await api.SignedIn("refilwe@humo.co.za");
        await finance.StepUp();
        var res = await finance.PostAsync($"/api/platform/customers/{org}/invoices", null);
        Assert.True(res.StatusCode == HttpStatusCode.Created, await res.Content.ReadAsStringAsync());
        var invoiceId = (await res.Json()).GetProperty("id").GetString()!;
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        return (org, invoiceId, await api.SignedIn("thandeka@acacia.example"));
    }

    /// <summary>A notification body as Payfast posts it, signed.</summary>
    private static string Body(params (string Key, string Value)[] fields)
    {
        var list = fields.Select(f => new KeyValuePair<string, string>(f.Key, f.Value)).ToList();
        list.Add(new("signature", PayfastClient.Signature(list, null)));
        return string.Join("&", list.Select(f => $"{f.Key}={PayfastClient.Encode(f.Value)}"));
    }

    private Task<HttpResponseMessage> Notify(string body) =>
        api.Client().PostAsync("/api/payments/notifications/payfast", new StringContent(body, System.Text.Encoding.UTF8, "application/x-www-form-urlencoded"));

    [Fact]
    public async Task The_customer_pays_on_Payfast_and_only_a_genuine_notification_for_the_right_amount_pays_the_invoice()
    {
        var (org, invoiceId, agency) = await Invoiced();
        var res = await agency.PostAsync($"/api/organisations/{org}/invoices/{invoiceId}/checkout", null);
        Assert.True(res.StatusCode == HttpStatusCode.OK, await res.Content.ReadAsStringAsync());
        var session = await res.Json();
        var form = session.GetProperty("form");
        Assert.Equal("https://sandbox.payfast.co.za/eng/process", form.GetProperty("action").GetString());
        var fields = form.GetProperty("fields").EnumerateArray().ToDictionary(f => f.GetProperty("key").GetString()!, f => f.GetProperty("value").GetString()!);
        Assert.Equal(("10000100", "2400.00", invoiceId), (fields["merchant_id"], fields["amount"], fields["custom_str1"]));
        Assert.Equal("https://localhost/api/payments/notifications/payfast", fields["notify_url"]);
        Assert.Equal($"https://localhost/settings/billing/{invoiceId}?payment=returned", fields["return_url"]);
        Assert.Equal(32, fields["signature"].Length);
        var paymentId = session.GetProperty("paymentId").GetString()!;
        // Starting a checkout is not a payment.
        Assert.Equal("issued", await api.Db(db => db.Invoices.Select(i => i.Status).SingleAsync()));

        // Forged (bad signature) and the wrong amount: refused, nothing changes.
        Assert.Equal(HttpStatusCode.BadRequest, (await Notify($"m_payment_id={paymentId}&payment_status=COMPLETE&amount_gross=2400.00&merchant_id=10000100&signature=00")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Notify(Body(("m_payment_id", paymentId), ("pf_payment_id", "1089250"), ("payment_status", "COMPLETE"), ("amount_gross", "1.00"), ("merchant_id", "10000100")))).StatusCode);
        Assert.Equal("initiated", await api.Db(db => db.Payments.Select(p => p.Status).SingleAsync()));

        api.Email.Sent.Clear();
        var genuine = Body(("m_payment_id", paymentId), ("pf_payment_id", "1089250"), ("payment_status", "COMPLETE"), ("item_name", "Humo invoice HPM-ACACIA-202612"),
            ("amount_gross", "2400.00"), ("amount_fee", "-55.20"), ("amount_net", "2344.80"), ("merchant_id", "10000100"));
        Assert.Equal(HttpStatusCode.OK, (await Notify(genuine)).StatusCode);
        var payment = await api.Db(db => db.Payments.SingleAsync());
        Assert.Equal(("verified", "provider-notification", "1089250"), (payment.Status, payment.Verification, payment.ProviderReference));
        Assert.Equal("paid", await api.Db(db => db.Invoices.Select(i => i.Status).SingleAsync()));
        Assert.Equal("refilwe@humo.co.za", Assert.Single(api.Email.Sent).To);

        // Payfast retries: the same notification changes nothing, and a later "FAILED" can't undo a verified payment.
        Assert.Equal(HttpStatusCode.OK, (await Notify(genuine)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Notify(Body(("m_payment_id", paymentId), ("pf_payment_id", "1089250"), ("payment_status", "FAILED"), ("amount_gross", "2400.00"), ("merchant_id", "10000100")))).StatusCode);
        Assert.Equal("verified", await api.Db(db => db.Payments.Select(p => p.Status).SingleAsync()));

        // Paid: no second checkout.
        Assert.True((await (await agency.PostAsync($"/api/organisations/{org}/invoices/{invoiceId}/checkout", null)).FieldErrors()).TryGetProperty("invoiceId", out _));
    }

    [Fact]
    public async Task Another_organisation_can_t_pay_an_invoice_that_isn_t_theirs()
    {
        var (org, invoiceId, _) = await Invoiced();
        var other = await api.Customer("Fynbos");
        await api.Person("pieter@fynbos.example", Roles.AgencyAdmin, other);
        var fynbos = await api.SignedIn("pieter@fynbos.example");
        Assert.Equal(HttpStatusCode.NotFound, (await fynbos.PostAsync($"/api/organisations/{other}/invoices/{invoiceId}/checkout", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await fynbos.PostAsync($"/api/organisations/{org}/invoices/{invoiceId}/checkout", null)).StatusCode);
        Assert.Equal(0, await api.Db(db => db.Payments.CountAsync()));
    }
}
