using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Humo.Infrastructure.Payments;

/// <summary>
/// Payfast (doc 17, D15). <c>Payments__Payfast__*</c>: in production the merchant ID, key and
/// passphrase from Payfast's dashboard (Settings › Integration). In sandbox mode the public sandbox
/// merchant is used instead, whatever live details are configured, so a test never reaches the live account.
/// </summary>
public sealed class PayfastOptions
{
    public const string Section = "Payments:Payfast";

    /// <summary>True: sandbox.payfast.co.za with the sandbox merchant. Production sets false.</summary>
    public bool Sandbox { get; set; } = true;
    public string? MerchantId { get; set; }
    public string? MerchantKey { get; set; }
    /// <summary>The "Salt Passphrase" set in Payfast's dashboard; it signs every request and notification.</summary>
    public string? Passphrase { get; set; }
    /// <summary>
    /// Payfast's public sandbox merchant (developers.payfast.co.za), not a secret. It has a passphrase Payfast
    /// doesn't publish, so signed checkouts are refused: for a full sandbox test, register a sandbox account at
    /// sandbox.payfast.co.za and set its merchant ID, key and passphrase here.
    /// </summary>
    public string SandboxMerchantId { get; set; } = "10000100";
    public string SandboxMerchantKey { get; set; } = "46f0cd694581a";
    public string? SandboxPassphrase { get; set; }
    /// <summary>Only accept notifications from Payfast's own servers (their documented host names).</summary>
    public bool CheckNotificationSource { get; set; } = true;

    public string Host => Sandbox ? "https://sandbox.payfast.co.za" : "https://www.payfast.co.za";
    public string? EffectiveMerchantId => Sandbox ? SandboxMerchantId : MerchantId;
    public string? EffectiveMerchantKey => Sandbox ? SandboxMerchantKey : MerchantKey;
    public string? EffectivePassphrase => Sandbox ? SandboxPassphrase : Passphrase;
}

/// <summary>Where the browser goes to pay: a form POST to Payfast with these fields (keeps the email address out of the URL).</summary>
public sealed record PayfastCheckout(string Action, IReadOnlyList<KeyValuePair<string, string>> Fields);

/// <summary>A notification (ITN), as Payfast posted it, in its order.</summary>
public sealed record PayfastNotification(IReadOnlyList<KeyValuePair<string, string>> Fields)
{
    public string? this[string key] => Fields.FirstOrDefault(f => f.Key == key).Value;
}

public interface IPayfast
{
    bool Configured { get; }
    bool Sandbox { get; }
    PayfastCheckout Checkout(string paymentId, decimal amount, string itemName, string? itemDescription, string? email, string returnUrl, string cancelUrl, string notifyUrl, string invoiceId);
    /// <summary>
    /// Is the notification genuine? Its signature, where it came from, and Payfast's own confirmation
    /// (<c>/eng/query/validate</c>). The caller still checks the amount against the invoice.
    /// </summary>
    Task<string?> VerifyAsync(PayfastNotification n, IPAddress? from, CancellationToken ct);
}

/// <summary>Payfast's custom integration: signed checkout fields, and notification checks as their documentation sets out.</summary>
public sealed class PayfastClient(IOptions<PayfastOptions> options, IHttpClientFactory http, ILogger<PayfastClient> logger) : IPayfast
{
    public const string HttpClientName = "payfast";
    private static readonly string[] ProductionHosts = ["www.payfast.co.za", "w1w.payfast.co.za", "w2w.payfast.co.za"];
    private static readonly string[] SandboxHosts = ["sandbox.payfast.co.za"];

    public bool Configured => !string.IsNullOrWhiteSpace(options.Value.EffectiveMerchantId) && !string.IsNullOrWhiteSpace(options.Value.EffectiveMerchantKey);
    public bool Sandbox => options.Value.Sandbox;

    public PayfastCheckout Checkout(string paymentId, decimal amount, string itemName, string? itemDescription, string? email, string returnUrl, string cancelUrl, string notifyUrl, string invoiceId)
    {
        var o = options.Value;
        // Payfast's field order matters for the signature.
        var fields = new List<KeyValuePair<string, string>>
        {
            new("merchant_id", o.EffectiveMerchantId!),
            new("merchant_key", o.EffectiveMerchantKey!),
            new("return_url", returnUrl),
            new("cancel_url", cancelUrl),
            new("notify_url", notifyUrl),
        };
        if (!string.IsNullOrWhiteSpace(email)) fields.Add(new("email_address", email.Trim()));
        fields.Add(new("m_payment_id", paymentId));
        fields.Add(new("amount", amount.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture)));
        fields.Add(new("item_name", Truncate(itemName, 100)));
        if (!string.IsNullOrWhiteSpace(itemDescription)) fields.Add(new("item_description", Truncate(itemDescription, 255)));
        fields.Add(new("custom_str1", invoiceId));
        fields.Add(new("signature", Signature(fields, o.EffectivePassphrase)));
        return new PayfastCheckout($"{o.Host}/eng/process", fields);
    }

    public async Task<string?> VerifyAsync(PayfastNotification n, IPAddress? from, CancellationToken ct)
    {
        var o = options.Value;
        var data = n.Fields.Where(f => f.Key != "signature").ToList();
        if (!string.Equals(Signature(data, o.EffectivePassphrase), n["signature"], StringComparison.OrdinalIgnoreCase)) return "The signature doesn't match";
        if (n["merchant_id"] != o.EffectiveMerchantId) return "Not for Humo's merchant account";
        if (o.CheckNotificationSource && !await FromPayfast(from, ct)) return "Not sent from Payfast's servers";
        try
        {
            var client = http.CreateClient(HttpClientName);
            using var res = await client.PostAsync($"{o.Host}/eng/query/validate",
                new StringContent(ParamString(data), Encoding.UTF8, "application/x-www-form-urlencoded"), ct);
            var body = (await res.Content.ReadAsStringAsync(ct)).Trim();
            return body == "VALID" ? null : $"Payfast didn't confirm it ({body})";
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(e, "Couldn't reach Payfast to confirm a notification");
            return "Couldn't reach Payfast to confirm it";
        }
    }

    private async Task<bool> FromPayfast(IPAddress? from, CancellationToken ct)
    {
        if (from is null) return false;
        if (from.IsIPv4MappedToIPv6) from = from.MapToIPv4();
        foreach (var host in options.Value.Sandbox ? SandboxHosts : ProductionHosts)
        {
            try
            {
                if ((await Dns.GetHostAddressesAsync(host, ct)).Any(a => a.Equals(from))) return true;
            }
            catch (System.Net.Sockets.SocketException e)
            {
                logger.LogWarning(e, "Couldn't resolve {Host}", host);
            }
        }
        return false;
    }

    /// <summary>MD5 of the non-empty fields in order, URL-encoded as PHP's urlencode does, then the passphrase.</summary>
    public static string Signature(IEnumerable<KeyValuePair<string, string>> fields, string? passphrase)
    {
        var s = ParamString(fields);
        if (!string.IsNullOrWhiteSpace(passphrase)) s += "&passphrase=" + Encode(passphrase.Trim());
        return Convert.ToHexStringLower(MD5.HashData(Encoding.UTF8.GetBytes(s)));
    }

    public static string ParamString(IEnumerable<KeyValuePair<string, string>> fields) =>
        string.Join("&", fields.Where(f => !string.IsNullOrEmpty(f.Value)).Select(f => $"{f.Key}={Encode(f.Value.Trim())}"));

    /// <summary>PHP urlencode: letters, digits and <c>-_.</c> stay; a space is <c>+</c>; everything else is %XX (upper case) of its UTF-8 bytes.</summary>
    public static string Encode(string value)
    {
        var sb = new StringBuilder();
        foreach (var b in Encoding.UTF8.GetBytes(value))
        {
            var c = (char)b;
            if (char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.') sb.Append(c);
            else if (c == ' ') sb.Append('+');
            else sb.Append('%').Append(b.ToString("X2"));
        }
        return sb.ToString();
    }

    /// <summary>Reads a form-encoded body in its order (a dictionary would lose it, and the signature depends on it).</summary>
    public static PayfastNotification Parse(string body) =>
        new(body.Split('&', StringSplitOptions.RemoveEmptyEntries).Select(pair =>
        {
            var i = pair.IndexOf('=');
            var key = WebUtility.UrlDecode(i < 0 ? pair : pair[..i]);
            var value = i < 0 ? "" : WebUtility.UrlDecode(pair[(i + 1)..]);
            return new KeyValuePair<string, string>(key, value);
        }).ToList());

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
