using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MimeKit;

namespace Humo.Infrastructure.Messaging;

public sealed record EmailMessage(string To, string Subject, string Text, string? Html = null);

/// <summary>Sends email. Which server, port and encryption is configuration (<c>Mail__*</c>, doc 25 §2), never code.</summary>
public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken ct = default);
}

public enum MailSecurity
{
    /// <summary>Port 587: plain connection upgraded to TLS. Recommended.</summary>
    StartTls,
    /// <summary>Port 465: TLS from the start.</summary>
    SslOnConnect,
    /// <summary>No encryption. Only for a mail server on the same machine or a development catcher (Mailpit).</summary>
    None,
}

public sealed class MailOptions
{
    public const string Section = "Mail";

    /// <summary><c>Smtp</c> (default) or <c>Log</c> (writes the message to the log; development and tests only).</summary>
    public string Provider { get; set; } = "Smtp";
    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 587;
    public MailSecurity Security { get; set; } = MailSecurity.StartTls;
    public string? Username { get; set; }
    public string? Password { get; set; }
    public string From { get; set; } = "Humo Property Management <no-reply@notify.humo.co.za>";
    public string? ReplyTo { get; set; } = "support@humo.co.za";
    /// <summary>The fallback relay (doc 25 §2, step 5): switched on by configuration only, when inbox placement fails.</summary>
    public RelayOptions Relay { get; set; } = new();

    public sealed class RelayOptions
    {
        public bool Enabled { get; set; }
        public string? Host { get; set; }
        public int Port { get; set; } = 587;
        public MailSecurity Security { get; set; } = MailSecurity.StartTls;
        public string? Username { get; set; }
        public string? Password { get; set; }
    }
}

/// <summary>SMTP through MailKit: our own mail server (notify.humo.co.za), or the fallback relay when it's switched on.</summary>
public sealed class SmtpEmailSender(IOptions<MailOptions> options, ILogger<SmtpEmailSender> logger) : IEmailSender
{
    public async Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        var o = options.Value;
        var mime = new MimeMessage();
        mime.From.Add(MailboxAddress.Parse(o.From));
        if (!string.IsNullOrWhiteSpace(o.ReplyTo)) mime.ReplyTo.Add(MailboxAddress.Parse(o.ReplyTo));
        mime.To.Add(MailboxAddress.Parse(message.To));
        mime.Subject = message.Subject;
        mime.Body = new BodyBuilder { TextBody = message.Text, HtmlBody = message.Html }.ToMessageBody();

        var (host, port, security, user, password) = o.Relay.Enabled && !string.IsNullOrWhiteSpace(o.Relay.Host)
            ? (o.Relay.Host!, o.Relay.Port, o.Relay.Security, o.Relay.Username, o.Relay.Password)
            : (o.Host, o.Port, o.Security, o.Username, o.Password);

        using var client = new SmtpClient();
        await client.ConnectAsync(host, port, security switch
        {
            MailSecurity.SslOnConnect => SecureSocketOptions.SslOnConnect,
            MailSecurity.None => SecureSocketOptions.None,
            _ => SecureSocketOptions.StartTls,
        }, ct);
        if (!string.IsNullOrEmpty(user)) await client.AuthenticateAsync(user, password ?? "", ct);
        await client.SendAsync(mime, ct);
        await client.DisconnectAsync(true, ct);
        logger.LogInformation("Email sent to {To} via {Host}:{Port}: {Subject}", Mask(message.To), host, port, message.Subject);
    }

    /// <summary>Logs never hold a full address (POPIA): t***@example.com.</summary>
    internal static string Mask(string email) => email.IndexOf('@') is > 0 and var at ? email[0] + "***" + email[at..] : "***";
}

/// <summary>Development and tests: writes the message to the log instead of sending it.</summary>
public sealed class LogEmailSender(ILogger<LogEmailSender> logger) : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        logger.LogWarning("EMAIL NOT SENT (Mail:Provider=Log) to {To}: {Subject}\n{Text}", message.To, message.Subject, message.Text);
        return Task.CompletedTask;
    }
}
