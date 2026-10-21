using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Humo.Api.Audit;
using Humo.Api.Session;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Auth;

public sealed record LinkRequest(string Email);
/// <summary>The code is the one the requesting screen showed: the link works only with it (docs/17 D14).</summary>
public sealed record CompleteLinkRequest(string Token, string? Code);
/// <summary>What the requesting screen shows. The same shape whether or not the address has an account.</summary>
public sealed record LinkSentDto(string Code);
public sealed record PasskeyOptionsRequest(string? Email);
public sealed record PasskeyCredentialRequest(JsonElement Credential);
/// <summary>"This is my own computer" was ticked on the sign-in screen (the browser is then trusted for 30 days).</summary>
public sealed record PasskeySignInRequest(JsonElement Credential, bool OwnComputer);
public sealed record SwitchAssignmentRequest(string AssignmentId);

/// <summary>
/// Sign-in (D14): passkeys first, one-time email links to join or recover. No
/// passwords. Answers never reveal whether an address has an account (docs/18 R-8).
/// Failure codes match the frontend's SignInFailure: no-passkey, paused, link-expired, wrong-code.
/// </summary>
public static class AuthEndpoints
{
    /// <summary>The cookie claim naming the active role assignment (switching role re-issues the cookie).</summary>
    public const string AssignmentClaim = "humo:assignment";

    /// <summary>Wrong codes before a link is spent. Matches the statement links (DocumentLinks.MaxAttempts).</summary>
    public const int MaxCodeAttempts = 5;

    public static void MapHumoAuth(this IEndpointRouteBuilder api)
    {
        var auth = api.MapGroup("/auth").RequireRateLimiting(RateLimits.SignIn);
        auth.MapPost("/link", SendLink);
        auth.MapPost("/link/complete", CompleteLink);
        auth.MapPost("/passkey/options", PasskeyOptions);
        auth.MapPost("/passkey", PasskeySignIn);
        auth.MapPost("/sign-out", SignOut);

        var me = api.MapGroup("/me").RequireAuthorization();
        me.MapGet("", GetSession);
        me.MapPost("/passkeys/options", PasskeyCreationOptions);
        me.MapPost("/passkeys", AddPasskey);
        me.MapPut("/assignment", SwitchAssignment);
        me.MapPost("/step-up/options", StepUpOptions);
        me.MapPost("/step-up", StepUp);
    }

    // ---- Email links ----

    /// <summary>
    /// Always 202, with a six-digit code for the requesting screen, whether or not the address has an account.
    /// The code is never in the email: a link that someone else receives is useless without the code on this screen.
    /// </summary>
    private static async Task<IResult> SendLink(LinkRequest body, UserManager<HumoUser> users, HumoDbContext db, IEmailSender email,
        IOptions<AppOptions> app, TimeProvider clock, ILoggerFactory logs, CancellationToken ct)
    {
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", CultureInfo.InvariantCulture);
        var address = (body.Email ?? "").Trim();
        var user = address.Length is > 3 and < 320 ? await users.FindByEmailAsync(address) : null;
        if (user is null || user.Status is not (IdentityStatuses.Invited or IdentityStatuses.Active)) return Results.Accepted(value: new LinkSentDto(code));

        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var now = clock.GetUtcNow();
        var linkId = Guid.CreateVersion7();
        db.SignInLinks.Add(new SignInLink
        {
            Id = linkId, UserId = user.Id, TokenHash = Hash(token), CodeHash = CodeHash(linkId, code), CreatedAt = now, ExpiresAt = now + app.Value.SignInLinkLifetime,
        });
        await db.SaveChangesAsync(ct);

        var url = $"{app.Value.PublicUrl.TrimEnd('/')}/sign-in/link?token={token}";
        var minutes = (int)app.Value.SignInLinkLifetime.TotalMinutes;
        try
        {
            await email.SendAsync(new EmailMessage(
                user.Email!,
                "Your sign-in link for Humo Property Management",
                $"Hello {user.Name},\n\nUse this link to sign in to Humo Property Management. It works once, for {minutes} minutes:\n\n{url}\n\n" +
                "When you open it, enter the six-digit code shown on the screen where you asked for this link. The code isn't in this email.\n\n" +
                "If you didn't ask to sign in, ignore this email: nobody can sign in without the code.\n\nHumo Property Management"), ct);
        }
        catch (Exception e)
        {
            // Still 202: the answer must not depend on the account. The failure is logged for the IT Technician (doc 26 §8).
            logs.CreateLogger("Humo.SignIn").LogError(e, "Couldn't send a sign-in link");
        }
        return Results.Accepted(value: new LinkSentDto(code));
    }

    private static async Task<IResult> CompleteLink(CompleteLinkRequest body, HumoDbContext db, SignInManager<HumoUser> signIn, SignInSessions sessions, AuditLog audit,
        TimeProvider clock, CancellationToken ct)
    {
        var hash = Hash(body.Token ?? "");
        var link = await db.SignInLinks.FirstOrDefaultAsync(l => l.TokenHash == hash, ct);
        var now = clock.GetUtcNow();
        if (link is null || link.UsedAt is not null || link.ExpiresAt <= now) return Failure("link-expired", "The sign-in link was used already or is too old.");
        if (link.CodeAttempts >= MaxCodeAttempts) return Failure("link-expired", "Too many wrong codes. Ask for a new sign-in link.");

        // The code shown on the requesting screen binds the link to that browser: a forwarded link can't be used without it.
        var given = (body.Code ?? "").Trim();
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(CodeHash(link.Id, given)), Encoding.ASCII.GetBytes(link.CodeHash)))
        {
            link.CodeAttempts++;
            var wrongUser = await db.Users.FirstAsync(u => u.Id == link.UserId, ct);
            audit.Record("Entered a wrong code for a sign-in link", "denied", wrongUser);
            await db.SaveChangesAsync(ct);
            var left = MaxCodeAttempts - link.CodeAttempts;
            return left > 0
                ? Failure("wrong-code", $"That code isn’t right. {left} {(left == 1 ? "try" : "tries")} left.")
                : Failure("link-expired", "Too many wrong codes. Ask for a new sign-in link.");
        }

        // Used once: the update only succeeds for the first caller.
        var claimed = await db.SignInLinks.Where(l => l.Id == link.Id && l.UsedAt == null).ExecuteUpdateAsync(s => s.SetProperty(l => l.UsedAt, now), ct);
        if (claimed == 0) return Failure("link-expired", "The sign-in link was used already or is too old.");

        var user = await db.Users.FirstAsync(u => u.Id == link.UserId, ct);
        if (user.Status is not (IdentityStatuses.Invited or IdentityStatuses.Active))
        {
            audit.Record("Sign-in refused (email link)", "denied", user, reason: $"Identity is {user.Status}");
            await db.SaveChangesAsync(ct);
            return Failure("paused", "This account is paused.");
        }

        // Using an invitation link is accepting the invitation.
        if (user.Status == IdentityStatuses.Invited)
        {
            user.Status = IdentityStatuses.Active;
            user.EmailConfirmed = true;
            user.Version++;
            audit.Record("Accepted the invitation", "success", user);
        }
        audit.Record("Signed in with an email link", "success", user);
        await db.SaveChangesAsync(ct);
        // A link sign-in is never trusted: it proves control of an inbox, not of a device (docs/17 session policy).
        await sessions.StartAsync(user, SessionPolicy.LinkMethod, trusted: false, signIn, ct);
        return Results.NoContent();
    }

    // ---- Passkeys ----

    /// <summary>Options for navigator.credentials.get(). Without a known email, the browser offers any Humo passkey it holds.</summary>
    private static async Task<IResult> PasskeyOptions(PasskeyOptionsRequest body, UserManager<HumoUser> users, SignInManager<HumoUser> signIn)
    {
        var user = string.IsNullOrWhiteSpace(body.Email) ? null : await users.FindByEmailAsync(body.Email.Trim());
        var json = await signIn.MakePasskeyRequestOptionsAsync(user is { Status: IdentityStatuses.Active } ? user : null);
        return Results.Content(json, "application/json");
    }

    private static async Task<IResult> PasskeySignIn(PasskeySignInRequest body, UserManager<HumoUser> users, SignInManager<HumoUser> signIn, HumoDbContext db,
        AuditLog audit, SignInSessions sessions, CancellationToken ct)
    {
        var result = await signIn.PerformPasskeyAssertionAsync(body.Credential.GetRawText());
        if (!result.Succeeded) return Failure("no-passkey", "That passkey didn't work for Humo.");

        var user = result.User;
        if (user.Status != IdentityStatuses.Active)
        {
            audit.Record("Sign-in refused (passkey)", "denied", user, reason: $"Identity is {user.Status}");
            await db.SaveChangesAsync(ct);
            return Failure("paused", "This account is paused.");
        }

        // Keep the passkey's signature counter and last use up to date (as the framework asks).
        await users.AddOrUpdatePasskeyAsync(user, result.Passkey);
        // A passkey proves the device holds the key. Ticking "my own computer" marks this browser; a browser already marked stays trusted.
        var trusted = body.OwnComputer || await sessions.IsTrustedBrowserAsync(user, ct);
        if (body.OwnComputer) await sessions.MarkTrustedAsync(user, ct);
        audit.Record("Signed in with a passkey", "success", user, stepUpMethod: "passkey", reason: trusted ? "Trusted browser" : "Browser not marked as own");
        await db.SaveChangesAsync(ct);
        await sessions.StartAsync(user, SessionPolicy.PasskeyMethod, trusted, signIn, ct);
        return Results.NoContent();
    }

    /// <summary>Options for navigator.credentials.create(), for the signed-in person's new passkey.</summary>
    private static async Task<IResult> PasskeyCreationOptions(ClaimsPrincipal principal, UserManager<HumoUser> users, SignInManager<HumoUser> signIn)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null) return Results.Unauthorized();
        var json = await signIn.MakePasskeyCreationOptionsAsync(new PasskeyUserEntity { Id = user.Id.ToString(), Name = user.Email!, DisplayName = user.Name });
        return Results.Content(json, "application/json");
    }

    private static async Task<IResult> AddPasskey(PasskeyCredentialRequest body, ClaimsPrincipal principal, UserManager<HumoUser> users, SignInManager<HumoUser> signIn, HumoDbContext db, AuditLog audit, CancellationToken ct)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null) return Results.Unauthorized();
        var result = await signIn.PerformPasskeyAttestationAsync(body.Credential.GetRawText());
        if (!result.Succeeded)
        {
            audit.Record("Adding a passkey failed", "denied", user, reason: result.Failure?.Message);
            await db.SaveChangesAsync(ct);
            return Results.Problem(title: "The passkey wasn't added", detail: result.Failure?.Message, statusCode: StatusCodes.Status400BadRequest);
        }
        var added = await users.AddOrUpdatePasskeyAsync(user, result.Passkey);
        if (!added.Succeeded) return Results.Problem(title: "The passkey wasn't added", statusCode: StatusCodes.Status400BadRequest);
        audit.Record("Added a passkey", "success", user, resource: "Passkey");
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }

    // ---- Session ----

    private static async Task<IResult> GetSession(ClaimsPrincipal principal, UserManager<HumoUser> users, SessionBuilder sessions, HumoDbContext db, CancellationToken ct)
    {
        if (!Guid.TryParse(users.GetUserId(principal), out var id)) return Results.Unauthorized();
        var user = await sessions.LoadUserAsync(id, ct);
        if (user is null) return Results.Unauthorized();
        var assignment = principal.FindFirstValue(AssignmentClaim);
        if (await Commands.CurrentActor.ActiveImpersonation(db, principal, user.Id, ct) is { } imp && await sessions.BuildImpersonatedAsync(user, assignment, imp, ct) is { } impersonated)
            return Results.Ok(impersonated);
        return Results.Ok(await sessions.BuildAsync(user, assignment, ct));
    }

    /// <summary>Switch role: only to one of your own assignments in force. The cookie is re-issued for it, and the session's idle limit follows the role.</summary>
    private static async Task<IResult> SwitchAssignment(SwitchAssignmentRequest body, ClaimsPrincipal principal, UserManager<HumoUser> users, SignInManager<HumoUser> signIn,
        SessionBuilder sessions, SignInSessions signInSessions, CancellationToken ct)
    {
        if (!Guid.TryParse(users.GetUserId(principal), out var id)) return Results.Unauthorized();
        var user = await sessions.LoadUserAsync(id, ct);
        if (user is null) return Results.Unauthorized();
        if (principal.FindFirstValue(Commands.CurrentActor.ImpersonationClaim) is not null)
            return Results.Problem(title: "End the impersonation first", statusCode: StatusCodes.Status403Forbidden, extensions: new Dictionary<string, object?> { ["code"] = "forbidden" });
        if (!sessions.InForce(user).Any(a => a.Id.ToString() == body.AssignmentId))
            return Results.Problem(title: "Not one of your roles", statusCode: StatusCodes.Status403Forbidden);

        var role = user.Assignments.First(a => a.Id.ToString() == body.AssignmentId).Role;
        if (await signInSessions.CurrentAsync(principal, ct) is { } current) await signInSessions.SetRoleAsync(current.Id, role, ct);
        await signInSessions.ReissueAsync(user, principal, [new Claim(AssignmentClaim, body.AssignmentId)], signIn, ct);
        return Results.Ok(await sessions.BuildAsync(user, body.AssignmentId, ct));
    }

    // ---- Step-up: a fresh passkey proof for sensitive commands (doc 24 C7) ----

    /// <summary>Options for navigator.credentials.get(), limited to the signed-in person's own passkeys.</summary>
    private static async Task<IResult> StepUpOptions(ClaimsPrincipal principal, UserManager<HumoUser> users, SignInManager<HumoUser> signIn)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null) return Results.Unauthorized();
        return Results.Content(await signIn.MakePasskeyRequestOptionsAsync(user), "application/json");
    }

    /// <summary>Verifies the passkey and records the proof's time in the session; commands check it is under 5 minutes old.</summary>
    private static async Task<IResult> StepUp(PasskeyCredentialRequest body, ClaimsPrincipal principal, UserManager<HumoUser> users, SignInManager<HumoUser> signIn,
        IStepUpVerifier verifier, HumoDbContext db, AuditLog audit, TimeProvider clock, SignInSessions sessions, CancellationToken ct)
    {
        var user = await users.GetUserAsync(principal);
        if (user is null) return Results.Unauthorized();
        if (await verifier.VerifyAsync(user, body.Credential.GetRawText()) is { } failure)
        {
            audit.Record("Step-up verification failed", "denied", user, reason: failure);
            await db.SaveChangesAsync(ct);
            return Failure("no-passkey", "That passkey didn't verify you.");
        }
        var at = clock.GetUtcNow();
        List<Claim> claims = [new(Commands.CurrentActor.StepUpClaim, at.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture))];
        if (principal.FindFirstValue(AssignmentClaim) is { } assignment) claims.Add(new Claim(AssignmentClaim, assignment));
        if (principal.FindFirstValue(Commands.CurrentActor.ImpersonationClaim) is { } imp) claims.Add(new Claim(Commands.CurrentActor.ImpersonationClaim, imp));
        await sessions.ReissueAsync(user, principal, claims, signIn, ct);
        return Results.Ok(new { verified = true, method = "passkey", device = "Passkey", at });
    }

    private static async Task<IResult> SignOut(ClaimsPrincipal principal, SignInManager<HumoUser> signIn, UserManager<HumoUser> users, HumoDbContext db, AuditLog audit,
        TimeProvider clock, SignInSessions sessions, CancellationToken ct)
    {
        // Signing out ends an impersonation too (doc 08 section 2), and both are recorded.
        if (Guid.TryParse(users.GetUserId(principal), out var id) && await Commands.CurrentActor.ActiveImpersonation(db, principal, id, ct) is { } imp)
        {
            imp.EndedAt = clock.GetUtcNow();
            var user = await db.Users.FirstAsync(u => u.Id == id, ct);
            audit.Record("Signed out (impersonation ended)", "success", user, category: "impersonation", resource: "Identity", resourceId: imp.TargetId.ToString(), impersonation: imp);
            await db.SaveChangesAsync(ct);
        }
        // The session ends on the server too, so a copy of the cookie is refused from now on.
        if (await sessions.CurrentAsync(principal, ct) is { } current) await sessions.RevokeAsync(current.Id, ct);
        await signIn.SignOutAsync();
        return Results.NoContent();
    }

    // ---- Helpers ----

    /// <summary>400 with the frontend's SignInFailure code.</summary>
    private static IResult Failure(string code, string message) =>
        Results.Problem(title: message, statusCode: StatusCodes.Status400BadRequest, extensions: new Dictionary<string, object?> { ["code"] = code });

    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    /// <summary>The code is hashed with the link's id, so the same code means nothing on another link.</summary>
    private static string CodeHash(Guid linkId, string code) => Hash($"{linkId:N}:{code}");
}
