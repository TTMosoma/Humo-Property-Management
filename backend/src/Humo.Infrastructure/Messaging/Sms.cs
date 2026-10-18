using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Humo.Infrastructure.Messaging;

/// <summary>A text message to one South African mobile number.</summary>
public sealed record SmsMessage(string To, string Text);

/// <summary>The outcome the provider reports, kept for delivery results in Sent (docs/18 R-5).</summary>
public sealed record SmsReceipt(string Provider, string? ProviderMessageId, bool Accepted, string? Error = null);

/// <summary>
/// Sends SMS through whichever provider configuration names (<c>Sms__Provider</c>).
/// Each provider is one class implementing this; adding one never touches the code that sends.
/// </summary>
public interface ISmsSender
{
    /// <summary>The name used in configuration, e.g. <c>SmsSouthAfrica</c>.</summary>
    string Name { get; }
    Task<SmsReceipt> SendAsync(SmsMessage message, CancellationToken ct = default);
}

public sealed class SmsOptions
{
    public const string Section = "Sms";

    /// <summary><c>Log</c> (default: nothing is sent) or a provider name, e.g. <c>SmsSouthAfrica</c>.</summary>
    public string Provider { get; set; } = "Log";
    /// <summary>The sender name or number recipients see, where the provider and the networks allow it.</summary>
    public string? SenderId { get; set; } = "Humo";
    /// <summary>Provider settings by name, e.g. <c>Sms__Providers__SmsSouthAfrica__ApiKey</c>.</summary>
    public Dictionary<string, Dictionary<string, string>> Providers { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>Picks the configured provider. An unknown name fails at start-up, not at the first message.</summary>
public sealed class SmsGateway(IEnumerable<ISmsSender> senders, IOptions<SmsOptions> options)
{
    public ISmsSender Current
    {
        get
        {
            var name = options.Value.Provider;
            return senders.FirstOrDefault(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException($"Sms:Provider '{name}' isn't a known SMS provider. Known: {string.Join(", ", senders.Select(s => s.Name))}.");
        }
    }

    public Task<SmsReceipt> SendAsync(SmsMessage message, CancellationToken ct = default) => Current.SendAsync(message, ct);
}

/// <summary>Development and tests: writes the message to the log. Nothing is sent.</summary>
public sealed class LogSmsSender(ILogger<LogSmsSender> logger) : ISmsSender
{
    public string Name => "Log";

    public Task<SmsReceipt> SendAsync(SmsMessage message, CancellationToken ct = default)
    {
        logger.LogWarning("SMS NOT SENT (Sms:Provider=Log) to {To}: {Text}", message.To, message.Text);
        return Task.FromResult(new SmsReceipt(Name, null, Accepted: true));
    }
}

/// <summary>
/// SMSSouthAfrica (smssouthafrica.co.za): Humo's chosen SMS provider (D14).
/// Not wired yet: waiting for their API documentation. Selecting it before then
/// fails loudly rather than pretending to send.
/// </summary>
public sealed class SmsSouthAfricaSender(IOptions<SmsOptions> options) : ISmsSender
{
    public string Name => "SmsSouthAfrica";

    public Task<SmsReceipt> SendAsync(SmsMessage message, CancellationToken ct = default)
    {
        _ = options.Value.Providers.GetValueOrDefault(Name);
        throw new NotSupportedException("SMSSouthAfrica isn't wired yet: waiting for their API documentation (docs/25). Use Sms:Provider=Log until then.");
    }
}
