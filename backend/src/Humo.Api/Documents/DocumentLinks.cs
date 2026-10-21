using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Humo.Api.Audit;
using Humo.Api.Auth;
using Humo.Api.Commands;
using Humo.Api.Finance;
using Humo.Api.Messaging;
using Humo.Api.Settings;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Documents;

public sealed record DocumentLinkDto(string Kind, string Title, string SchemeName, string AgencyName, string? CodeChannel, string? CodeSentTo, string ExpiresAt);
public sealed record CodeSentDto(string Channel, string SentTo);
public sealed record VerifyCodeRequest(string? Code);
public sealed record GrantDto(string Grant, string ExpiresAt);

/// <summary>
/// Secure links to issued statements (docs/18 R-1): an owner opens their statement from the email without a
/// Humo PM account. The link alone shows nothing personal: a one-time code goes to the mobile on record (SMS,
/// counted in the agency's monthly SMS), or to their email when there's no mobile. A correct code gives a
/// 30-minute viewing grant. Links last 90 days.
/// </summary>
public sealed class DocumentLinks(HumoDbContext db, ISmsSender sms, IEmailSender email, MessageUsage usage, SentRecords sent, AuditLog audit,
    IOptions<AppOptions> app, TimeProvider clock, ILogger<DocumentLinks> logger)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(90);
    public static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan GrantLifetime = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan ResendAfter = TimeSpan.FromMinutes(1);
    public const int MaxAttempts = 5;
    public const int MaxCodesPerDay = 5;
    public const string GrantHeader = "X-Document-Grant";

    private DateTimeOffset Now => clock.GetUtcNow();
    private string Today => Now.ToOffset(TimeSpan.FromHours(2)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>A new link to an issued statement for its holder. Returns the address to put in the email; save changes to keep it.</summary>
    public string Create(IssuedStatement statement, Guid personId)
    {
        var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        db.DocumentLinks.Add(new DocumentLink
        {
            Id = Guid.CreateVersion7(), OrganisationId = statement.OrganisationId, SchemeId = statement.SchemeId, Kind = "statement", DocumentId = statement.Id, PersonId = personId,
            TokenHash = Hash(token), CreatedAt = Now, ExpiresAt = Now + Lifetime,
        });
        return $"{app.Value.PublicUrl.TrimEnd('/')}/d/{token}";
    }

    public static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public Task<DocumentLink?> FindAsync(string token, CancellationToken ct)
    {
        var hash = Hash(token);
        return db.DocumentLinks.FirstOrDefaultAsync(l => l.TokenHash == hash, ct);
    }

    public bool Expired(DocumentLink link) => link.RevokedAt is not null || link.ExpiresAt <= Now;

    /// <summary>Where a code would go: the mobile on record, else the email address. Null when there's neither.</summary>
    public static (string Channel, string Address)? Destination(Person p) =>
        MobileNumber.TryNormalise(p.Phone, out var msisdn) ? ("sms", msisdn)
        : SettingsEndpoints.IsEmail(p.Email) ? ("email", p.Email.Trim())
        : null;

    /// <summary>"the number ending 0274" or "s•••@mail.example": enough to recognise, not enough to learn.</summary>
    public static string Masked(string channel, string address)
    {
        if (channel == "sms") return $"the number ending {address[^4..]}";
        var at = address.IndexOf('@');
        return at <= 0 ? "your email" : $"{address[0]}•••{address[at..]}";
    }

    public async Task<DocumentLinkDto> ViewAsync(DocumentLink link, CancellationToken ct)
    {
        var statement = await db.IssuedStatements.AsNoTracking().Where(s => s.Id == link.DocumentId).Select(s => s.Period).FirstAsync(ct);
        var scheme = await db.Schemes.AsNoTracking().FirstAsync(s => s.Id == link.SchemeId, ct);
        var org = await db.Organisations.AsNoTracking().FirstAsync(o => o.Id == link.OrganisationId, ct);
        var person = await db.People.AsNoTracking().FirstAsync(p => p.Id == link.PersonId, ct);
        var to = Destination(person);
        return new DocumentLinkDto(link.Kind, $"Levy statement · {StatementService.PeriodLabel(statement)}", scheme.Name, org.Name, to?.Channel,
            to is { } d ? Masked(d.Channel, d.Address) : null, link.ExpiresAt.ToString("O"));
    }

    /// <summary>Sends a new one-time code. Refused (a policy reason) when asked again too soon, too often in a day, or when there's nowhere to send it.</summary>
    public async Task<(CodeSentDto? Sent, string? Refused)> SendCodeAsync(DocumentLink link, CancellationToken ct)
    {
        if (link.CodeSentAt is { } last && Now - last < ResendAfter) return (null, "Wait a minute before asking for another code.");
        if (link.CodesDay == Today && link.CodesToday >= MaxCodesPerDay) return (null, "That’s the most codes for today. Try again tomorrow, or contact your managing agent.");
        var person = await db.People.AsNoTracking().FirstAsync(p => p.Id == link.PersonId, ct);
        if (Destination(person) is not { } to) return (null, "There’s no mobile number or email address on record to send a code to. Contact your managing agent.");
        var scheme = await db.Schemes.AsNoTracking().FirstAsync(s => s.Id == link.SchemeId, ct);
        var org = await db.Organisations.AsNoTracking().FirstAsync(o => o.Id == link.OrganisationId, ct);

        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", CultureInfo.InvariantCulture);
        var text = $"{code} is your code to open your {scheme.Name} levy statement from {org.ShortName}. It expires in 10 minutes. Never share it.";
        var channel = to.Channel;
        if (channel == "sms")
        {
            var receipt = await sms.SendAsync(new SmsMessage(to.Address, text, link.Id.ToString("N")), ct);
            if (receipt.Accepted) await usage.RecordAsync(link.OrganisationId, "sms", MessageUsage.SmsUnits(text, receipt.Parts), ct);
            else if (SettingsEndpoints.IsEmail(person.Email))
            {
                // The SMS provider refused it: the email address on record is the fallback.
                logger.LogWarning("The SMS provider refused a document code for link {Id}: {Error}", link.Id, receipt.Error);
                to = ("email", person.Email.Trim());
                channel = "email";
            }
            else return (null, "We couldn’t send a code just now. Try again in a few minutes.");
        }
        if (channel == "email")
        {
            try
            {
                await email.SendAsync(new EmailMessage(to.Address, $"Your code to open your {scheme.Name} statement", $"""
                    Dear {person.DisplayName},

                    Your code to open your {scheme.Name} levy statement is:

                    {code}

                    It expires in 10 minutes. Never share it: {org.ShortName} will never ask you for it.

                    If you didn’t ask for this code, you can ignore this email.

                    {org.ShortName}
                    """), ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError(e, "The mail server didn’t accept a document code for link {Id}", link.Id);
                return (null, "We couldn’t send a code just now. Try again in a few minutes.");
            }
        }

        link.CodeHash = Hash($"{link.Id:N}:{code}");
        link.CodeExpiresAt = Now + CodeLifetime;
        link.CodeAttempts = 0;
        link.CodeSentAt = Now;
        link.CodesToday = link.CodesDay == Today ? link.CodesToday + 1 : 1;
        link.CodesDay = Today;
        audit.Record($"Sent a code to open a statement by {(channel == "sms" ? "SMS" : "email")}", "success", category: "security", organisationId: link.OrganisationId,
            schemeId: link.SchemeId, resource: "DocumentLink", resourceId: link.Id.ToString(), system: person.DisplayName);
        await db.SaveChangesAsync(ct);
        return (new CodeSentDto(channel, Masked(channel, to.Address)), null);
    }

    /// <summary>Checks a code. Right: a viewing grant, and the statement's delivery shows as read in Sent. Wrong: a reason the page shows.</summary>
    public async Task<(GrantDto? Grant, string? Failure, string? Message)> VerifyAsync(DocumentLink link, string? code, CancellationToken ct)
    {
        if (link.CodeHash is null || link.CodeExpiresAt is not { } expires || expires <= Now)
            return (null, "code-expired", "That code has expired. Ask for a new one.");
        if (link.CodeAttempts >= MaxAttempts) return (null, "too-many-attempts", "Too many wrong codes. Ask for a new one.");
        var given = new string((code ?? "").Where(char.IsDigit).ToArray());
        var right = CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash($"{link.Id:N}:{given}")), Encoding.ASCII.GetBytes(link.CodeHash));
        var person = await db.People.AsNoTracking().FirstAsync(p => p.Id == link.PersonId, ct);
        if (!right)
        {
            link.CodeAttempts++;
            audit.Record("Entered a wrong code for a statement link", "failure", category: "security", organisationId: link.OrganisationId, schemeId: link.SchemeId,
                resource: "DocumentLink", resourceId: link.Id.ToString(), system: person.DisplayName);
            await db.SaveChangesAsync(ct);
            var left = MaxAttempts - link.CodeAttempts;
            return left > 0 ? (null, "wrong-code", $"That code isn’t right. {left} {(left == 1 ? "try" : "tries")} left.") : (null, "too-many-attempts", "Too many wrong codes. Ask for a new one.");
        }

        var grant = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        link.CodeHash = null;
        link.CodeExpiresAt = null;
        link.GrantHash = Hash(grant);
        link.GrantExpiresAt = Now + GrantLifetime;
        link.FirstOpenedAt ??= Now;
        link.LastOpenedAt = Now;
        link.Opens++;
        // Opening it from the email tells us it arrived and was read.
        var delivery = (await db.Deliveries.Where(d => d.DocumentId == link.DocumentId && d.PersonId == link.PersonId && d.Channel == "email").ToListAsync(ct))
            .OrderByDescending(d => d.At).FirstOrDefault();
        if (delivery is { Status: "delivered" or "queued" }) sent.Mark(delivery, "read", null);
        audit.Record("Opened a statement by secure link", "success", category: "activity", organisationId: link.OrganisationId, schemeId: link.SchemeId,
            resource: "DocumentLink", resourceId: link.Id.ToString(), system: person.DisplayName);
        await db.SaveChangesAsync(ct);
        return (new GrantDto(grant, link.GrantExpiresAt.Value.ToString("O")), null, null);
    }

    public bool Granted(DocumentLink link, string? grant) =>
        !string.IsNullOrEmpty(grant) && link.GrantHash is { } hash && link.GrantExpiresAt > Now
        && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(grant)), Encoding.ASCII.GetBytes(hash));
}

/// <summary>The secure-link endpoints. No session: the link, then the code, then the grant are the only way in.</summary>
public static class DocumentLinkEndpoints
{
    public static void MapDocumentLinks(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/document-links/{token}").AllowAnonymous().RequireRateLimiting(RateLimits.DocumentLinks);
        g.MapGet("", Get);
        g.MapPost("/code", SendCode);
        g.MapPost("/verify", Verify);
        g.MapGet("/document", Document);
        g.MapGet("/pdf", Pdf);
    }

    private static IResult Failure(string code, string message, int status = StatusCodes.Status400BadRequest) =>
        Results.Problem(title: message, statusCode: status, extensions: new Dictionary<string, object?> { ["code"] = code });

    private static IResult Gone() => Failure("link-expired", "This link has expired. Sign in to Humo Property Management, or ask your managing agent to send the statement again.", StatusCodes.Status410Gone);

    private static async Task<IResult> Get(string token, DocumentLinks links, CancellationToken ct)
    {
        if (await links.FindAsync(token, ct) is not { } link) return Problems.NotFound();
        return links.Expired(link) ? Gone() : Results.Json(await links.ViewAsync(link, ct), Json.Options);
    }

    private static async Task<IResult> SendCode(string token, DocumentLinks links, CancellationToken ct)
    {
        if (await links.FindAsync(token, ct) is not { } link) return Problems.NotFound();
        if (links.Expired(link)) return Gone();
        var (sent, refused) = await links.SendCodeAsync(link, ct);
        return sent is not null ? Results.Json(sent, Json.Options) : Failure("code-refused", refused!, StatusCodes.Status429TooManyRequests);
    }

    private static async Task<IResult> Verify(string token, VerifyCodeRequest body, DocumentLinks links, CancellationToken ct)
    {
        if (await links.FindAsync(token, ct) is not { } link) return Problems.NotFound();
        if (links.Expired(link)) return Gone();
        var (grant, failure, message) = await links.VerifyAsync(link, body.Code, ct);
        return grant is not null ? Results.Json(grant, Json.Options) : Failure(failure!, message!);
    }

    /// <summary>The issued statement's snapshot, so the page draws it exactly as issued (as the print route does).</summary>
    private static async Task<IResult> Document(string token, HttpRequest request, DocumentLinks links, HumoDbContext db, CancellationToken ct)
    {
        if (await links.FindAsync(token, ct) is not { } link) return Problems.NotFound();
        if (links.Expired(link)) return Gone();
        if (!links.Granted(link, request.Headers[DocumentLinks.GrantHeader])) return Results.Unauthorized();
        var issued = await db.IssuedStatements.AsNoTracking().FirstAsync(s => s.Id == link.DocumentId, ct);
        return Results.Text(issued.Snapshot, "application/json", Encoding.UTF8);
    }

    private static async Task<IResult> Pdf(string token, HttpRequest request, DocumentLinks links, HumoDbContext db, StatementService statements, CancellationToken ct)
    {
        if (await links.FindAsync(token, ct) is not { } link) return Problems.NotFound();
        if (links.Expired(link)) return Gone();
        if (!links.Granted(link, request.Headers[DocumentLinks.GrantHeader])) return Results.Unauthorized();
        var issued = await db.IssuedStatements.FirstAsync(s => s.Id == link.DocumentId, ct);
        var accountNo = await db.LevyAccounts.Where(a => a.Id == issued.AccountId).Select(a => a.AccountNo).FirstAsync(ct);
        return Results.File(await statements.PdfAsync(issued, ct), "application/pdf", $"{accountNo}-{issued.Period}.pdf");
    }
}
