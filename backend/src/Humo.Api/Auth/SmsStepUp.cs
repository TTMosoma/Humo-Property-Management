using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Humo.Api.Audit;
using Humo.Api.Commands;
using Humo.Api.Messaging;
using Humo.Api.Platform;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Auth;

public sealed record MobileDto(string? Mobile, bool Verified, bool HasPasskey);
public sealed record MobileCodeRequest(string? Mobile);
public sealed record SmsCodeRequest(string? Code);
public sealed record SmsSentDto(string SentTo);

/// <summary>
/// D26: confirming it's you without a passkey to hand, e.g. on a public computer. A code by SMS to the person's own
/// confirmed mobile stands in for the passkey, for approvals only: everything else (bank details, access, security)
/// still needs a passkey, and it never applies while impersonating. Every use is flagged in the audit log, and the
/// person and the agency's administrators are told at once.
///
/// The mobile is the person's own (My profile), confirmed by a code to it. Once they have a passkey, adding or
/// changing it needs that passkey, so someone who only gets into their email can't add their own number.
/// </summary>
public static class SmsStepUp
{
    public static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan ResendAfter = TimeSpan.FromMinutes(1);
    public const int MaxAttempts = 5;
    public const int MaxCodesPerDay = 5;
    private const string Mobile = "mobile";
    private const string StepUp = "step-up";

    public static void MapSmsStepUp(this IEndpointRouteBuilder api)
    {
        var me = api.MapGroup("/me").RequireAuthorization();
        me.MapGet("/mobile", Get);
        me.MapPost("/mobile/code", SendMobileCode);
        me.MapPost("/mobile/verify", VerifyMobile);
        me.MapPost("/mobile/remove", RemoveMobile);
        me.MapPost("/step-up/sms", SendStepUpCode);
        me.MapPost("/step-up/sms/verify", VerifyStepUp);
    }

    private static string Today(TimeProvider clock) => clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    private static string Hash(Guid userId, string purpose, string code) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{userId:N}:{purpose}:{code}")));
    private static string Ending(string msisdn) => $"the number ending {msisdn[^4..]}";

    private static IResult Refused(string code, string message, int status = StatusCodes.Status400BadRequest) =>
        Results.Problem(title: message, statusCode: status, extensions: new Dictionary<string, object?> { ["code"] = code });

    private static async Task<IResult> Get(CurrentActor current, UserManager<HumoUser> users, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var me = actor.Human;
        var verified = me.PhoneNumberConfirmed && MobileNumber.TryNormalise(me.PhoneNumber, out _);
        return Results.Ok(new MobileDto(verified ? Ending(me.PhoneNumber!) : null, verified, (await users.GetPasskeysAsync(me)).Count > 0));
    }

    /// <summary>Sends a code (rate-limited, counted in the agency's SMS) and keeps its hash. Returns the code's row when sent, else the refusal.</summary>
    private static async Task<(SmsCode? Row, string? Refused)> SendAsync(HumoDbContext db, ISmsSender sms, MessageUsage usage, TimeProvider clock, Actor actor, string purpose, string to, string text,
        CancellationToken ct)
    {
        var me = actor.Human;
        var now = clock.GetUtcNow();
        var row = await db.SmsCodes.FirstOrDefaultAsync(c => c.UserId == me.Id && c.Purpose == purpose, ct);
        if (row?.SentAt is { } last && now - last < ResendAfter) return (null, "Wait a minute before asking for another code.");
        if (row is { } r && r.CodesDay == Today(clock) && r.CodesToday >= MaxCodesPerDay) return (null, "That’s the most codes for today. Use your passkey, or try again tomorrow.");
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", CultureInfo.InvariantCulture);
        var message = string.Format(CultureInfo.InvariantCulture, text, code);
        var receipt = await sms.SendAsync(new SmsMessage(to, message, $"{me.Id:N}-{purpose}"), ct);
        if (!receipt.Accepted) return (null, "The SMS couldn’t be sent just now. Try again in a few minutes, or use your passkey.");
        if (actor.OrganisationId is { } org) await usage.RecordAsync(org, "sms", MessageUsage.SmsUnits(message, receipt.Parts), ct);
        if (row is null) db.SmsCodes.Add(row = new SmsCode { UserId = me.Id, Purpose = purpose });
        row.CodeHash = Hash(me.Id, purpose, code);
        row.ExpiresAt = now + CodeLifetime;
        row.Attempts = 0;
        row.SentAt = now;
        row.CodesToday = row.CodesDay == Today(clock) ? row.CodesToday + 1 : 1;
        row.CodesDay = Today(clock);
        return (row, null);
    }

    /// <summary>Checks a code; right once only. Returns the row when right, else the refusal (code, message).</summary>
    private static async Task<(SmsCode? Row, string? Code, string? Message)> CheckAsync(HumoDbContext db, TimeProvider clock, Guid userId, string purpose, string? given,
        CancellationToken ct)
    {
        var row = await db.SmsCodes.FirstOrDefaultAsync(c => c.UserId == userId && c.Purpose == purpose, ct);
        if (row?.CodeHash is null || row.ExpiresAt is not { } expires || expires <= clock.GetUtcNow()) return (null, "code-expired", "That code has expired. Ask for a new one.");
        if (row.Attempts >= MaxAttempts) return (null, "too-many-attempts", "Too many wrong codes. Ask for a new one.");
        var digits = new string((given ?? "").Where(char.IsDigit).ToArray());
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(userId, purpose, digits)), Encoding.ASCII.GetBytes(row.CodeHash)))
        {
            row.Attempts++;
            await db.SaveChangesAsync(ct);
            var left = MaxAttempts - row.Attempts;
            return left > 0 ? (null, "wrong-code", $"That code isn’t right. {left} {(left == 1 ? "try" : "tries")} left.") : (null, "too-many-attempts", "Too many wrong codes. Ask for a new one.");
        }
        row.CodeHash = null;
        row.ExpiresAt = null;
        return (row, null, null);
    }

    /// <summary>Once they have a passkey, their mobile changes only with it (a fresh passkey, never an SMS code).</summary>
    private static async Task<bool> PasskeyNeeded(Actor actor, UserManager<HumoUser> users, TimeProvider clock) =>
        (await users.GetPasskeysAsync(actor.Human)).Count > 0 && !(actor.StepUpAt is { } at && clock.GetUtcNow() - at < CommandRunner.StepUpFresh);

    private static async Task<IResult> SendMobileCode(MobileCodeRequest body, CurrentActor current, UserManager<HumoUser> users, HumoDbContext db, ISmsSender sms,
        MessageUsage usage, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.Impersonation is not null) return Refused("impersonating", "Only the person themselves can set their mobile number.", StatusCodes.Status403Forbidden);
        if (!MobileNumber.TryNormalise(body.Mobile, out var msisdn))
            return Problems.Validation(new() { ["mobile"] = "A mobile number, e.g. 082 123 4567." });
        if (await PasskeyNeeded(actor, users, clock)) return Problems.Policy("step-up-required", CommandRunner.StepUpTitle);
        var (row, refused) = await SendAsync(db, sms, usage, clock, actor, Mobile, msisdn,
            "{0} is your Humo code to confirm this mobile number. It expires in 10 minutes. Never share it.", ct);
        if (row is null) return Refused("code-refused", refused!, StatusCodes.Status429TooManyRequests);
        row.Pending = msisdn;
        await db.SaveChangesAsync(ct);
        return Results.Ok(new SmsSentDto(Ending(msisdn)));
    }

    private static async Task<IResult> VerifyMobile(SmsCodeRequest body, CurrentActor current, CommandRunner commands, UserManager<HumoUser> users, HumoDbContext db,
        Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.Impersonation is not null) return Refused("impersonating", "Only the person themselves can set their mobile number.", StatusCodes.Status403Forbidden);
        var (row, code, message) = await CheckAsync(db, clock, actor.Human.Id, Mobile, body.Code, ct);
        if (row?.Pending is not { } msisdn) return Refused(code ?? "code-expired", message ?? "Ask for a new code.");
        var hasPasskey = (await users.GetPasskeysAsync(actor.Human)).Count > 0;
        return await commands.RunAsync(new CommandSpec($"Confirmed their mobile number ({MobileNumber.Mask(msisdn)}) for SMS codes (D26)", "Security.ManageOwn")
        {
            Resource = "Identity",
            ResourceId = actor.Human.Id.ToString(),
            Category = "security",
            StepUp = hasPasskey,
        }, async a =>
        {
            var me = await db.Users.FirstAsync(u => u.Id == a.Human.Id, ct);
            me.PhoneNumber = msisdn;
            me.PhoneNumberConfirmed = true;
            row.Pending = null;
            notices.ToPerson(me.Id, null, "Your mobile number for Humo was set", $"SMS codes now go to {Ending(msisdn)}. If this wasn’t you, sign in and remove it in My profile, and tell your administrator.",
                "/settings/profile");
            return Results.Ok(new { mobile = Ending(msisdn) });
        }, ct);
    }

    private static async Task<IResult> RemoveMobile(CurrentActor current, CommandRunner commands, UserManager<HumoUser> users, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.Impersonation is not null) return Refused("impersonating", "Only the person themselves can change their mobile number.", StatusCodes.Status403Forbidden);
        var hasPasskey = (await users.GetPasskeysAsync(actor.Human)).Count > 0;
        return await commands.RunAsync(new CommandSpec("Removed their mobile number for SMS codes (D26)", "Security.ManageOwn")
        {
            Resource = "Identity",
            ResourceId = actor.Human.Id.ToString(),
            Category = "security",
            StepUp = hasPasskey,
        }, async a =>
        {
            var me = await db.Users.FirstAsync(u => u.Id == a.Human.Id, ct);
            me.PhoneNumber = null;
            me.PhoneNumberConfirmed = false;
            return Results.NoContent();
        }, ct);
    }

    private static async Task<IResult> SendStepUpCode(CurrentActor current, HumoDbContext db, ISmsSender sms, MessageUsage usage, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.Impersonation is not null) return Refused("impersonating", "While acting as someone else, confirm with your own passkey.", StatusCodes.Status403Forbidden);
        var me = actor.Human;
        if (!me.PhoneNumberConfirmed || !MobileNumber.TryNormalise(me.PhoneNumber, out var msisdn))
            return Refused("no-mobile", "There’s no confirmed mobile number on your profile. Use your passkey, or your phone’s.");
        var (row, refused) = await SendAsync(db, sms, usage, clock, actor, StepUp, msisdn,
            "{0} is your Humo code to confirm an approval. It works for approvals only and expires in 10 minutes. Never share it.", ct);
        if (row is null) return Refused("code-refused", refused!, StatusCodes.Status429TooManyRequests);
        await db.SaveChangesAsync(ct);
        return Results.Ok(new SmsSentDto(Ending(msisdn)));
    }

    /// <summary>A right code: the session carries an SMS confirmation (approvals only, 5 minutes). Flagged, and the person and administrators are told.</summary>
    private static async Task<IResult> VerifyStepUp(SmsCodeRequest body, ClaimsPrincipal principal, CurrentActor current, HumoDbContext db, SignInManager<HumoUser> signIn,
        SignInSessions sessions, AuditLog audit, Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.Impersonation is not null) return Refused("impersonating", "While acting as someone else, confirm with your own passkey.", StatusCodes.Status403Forbidden);
        var me = actor.Human;
        var (row, code, message) = await CheckAsync(db, clock, me.Id, StepUp, body.Code, ct);
        if (row is null)
        {
            audit.Record("Entered a wrong SMS code to confirm it’s them (D26)", "denied", me, reason: code);
            await db.SaveChangesAsync(ct);
            return Refused(code!, message!);
        }
        var at = clock.GetUtcNow();
        List<Claim> claims = [new(CurrentActor.SmsStepUpClaim, at.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture))];
        // A passkey confirmation still in force is kept; the SMS one only adds approvals.
        if (principal.FindFirstValue(CurrentActor.StepUpClaim) is { } passkey) claims.Add(new Claim(CurrentActor.StepUpClaim, passkey));
        if (principal.FindFirstValue(AuthEndpoints.AssignmentClaim) is { } assignment) claims.Add(new Claim(AuthEndpoints.AssignmentClaim, assignment));
        var ending = Ending(me.PhoneNumber!);
        audit.Record($"FLAGGED: confirmed it’s them with an SMS code to {ending}, not a passkey: approvals only, for 5 minutes (D26)", "success", me,
            role: actor.Assignment.Role, organisationId: actor.OrganisationId, resource: "Identity", resourceId: me.Id.ToString(), stepUpMethod: "sms");
        notices.ToPerson(me.Id, null, "You confirmed an approval by SMS code", $"A code sent to {ending} was used to confirm it’s you. If this wasn’t you, sign out of every session in Settings › Security and tell your administrator.",
            "/settings/security");
        if (actor.OrganisationId is { } org)
            notices.ToRole(Roles.AgencyAdmin, me.Id, $"{me.Name} confirmed an approval by SMS code", "They used a code by SMS instead of a passkey. It’s flagged in the audit log and covers approvals only.",
                "/audit", org, "security");
        await db.SaveChangesAsync(ct);
        await notices.SendEmailsAsync(ct);
        await sessions.ReissueAsync(me, principal, claims, signIn, ct);
        return Results.Ok(new { verified = true, method = "sms", device = $"SMS to {ending}", at, approvalsOnly = true });
    }
}
