using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Humo.Domain.Commercial;
using Humo.Domain.Documents;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Messaging;

/// <summary>
/// Signs the emails an agency sends to owners and tenants: the sender's own sign-off (name, role, direct line) when a
/// person sent it, then the agency's signature under its wordmark in its brand colour (Settings › Documents). Sent as a
/// formatted email with the plain text alongside, for mail apps that only read text.
/// </summary>
public sealed partial class EmailSignatures(HumoDbContext db)
{
    public const int MaxSignature = 600;
    public const int MaxSignOff = 300;
    public const int MaxLines = 8;

    private const string DefaultColour = "#0a2a5c";

    public async Task<EmailMessage> SignAsync(EmailMessage message, Guid organisationId, Guid? senderUserId, CancellationToken ct)
    {
        var agency = await db.AgencySettings.AsNoTracking().Where(s => s.OrganisationId == organisationId).Select(s => s.EmailSignature).FirstOrDefaultAsync(ct);
        var signOff = senderUserId is { } user
            ? await db.PersonalPreferences.AsNoTracking().Where(p => p.UserId == user).Select(p => p.EmailSignOff).FirstOrDefaultAsync(ct)
            : null;
        var json = await db.DocumentSettings.AsNoTracking().Where(d => d.OrganisationId == organisationId).Select(d => d.BrandingJson).FirstOrDefaultAsync(ct);
        var branding = json is null ? null : JsonSerializer.Deserialize<AgencyBranding>(json, Json.Options);
        return Sign(message, signOff, agency, branding?.Logo?.Text, branding?.Palette.Primary);
    }

    /// <summary>The email with the signature added. Unchanged when there's nothing to add.</summary>
    public static EmailMessage Sign(EmailMessage m, string? signOff, string? signature, string? wordmark, string? colour)
    {
        signOff = Clean(signOff);
        signature = Clean(signature);
        wordmark = Clean(wordmark);
        if (signOff is null && signature is null && wordmark is null) return m;

        var text = new StringBuilder(m.Text.TrimEnd());
        if (signOff is not null) text.Append("\n\n").Append(signOff);
        if (signature is not null || wordmark is not null)
        {
            text.Append("\n\n-- ");
            if (wordmark is not null) text.Append('\n').Append(wordmark);
            if (signature is not null) text.Append('\n').Append(signature);
        }

        var tint = colour is not null && HexColour().IsMatch(colour) ? colour : DefaultColour;
        var html = new StringBuilder("<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2933\">");
        html.Append(m.Html ?? Paragraphs(m.Text.TrimEnd()));
        if (signOff is not null) html.Append("<p style=\"margin:16px 0 0\">").Append(Lines(signOff)).Append("</p>");
        if (signature is not null || wordmark is not null)
        {
            html.Append("<div style=\"margin-top:20px;padding-top:12px;border-top:1px solid #e3e6ea\">");
            if (wordmark is not null) html.Append("<div style=\"font-size:18px;font-weight:700;color:").Append(tint).Append("\">").Append(WebUtility.HtmlEncode(wordmark)).Append("</div>");
            if (signature is not null) html.Append("<div style=\"font-size:13px;color:#5b6670\">").Append(Lines(signature)).Append("</div>");
            html.Append("</div>");
        }
        html.Append("</div>");
        return m with { Text = text.ToString(), Html = html.ToString() };
    }

    /// <summary>Trimmed, with blank lines and trailing spaces gone; null when empty.</summary>
    public static string? Clean(string? s)
    {
        var lines = (s ?? "").Replace("\r", "").Split('\n').Select(l => l.TrimEnd()).Where(l => l.Length > 0).ToList();
        return lines.Count == 0 ? null : string.Join('\n', lines);
    }

    /// <summary>Why a signature or sign-off can't be saved, or null.</summary>
    public static string? Check(string? s, int max) =>
        (s ?? "").Length > max ? $"Keep it under {max} characters."
        : (Clean(s)?.Split('\n').Length ?? 0) > MaxLines ? $"Keep it to {MaxLines} lines or fewer."
        : null;

    private static string Paragraphs(string text) =>
        string.Concat(text.Replace("\r", "").Split("\n\n").Select(p => $"<p style=\"margin:0 0 12px\">{Lines(p)}</p>"));

    /// <summary>Encoded, with line breaks kept and web addresses as links.</summary>
    private static string Lines(string text) =>
        string.Join("<br>", text.Split('\n').Select(l => Link().Replace(WebUtility.HtmlEncode(l), m => $"<a href=\"{m.Value}\" style=\"color:#1d63a8\">{m.Value}</a>")));

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex HexColour();

    [GeneratedRegex(@"https?://[^\s<>""]+")]
    private static partial Regex Link();
}
