using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>Communications › Sent on the API (docs/18 R-5): statements and letters as sent, with each delivery's real result.</summary>
public sealed class SentTests : IDisposable
{
    private const string Secret = "dGVzdC13ZWJob29rLXNlY3JldC1mb3ItaHVtby1zZW50"; // base64, as the provider issues it
    private readonly HumoApiFactory api = new HumoApiFactory().With("Sms:Provider", "Captured").With("Sms:SmsSouthAfrica:WebhookSecret", Secret);

    public void Dispose() => api.Dispose();

    private sealed record Setup(Guid Kc, Guid Account42, Guid Account12, HttpClient Finance, HttpClient Trustee);

    /// <summary>Kingfisher Court: unit 42 (Sipho, email and mobile) and unit 12 (Lindiwe, mobile only), both R1 800 overdue.</summary>
    private async Task<Setup> Scheme()
    {
        var org = await api.Customer("Acacia", "professional");
        await api.Person("thandeka@acacia.example", Roles.AgencyAdmin, org);
        await api.Person("priya@acacia.example", Roles.Finance, org);
        var admin = await api.SignedIn("thandeka@acacia.example");
        var kc = await Id(await admin.PostAsJsonAsync("/api/schemes", new { name = "Kingfisher Court", code = "KC", type = "Sectional Title", suburb = "Morningside", city = "Sandton", province = "Gauteng" }));
        await api.Person("bongani@trustee.example", Roles.Trustee, org, [kc]);
        var u42 = await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "42", description = "2-bed", sizeM2 = 86, participationQuota = 1.25, monthlyLevy = 1800, occupancy = "owner-occupied" }));
        var u12 = await Id(await admin.PostAsJsonAsync($"/api/schemes/{kc}/units", new { number = "12", description = "3-bed", sizeM2 = 120, participationQuota = 2, monthlyLevy = 1800, occupancy = "owner-occupied" }));
        await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Sipho", lastName = "Khumalo", kind = "individual", email = "sipho@mail.example", phone = "083 551 0274", preferredChannel = "email" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = u42.ToString(), since = "2019-05-01" },
        }));
        await Id(await admin.PostAsJsonAsync("/api/people", new
        {
            details = new { firstName = "Lindiwe", lastName = "Mokoena", kind = "individual", email = "", phone = "082 123 4567", preferredChannel = "sms" },
            link = new { type = "owner", schemeId = kc.ToString(), unitId = u12.ToString(), since = "2021-02-01" },
        }));
        var accounts = await api.Db(db => db.LevyAccounts.ToDictionaryAsync(a => a.UnitId, a => a.Id));
        await api.Db(async db =>
        {
            foreach (var id in accounts.Values)
            {
                db.Ledger.Add(new LedgerEntry { Id = Guid.CreateVersion7(), AccountId = id, Date = new DateOnly(2026, 9, 1), Type = "levy", Description = "Levy — September", Amount = 1800, CreatedBy = "test" });
                var a = await db.LevyAccounts.SingleAsync(x => x.Id == id);
                (a.Balance, a.AgeingD30, a.Status) = (1800, 1800, "arrears");
            }
            db.TrustAccounts.Add(new TrustAccountRow { SchemeId = kc, Bank = "FNB", AccountName = "Kingfisher Court Body Corporate", AccountNumber = "62345678901", BranchCode = "250655", Verified = true });
            return await db.SaveChangesAsync();
        });
        return new Setup(kc, accounts[u42], accounts[u12], await api.SignedIn("priya@acacia.example"), await api.SignedIn("bongani@trustee.example"));
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

    private static async Task NoContent(HttpResponseMessage res) =>
        Assert.True(res.StatusCode == HttpStatusCode.NoContent, $"{res.StatusCode}: {await res.Content.ReadAsStringAsync()}");

    private static Task<HttpResponseMessage> Letter(HttpClient c, Guid account, string channel) =>
        c.PostAsJsonAsync($"/api/collections/{account}/actions", new { action = new { type = "send-letter", kind = "reminder", channel }, expectedVersion = 0 });

    private static async Task<JsonElement[]> Sent(HttpClient c, Guid scheme) => [.. (await Ok(await c.GetAsync($"/api/communications/sent?schemeIds={scheme}"))).EnumerateArray()];

    private Task Settled() => HumoApiFactory.Until(() => api.Db(db => db.Deliveries.AllAsync(d => d.Status != "queued" || d.ProviderMessageId != null)));

    [Fact]
    public async Task Letters_are_recorded_in_Sent_with_what_the_mail_server_and_SMS_network_said()
    {
        var s = await Scheme();
        await NoContent(await Letter(s.Finance, s.Account42, "email"));
        await NoContent(await Letter(s.Finance, s.Account12, "sms"));
        await Settled();
        await MailEvents.ProviderConfirmsEmails(api);

        var sent = await Sent(s.Finance, s.Kc);
        Assert.Equal(2, sent.Length);
        var email = sent.Single(m => m.GetProperty("message").GetProperty("channels")[0].GetString() == "email");
        Assert.Equal(("letter", "Reminder: levy account KC-042", "MSG-2001", "sent"), (email.GetProperty("message").GetProperty("kind").GetString(),
            email.GetProperty("message").GetProperty("subject").GetString(), email.GetProperty("message").GetProperty("ref").GetString(), email.GetProperty("state").GetString()));
        var delivery = email.GetProperty("message").GetProperty("deliveries")[0];
        Assert.Equal(("delivered", "sipho@mail.example", "Unit 42", "KC-042"), (delivery.GetProperty("status").GetString(), delivery.GetProperty("address").GetString(),
            delivery.GetProperty("unitLabel").GetString(), delivery.GetProperty("values").GetProperty("account.number").GetString()));
        Assert.Equal("/finance/credit-control/" + s.Account42, email.GetProperty("message").GetProperty("source").GetProperty("route").GetString());

        // The SMS waits for the network's delivery report, which comes back with the delivery's id as our reference.
        var sms = sent.Single(m => m.GetProperty("message").GetProperty("channels")[0].GetString() == "sms");
        Assert.Equal("sending", sms.GetProperty("state").GetString());
        var smsDelivery = sms.GetProperty("message").GetProperty("deliveries")[0];
        Assert.Equal("queued", smsDelivery.GetProperty("status").GetString());
        var reference = Assert.Single(api.Sms.Sent).Reference;
        Assert.Equal(Guid.Parse(smsDelivery.GetProperty("id").GetString()!).ToString("N"), reference);
        Assert.Equal(HttpStatusCode.OK, (await Report(reference!, "Delivered")).StatusCode);
        var after = await Ok(await s.Finance.GetAsync($"/api/communications/sent/{sms.GetProperty("message").GetProperty("id").GetString()}"));
        Assert.Equal(("sent", 1), (after.GetProperty("state").GetString(), after.GetProperty("counts").GetProperty("delivered").GetInt32()));

        // Trustees see what was sent in their scheme; cancelling something already sent is refused.
        Assert.Equal(2, (await Sent(s.Trustee, s.Kc)).Length);
        Assert.True((await (await s.Finance.PostAsync($"/api/communications/sent/{after.GetProperty("message").GetProperty("id").GetString()}/cancel", null)).FieldErrors()).TryGetProperty("sendAt", out _));
    }

    [Fact]
    public async Task A_delivered_event_from_the_provider_marks_the_email_delivered()
    {
        var s = await Scheme();
        await NoContent(await Letter(s.Finance, s.Account42, "email"));
        await HumoApiFactory.Until(() => api.Db(db => db.Deliveries.AnyAsync(d => d.Channel == "email" && d.Status == "queued")));
        var messageId = await ProviderIdOfQueuedEmail();

        Assert.Equal(HttpStatusCode.OK, (await MailEvents.Report(api, messageId, "delivered", recipient: "sipho@mail.example")).StatusCode);
        var message = (await Sent(s.Finance, s.Kc)).Single();
        Assert.Equal(1, message.GetProperty("counts").GetProperty("delivered").GetInt32());
    }

    [Fact]
    public async Task A_bounce_shows_in_Sent_with_the_providers_reason()
    {
        var s = await Scheme();
        await NoContent(await Letter(s.Finance, s.Account42, "email"));
        await HumoApiFactory.Until(() => api.Db(db => db.Deliveries.AnyAsync(d => d.Channel == "email" && d.Status == "queued")));

        Assert.Equal(HttpStatusCode.OK, (await MailEvents.Report(api, await ProviderIdOfQueuedEmail(), "bounced", "mailbox full")).StatusCode);
        var message = (await Sent(s.Finance, s.Kc)).Single();
        var delivery = message.GetProperty("message").GetProperty("deliveries")[0];
        Assert.Equal(("bounced", 1), (delivery.GetProperty("status").GetString(), message.GetProperty("counts").GetProperty("bounced").GetInt32()));
        Assert.Contains("mailbox full", delivery.GetProperty("error").GetString());
    }

    [Fact]
    public async Task A_bounce_without_a_signature_is_refused_and_changes_nothing()
    {
        var s = await Scheme();
        await NoContent(await Letter(s.Finance, s.Account42, "email"));
        await HumoApiFactory.Until(() => api.Db(db => db.Deliveries.AnyAsync(d => d.Channel == "email" && d.Status == "queued")));

        Assert.Equal(HttpStatusCode.Unauthorized, (await MailEvents.Report(api, await ProviderIdOfQueuedEmail(), "delivered", sign: false)).StatusCode);
        Assert.Equal(1, (await Sent(s.Finance, s.Kc)).Single().GetProperty("counts").GetProperty("queued").GetInt32());
    }

    [Fact]
    public async Task An_event_for_a_different_address_is_ignored()
    {
        var s = await Scheme();
        await NoContent(await Letter(s.Finance, s.Account42, "email"));
        await HumoApiFactory.Until(() => api.Db(db => db.Deliveries.AnyAsync(d => d.Channel == "email" && d.Status == "queued")));

        Assert.Equal(HttpStatusCode.OK, (await MailEvents.Report(api, await ProviderIdOfQueuedEmail(), "delivered", recipient: "someone@else.example")).StatusCode);
        Assert.Equal(1, (await Sent(s.Finance, s.Kc)).Single().GetProperty("counts").GetProperty("queued").GetInt32());
    }

    /// <summary>The provider's Message-ID for the queued letter email (the test's setup also sends invitations).</summary>
    private async Task<string> ProviderIdOfQueuedEmail()
    {
        await HumoApiFactory.Until(() => api.Db(db => db.Deliveries.AnyAsync(d => d.Channel == "email" && d.Status == "queued" && d.ProviderMessageId != null)));
        return await api.Db(db => db.Deliveries.Where(d => d.Channel == "email" && d.Status == "queued").Select(d => d.ProviderMessageId!).SingleAsync());
    }

    private Task<HttpResponseMessage> Report(string reference, string status)
    {
        var body = JsonSerializer.Serialize(new { id = 1, eventId = 99, customerId = reference, phoneNumber = "27821234567", status });
        var ts = api.Clock.GetUtcNow().ToUnixTimeSeconds().ToString();
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/webhooks/sms/smssouthafrica")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
            Headers = { { SmsWebhookSignature.TimestampHeader, ts } },
        }.With(SmsWebhookSignature.Sign(Secret, ts, "POST", "https://localhost/api/webhooks/sms/smssouthafrica", body));
        return api.Client().SendAsync(request);
    }

    [Fact]
    public async Task A_failed_email_shows_in_Sent_and_goes_again_on_retry()
    {
        var s = await Scheme();
        api.Email.Failing = true;
        await NoContent(await Letter(s.Finance, s.Account42, "email"));
        await HumoApiFactory.Until(() => api.Db(db => db.Deliveries.AnyAsync(d => d.Status == "failed")));
        var message = (await Sent(s.Finance, s.Kc)).Single();
        var id = message.GetProperty("message").GetProperty("id").GetString();
        Assert.Equal(1, message.GetProperty("counts").GetProperty("failed").GetInt32());
        Assert.Contains("mail server", message.GetProperty("message").GetProperty("deliveries")[0].GetProperty("error").GetString());

        api.Email.Failing = false;
        await NoContent(await s.Finance.PostAsync($"/api/communications/sent/{id}/retry", null));
        await MailEvents.ProviderConfirmsEmails(api);
        await HumoApiFactory.Until(() => api.Db(db => db.Deliveries.AllAsync(d => d.Status == "delivered")));
        Assert.Equal("sipho@mail.example", Assert.Single(api.Email.Sent).To);
        Assert.True((await (await s.Finance.PostAsync($"/api/communications/sent/{id}/retry", null)).FieldErrors()).TryGetProperty("deliveries", out _));
        Assert.Equal("forbidden", await (await s.Trustee.PostAsync($"/api/communications/sent/{id}/retry", null)).ProblemCode());
    }

    [Fact]
    public async Task Bulk_reminders_are_one_record_listing_who_was_skipped_and_why()
    {
        var s = await Scheme();
        Assert.Equal(1, await (await s.Finance.PostAsJsonAsync("/api/collections/reminders", new { accountIds = new[] { s.Account42.ToString(), s.Account12.ToString() }, channel = "email" })).Content.ReadFromJsonAsync<int>());
        await Settled();
        await MailEvents.ProviderConfirmsEmails(api);
        var message = Assert.Single(await Sent(s.Finance, s.Kc)).GetProperty("message");
        Assert.Equal(("reminder", "1 account in arrears · Kingfisher Court"), (message.GetProperty("kind").GetString(), message.GetProperty("audienceLabel").GetString()));
        Assert.Equal("delivered", Assert.Single(message.GetProperty("deliveries").EnumerateArray()).GetProperty("status").GetString());
        var skipped = Assert.Single(message.GetProperty("skipped").EnumerateArray());
        Assert.Equal("Lindiwe Mokoena", skipped.GetProperty("name").GetString());
        Assert.Contains("no email address", skipped.GetProperty("reason").GetString());
    }
}
