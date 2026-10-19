using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Humo.Infrastructure.Messaging;

/// <summary>
/// SMSSouthAfrica's settings (its platform is MyMobileAPI: https://mymobileapi.readme.io).
/// Configuration: <c>Sms__SmsSouthAfrica__ClientId</c>, <c>__ApiSecret</c>, … Secrets live in the
/// server's .env, never in git (doc 26 §2).
/// </summary>
public sealed class SmsSouthAfricaOptions
{
    public const string Section = "Sms:SmsSouthAfrica";

    public string BaseUrl { get; set; } = "https://rest.mymobileapi.com";
    /// <summary>The API key's Client ID (Settings › API Keys in their control panel).</summary>
    public string? ClientId { get; set; }
    /// <summary>The API key's secret. Shown once when the key is created.</summary>
    public string? ApiSecret { get; set; }
    /// <summary>True: the API answers as if it sent, but nothing reaches a phone and nothing is charged.</summary>
    public bool TestMode { get; set; }
    /// <summary>For their reports, e.g. "Humo Property Management". At most 100 characters.</summary>
    public string? CampaignName { get; set; } = "Humo Property Management";
    /// <summary>Hours the networks keep trying to deliver. Null: the provider's default.</summary>
    public int? ValidityHours { get; set; }
    /// <summary>
    /// The webhook signature secret (Settings › Webhooks › Activate Signatures), base64 as shown.
    /// Without it, delivery reports are refused: an unsigned report could be forged.
    /// </summary>
    public string? WebhookSecret { get; set; }
}

/// <summary>
/// Sends through SMSSouthAfrica's REST API (MyMobileAPI v3, POST /v3/BulkMessages) with Basic
/// authentication (Client ID and API secret). Numbers are sent in international form (27…).
/// </summary>
public sealed class SmsSouthAfricaSender(IHttpClientFactory http, IOptions<SmsSouthAfricaOptions> options, IOptions<SmsOptions> sms, ILogger<SmsSouthAfricaSender> logger) : ISmsSender
{
    public const string HttpClientName = "SmsSouthAfrica";

    public string Name => "SmsSouthAfrica";

    public async Task<SmsReceipt> SendAsync(SmsMessage message, CancellationToken ct = default)
    {
        var o = options.Value;
        if (string.IsNullOrWhiteSpace(o.ClientId) || string.IsNullOrWhiteSpace(o.ApiSecret))
            throw new InvalidOperationException("SMSSouthAfrica needs Sms:SmsSouthAfrica:ClientId and ApiSecret (doc 26 §2).");

        if (!MobileNumber.TryNormalise(message.To, out var destination))
            return new SmsReceipt(Name, null, Accepted: false, Error: "That isn't a mobile number we can send to.");

        var senderId = sms.Value.SenderId is { Length: > 0 } id ? id[..Math.Min(id.Length, 11)] : null;
        var body = new SendRequest(
            [new MessageDto(destination, message.Text, message.Reference is { } r ? r[..Math.Min(r.Length, 100)] : null)],
            new SendOptionsDto(senderId, o.CampaignName, o.ValidityHours, o.TestMode ? true : null));

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{o.BaseUrl.TrimEnd('/')}/v3/BulkMessages") { Content = JsonContent.Create(body) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{o.ClientId}:{o.ApiSecret}")));

        using var response = await http.CreateClient(HttpClientName).SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            var error = response.StatusCode == System.Net.HttpStatusCode.Unauthorized
                ? "SMSSouthAfrica refused the API key (check the Client ID and secret)."
                : $"SMSSouthAfrica answered {(int)response.StatusCode}.";
            logger.LogError("SMS to {To} not sent: {Error}", MobileNumber.Mask(destination), error);
            return new SmsReceipt(Name, null, Accepted: false, Error: error);
        }

        var result = await response.Content.ReadFromJsonAsync<SendResult>(ct);
        var sent = result?.SendResponse;
        var fault = sent?.ErrorReport?.Faults?.FirstOrDefault()?.ErrorMessage ?? result?.Errors?.FirstOrDefault()?.ErrorMessage;
        var accepted = sent is { Messages: > 0 } && fault is null;
        var eventId = sent?.EventId.ToString(CultureInfo.InvariantCulture);

        if (accepted)
            logger.LogInformation("SMS to {To} accepted by SMSSouthAfrica (event {EventId}, {Parts} part(s){Test})", MobileNumber.Mask(destination), eventId, sent!.Parts, o.TestMode ? ", test mode" : "");
        else
            logger.LogError("SMS to {To} not accepted by SMSSouthAfrica: {Fault}", MobileNumber.Mask(destination), fault ?? "no message was queued");
        return new SmsReceipt(Name, eventId, accepted, accepted ? null : fault ?? "The message wasn't queued.");
    }

    // ---- MyMobileAPI v3 request and response (only the fields Humo uses) ----

    private sealed record SendRequest(IReadOnlyList<MessageDto> Messages, SendOptionsDto SendOptions);

    private sealed record MessageDto(string Destination, string Content, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? CustomerId);

    private sealed record SendOptionsDto(
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? SenderId,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? CampaignName,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? ValidityPeriod,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] bool? TestMode);

    private sealed record SendResult(int StatusCode, List<SendingError>? Errors, SendResponseDto? SendResponse);

    private sealed record SendingError(string? ErrorMessage, string? ErrorCode);

    private sealed record SendResponseDto(long EventId, int Messages, int Parts, double Cost, double RemainingBalance, FaultReport? ErrorReport);

    private sealed record FaultReport(List<Fault>? Faults);

    private sealed record Fault(string? RawDestination, string? CustomerId, string? ErrorMessage, string? Status);
}

/// <summary>South African mobile numbers as people write them, in the international form providers expect.</summary>
public static class MobileNumber
{
    /// <summary>"082 123 4567", "+27 82 123 4567", "0027821234567" → "27821234567". Other countries keep their code.</summary>
    public static bool TryNormalise(string? input, out string msisdn)
    {
        msisdn = "";
        if (string.IsNullOrWhiteSpace(input)) return false;
        var digits = new string(input.Where(char.IsDigit).ToArray());
        var international = input.TrimStart().StartsWith('+');
        if (!international && digits.StartsWith("00")) { digits = digits[2..]; international = true; }
        if (!international && digits.StartsWith('0')) digits = "27" + digits[1..];
        // South African mobiles: 27 + 9 digits starting 6, 7 or 8. Elsewhere: 8–15 digits (E.164).
        var ok = digits.StartsWith("27") ? digits.Length == 11 && digits[2] is '6' or '7' or '8' : digits.Length is >= 8 and <= 15 && international;
        if (ok) msisdn = digits;
        return ok;
    }

    /// <summary>For logs (POPIA): 27821234567 → 2782***4567.</summary>
    public static string Mask(string msisdn) => msisdn.Length > 8 ? msisdn[..4] + "***" + msisdn[^4..] : "***";
}

/// <summary>
/// Checks a webhook really came from SMSSouthAfrica (MyMobileAPI webhook signatures):
/// <c>SmsWebhookEngine-Signature: v1,hmac_sha256=&lt;HEX&gt;</c> over
/// <c>v1:{timestamp}|{METHOD}|{url}|{rawBody}</c>, keyed with the base64 secret.
/// </summary>
public static class SmsWebhookSignature
{
    public const string SignatureHeader = "SmsWebhookEngine-Signature";
    public const string TimestampHeader = "SmsWebhookEngine-Timestamp";
    private const string Prefix = "v1,hmac_sha256=";

    /// <summary>Old reports are refused, so a captured one can't be replayed later.</summary>
    public static readonly TimeSpan Tolerance = TimeSpan.FromMinutes(5);

    public static string Sign(string base64Secret, string timestamp, string method, string url, string rawBody)
    {
        var canonical = $"v1:{timestamp}|{method.ToUpperInvariant()}|{url}|{rawBody}";
        return Prefix + Convert.ToHexString(HMACSHA256.HashData(Convert.FromBase64String(base64Secret), Encoding.UTF8.GetBytes(canonical)));
    }

    public static bool IsValid(string? base64Secret, string? signature, string? timestamp, string method, string url, string rawBody, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(base64Secret) || signature is null || !signature.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase)) return false;
        if (!long.TryParse(timestamp, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds)) return false;
        if ((now - DateTimeOffset.FromUnixTimeSeconds(seconds)).Duration() > Tolerance) return false;

        string expected;
        try { expected = Sign(base64Secret, timestamp!, method, url, rawBody); }
        catch (FormatException) { return false; }
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected.ToUpperInvariant()), Encoding.ASCII.GetBytes(signature.ToUpperInvariant()));
    }
}
