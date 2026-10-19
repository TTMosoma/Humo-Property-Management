using System.Text;
using System.Text.Json;
using Humo.Infrastructure.Messaging;
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

    private static async Task<IResult> Receive(HttpRequest request, IOptions<SmsSouthAfricaOptions> sms, IOptions<AppOptions> app, TimeProvider clock, ILoggerFactory logs)
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

        // Kept in the log for now; stored against the message in Sent when the communications slice lands (docs/18 R-5).
        if (payload?.IncomingId is not null)
            log.LogInformation("SMS reply from {From} (event {EventId}, reference {Reference}, opt-out {OptOut})",
                MobileNumber.Mask(payload.SourcePhoneNumber ?? ""), payload.EventId, payload.CustomerId, payload.OptOut == true);
        else
            log.LogInformation("SMS delivery report: {Status} for {To} (event {EventId}, reference {Reference})",
                payload?.Status, MobileNumber.Mask(payload?.PhoneNumber ?? ""), payload?.EventId, payload?.CustomerId);
        return Results.Ok();
    }
}
