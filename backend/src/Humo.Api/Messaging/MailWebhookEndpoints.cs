using System.Text;
using System.Text.Json;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Messaging;

/// <summary>
/// One delivery event from the mail provider, in Humo's own shape. Whichever provider sends mail, a small relay or the
/// provider's webhook maps its events to this: <c>event</c> is "delivered", "bounced", "failed", "complained" or
/// "deferred"; <c>messageId</c> is the Message-ID Humo sent (the one <see cref="IEmailSender"/> returned).
/// </summary>
public sealed record MailEventPayload(string? Event, string? MessageId, string? Recipient, string? Reason);

/// <summary>
/// Delivery events for email (docs/18 R-5): a message accepted by the mail server is "queued" in Sent until the provider
/// reports it delivered, or bounced. Every call must carry a valid signature (<c>Humo-Signature</c> over
/// <c>Humo-Timestamp</c>, the same scheme as the SMS webhook), so nobody can forge a "delivered".
/// </summary>
public static class MailWebhookEndpoints
{
    public const string Path = "/webhooks/email";
    public const string SignatureHeader = "Humo-Signature";
    public const string TimestampHeader = "Humo-Timestamp";

    public static void MapMailWebhooks(this IEndpointRouteBuilder api) => api.MapPost(Path, Receive).AllowAnonymous();

    private static async Task<IResult> Receive(HttpRequest request, IOptions<MailOptions> mail, IOptions<AppOptions> app, TimeProvider clock, ILoggerFactory logs,
        HumoDbContext db, SentRecords sent, CancellationToken ct)
    {
        var log = logs.CreateLogger("Humo.Mail.Webhook");
        using var reader = new StreamReader(request.Body, Encoding.UTF8);
        var raw = await reader.ReadToEndAsync(ct);

        var url = app.Value.PublicUrl.TrimEnd('/') + request.Path + request.QueryString;
        var valid = SmsWebhookSignature.IsValid(mail.Value.WebhookSecret, request.Headers[SignatureHeader], request.Headers[TimestampHeader],
            request.Method, url, raw, clock.GetUtcNow());
        if (!valid)
        {
            log.LogWarning("Refused a mail event with a missing, stale or wrong signature from {Ip}", request.HttpContext.Connection.RemoteIpAddress);
            return Results.Unauthorized();
        }

        MailEventPayload? payload;
        try { payload = JsonSerializer.Deserialize<MailEventPayload>(raw, new JsonSerializerOptions(JsonSerializerDefaults.Web)); }
        catch (JsonException) { return Results.BadRequest(); }
        if (payload is null || Normalise(payload.MessageId) is not { } messageId) return Results.BadRequest();

        var status = EventStatus(payload.Event);
        // Events we don't track (deferred, unknown) are acknowledged, so the provider doesn't resend them.
        if (status is null) return Results.Ok();

        var delivery = await db.Deliveries.FirstOrDefaultAsync(d => d.Channel == "email" && d.ProviderMessageId == messageId, ct);
        if (delivery is null)
        {
            log.LogInformation("Mail event {Event} for a message Humo doesn't know ({MessageId})", payload.Event, messageId);
            return Results.Ok();
        }
        if (payload.Recipient is { } to && !string.Equals(to.Trim(), delivery.Address, StringComparison.OrdinalIgnoreCase))
        {
            log.LogWarning("Mail event for {MessageId} names a different recipient than Sent holds; ignored", messageId);
            return Results.Ok();
        }

        sent.Mark(delivery, status, status == "bounced" ? BounceReason(payload.Reason) : null);
        await db.SaveChangesAsync(ct);
        log.LogInformation("Mail event {Event} recorded as {Status} for delivery {Id}", payload.Event, status, delivery.Id);
        return Results.Ok();
    }

    /// <summary>The provider's event names → Sent's statuses. Anything else isn't a final outcome and returns null.</summary>
    internal static string? EventStatus(string? reported) => reported?.Trim().ToLowerInvariant() switch
    {
        "delivered" => "delivered",
        "bounced" or "bounce" or "failed" or "complained" or "complaint" => "bounced",
        _ => null,
    };

    /// <summary>What Sent shows for a bounce: the provider's reason when it gave one, in plain words.</summary>
    internal static string BounceReason(string? reason) =>
        string.IsNullOrWhiteSpace(reason) ? "The mail server couldn’t deliver it to this address." : $"The mail server couldn’t deliver it: {reason.Trim()}";

    /// <summary>Message-IDs come with or without angle brackets; we keep them without.</summary>
    internal static string? Normalise(string? messageId) => messageId?.Trim().Trim('<', '>') is { Length: > 0 } id ? id : null;
}
