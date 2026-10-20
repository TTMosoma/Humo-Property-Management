using System.Text;
using System.Text.Json;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Messaging;

/// <summary>A delivery report (DLR) or reply from SMSSouthAfrica's default webhook template (camelCase JSON).</summary>
public sealed record SmsWebhookPayload(long? Id, long? EventId, string? CustomerId, string? PhoneNumber, string? Status, long? IncomingId, string? SourcePhoneNumber, bool? OptOut);

/// <summary>
/// SMSSouthAfrica calls these with delivery reports and replies (docs/18 R-5). Every call must
/// carry a valid signature: an unsigned or stale report is refused, so nobody can forge
/// "delivered". Configure the webhook in their control panel as
/// <c>https://pm.humo.co.za/api/webhooks/sms/smssouthafrica</c>, then activate signatures.
/// </summary>
public static class SmsWebhookEndpoints
{
    public const string Path = "/webhooks/sms/smssouthafrica";

    public static void MapSmsWebhooks(this IEndpointRouteBuilder api) => api.MapPost(Path, Receive).AllowAnonymous();

    private static async Task<IResult> Receive(HttpRequest request, IOptions<SmsSouthAfricaOptions> sms, IOptions<AppOptions> app, TimeProvider clock, ILoggerFactory logs,
        HumoDbContext db, SentRecords sent)
    {
        var log = logs.CreateLogger("Humo.Sms.Webhook");
        using var reader = new StreamReader(request.Body, Encoding.UTF8);
        var raw = await reader.ReadToEndAsync();

        // The provider signs the address it called: our public address, not the one Caddy forwards to.
        var url = app.Value.PublicUrl.TrimEnd('/') + request.Path + request.QueryString;
        var valid = SmsWebhookSignature.IsValid(sms.Value.WebhookSecret, request.Headers[SmsWebhookSignature.SignatureHeader], request.Headers[SmsWebhookSignature.TimestampHeader],
            request.Method, url, raw, clock.GetUtcNow());
        if (!valid)
        {
            log.LogWarning("Refused an SMS webhook with a missing, stale or wrong signature from {Ip}", request.HttpContext.Connection.RemoteIpAddress);
            return Results.Unauthorized();
        }

        SmsWebhookPayload? payload;
        try { payload = JsonSerializer.Deserialize<SmsWebhookPayload>(raw, new JsonSerializerOptions(JsonSerializerDefaults.Web)); }
        catch (JsonException) { return Results.BadRequest(); }

        // Replies are kept in the log until the Inbox reaches the API; delivery reports are recorded against the delivery in Sent (docs/18 R-5).
        if (payload?.IncomingId is not null)
            log.LogInformation("SMS reply from {From} (event {EventId}, reference {Reference}, opt-out {OptOut})",
                MobileNumber.Mask(payload.SourcePhoneNumber ?? ""), payload.EventId, payload.CustomerId, payload.OptOut == true);
        else
        {
            log.LogInformation("SMS delivery report: {Status} for {To} (event {EventId}, reference {Reference})",
                payload?.Status, MobileNumber.Mask(payload?.PhoneNumber ?? ""), payload?.EventId, payload?.CustomerId);
            await RecordAsync(payload, db, sent);
        }
        return Results.Ok();
    }

    /// <summary>Delivered or failed, against the delivery whose id we sent as the reference (or the provider's event id).</summary>
    private static async Task RecordAsync(SmsWebhookPayload? payload, HumoDbContext db, SentRecords sent)
    {
        if (payload is null || DeliveryStatus(payload.Status) is not { } status) return;
        var eventId = payload.EventId?.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var delivery = Guid.TryParseExact(payload.CustomerId ?? "", "N", out var id) ? await db.Deliveries.FirstOrDefaultAsync(d => d.Id == id)
            : eventId is null ? null : await db.Deliveries.FirstOrDefaultAsync(d => d.ProviderMessageId == eventId);
        if (delivery is null || delivery.Channel != "sms") return;
        sent.Mark(delivery, status, status == "failed" ? $"The network reported: {payload.Status}" : null);
        await db.SaveChangesAsync();
    }

    /// <summary>The provider's words → Sent's: delivered, or failed; anything in between leaves it as queued.</summary>
    internal static string? DeliveryStatus(string? reported) => reported?.Trim().ToLowerInvariant() switch
    {
        null or "" => null,
        var s when s.Contains("undeliver") || s.Contains("fail") || s.Contains("reject") || s.Contains("expire") || s.Contains("block") => "failed",
        var s when s.Contains("deliver") => "delivered",
        _ => null,
    };
}
