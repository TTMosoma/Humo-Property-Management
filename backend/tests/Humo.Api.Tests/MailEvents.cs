using System.Text;
using System.Text.Json;
using Humo.Api.Messaging;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Tests;

/// <summary>
/// The mail provider's delivery events, signed the way its relay signs them (docs/18 R-5). Tests use these to
/// confirm an email arrived, as the provider does in production.
/// </summary>
public static class MailEvents
{
    public const string Secret = "bWFpbC13ZWJob29rLXNlY3JldC1mb3ItaHVtby1zZW50"; // base64, as the relay issues it

    public static async Task<HttpResponseMessage> Report(HumoApiFactory api, string messageId, string @event, string? reason = null, string? recipient = null, bool sign = true)
    {
        var body = JsonSerializer.Serialize(new { @event, messageId, recipient, reason });
        var ts = api.Clock.GetUtcNow().ToUnixTimeSeconds().ToString();
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/webhooks/email") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.Add(MailWebhookEndpoints.TimestampHeader, ts);
        if (sign) request.Headers.Add(MailWebhookEndpoints.SignatureHeader, SmsWebhookSignature.Sign(Secret, ts, "POST", "https://localhost/api/webhooks/email", body));
        return await api.Client().SendAsync(request);
    }

    /// <summary>
    /// The provider reports every email Humo has sent as delivered. Waits until each queued email has been sent (and
    /// so has its provider Message-ID), then reports the ones still queued.
    /// </summary>
    public static async Task ProviderConfirmsEmails(HumoApiFactory api)
    {
        await HumoApiFactory.Until(() => api.Db(db => db.Deliveries.AllAsync(d => d.Channel != "email" || d.Status != "queued" || d.ProviderMessageId != null)));
        var queued = await api.Db(db => db.Deliveries.Where(d => d.Channel == "email" && d.Status == "queued").Select(d => d.ProviderMessageId!).ToListAsync());
        foreach (var id in queued)
            await Report(api, id, "delivered");
    }
}
