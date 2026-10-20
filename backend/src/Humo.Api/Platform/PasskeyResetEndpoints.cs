using Humo.Api.Auth;
using Humo.Api.Commands;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Platform;

public sealed record RemovePasskeysRequest(string? PasskeyId, string? Reason);

/// <summary>
/// Humo removing someone's passkeys (Platform.Users.ResetPasskeys: System Administrator and Humo Support), e.g. after a lost
/// or stolen device. It needs a fresh passkey and a reason, and is a security event in the audit log. Removing passkeys
/// signs the person out everywhere and emails them; they sign in again with an email link and add a new passkey.
/// Support can't do this to a System Administrator, and nobody does it to themselves here (that's Settings › Security).
///   GET  /platform/users/{userId}/passkeys
///   POST /platform/users/{userId}/passkeys/remove   { passkeyId | null for all, reason }
/// </summary>
public static class PasskeyResetEndpoints
{
    public const string Permission = "Platform.Users.ResetPasskeys";

    public static void MapPasskeyReset(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/platform/users/{userId:guid}/passkeys").RequireAuthorization();
        g.MapGet("", List);
        g.MapPost("/remove", Remove);
    }

    private static async Task<IResult> List(Guid userId, CurrentActor current, UserManager<HumoUser> users, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can(Permission) || await users.FindByIdAsync(userId.ToString()) is not { } user) return Problems.NotFound();
        var passkeys = await users.GetPasskeysAsync(user);
        return Results.Ok(passkeys.Select(p => new PasskeyDto(WebEncoders.Base64UrlEncode(p.CredentialId), p.Name ?? "Passkey", p.IsBackupEligible ? "Synced passkey" : "Device passkey",
            p.CreatedAt.ToString("O"), null)).ToList());
    }

    private static async Task<IResult> Remove(Guid userId, RemovePasskeysRequest body, CurrentActor current, CommandRunner commands, UserManager<HumoUser> users, HumoDbContext db,
        IEmailSender email, IOptions<AppOptions> app, ILoggerFactory logs, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (!me.Can(Permission) || await users.FindByIdAsync(userId.ToString()) is not { } user) return Problems.NotFound();
        var passkeys = await users.GetPasskeysAsync(user);
        var targets = body.PasskeyId is null ? passkeys.ToList() : passkeys.Where(p => WebEncoders.Base64UrlEncode(p.CredentialId) == body.PasskeyId).ToList();
        var reason = (body.Reason ?? "").Trim();
        var isAdmin = await db.RoleAssignments.AnyAsync(r => r.UserId == user.Id && r.Role == Roles.SystemAdmin && r.Status == AssignmentStatuses.Active, ct);
        var what = body.PasskeyId is null ? $"all {targets.Count} passkey{(targets.Count == 1 ? "" : "s")}" : $"the passkey “{targets.FirstOrDefault()?.Name ?? "Passkey"}”";

        return await commands.RunAsync(new CommandSpec($"Removed {what} from {user.Name} ({user.Email}) — {reason}", Permission)
        {
            Resource = "Identity",
            ResourceId = user.Id.ToString(),
            Category = "security",
            StepUp = true,
            Validate = () =>
            {
                if (user.Id == me.Human.Id) return new() { ["userId"] = "Manage your own passkeys in Settings › Security." };
                if (isAdmin && me.Assignment.Role != Roles.SystemAdmin) return new() { ["userId"] = "Only a System Administrator can remove a System Administrator’s passkeys." };
                if (targets.Count == 0) return new() { ["passkeyId"] = body.PasskeyId is null ? $"{user.Name} has no passkeys." : "That passkey isn’t on this account." };
                if (reason.Length < 10) return new() { ["reason"] = "Say why, for the audit log (for example: “Lost phone, confirmed by call to their office number”)." };
                return [];
            },
        }, async actor =>
        {
            foreach (var p in targets) await users.RemovePasskeyAsync(user, p.CredentialId);
            // A lost or stolen device: whoever has it is signed out too.
            await users.UpdateSecurityStampAsync(user);
            commands.AfterCommit(async () =>
            {
                if (string.IsNullOrWhiteSpace(user.Email)) return;
                try
                {
                    var signIn = $"{app.Value.PublicUrl.TrimEnd('/')}/sign-in";
                    await email.SendAsync(new EmailMessage(user.Email, "A passkey was removed from your Humo Property Management sign-in", $"""
                        Hello {user.Name},

                        Humo removed {(targets.Count == 1 ? "a passkey" : "your passkeys")} from your Humo Property Management sign-in and signed you out on every device.

                        Reason: {reason}
                        Done by: {actor.Human.Name}, Humo

                        To sign in again, open {signIn}, enter your email address and use the link we send you. Then add a new passkey.

                        If you didn’t ask for this, reply to this email or contact support@humo.co.za straight away.
                        """), CancellationToken.None);
                }
                catch (Exception e)
                {
                    logs.CreateLogger("Humo.Security").LogError(e, "Couldn't email {User} about the removed passkeys", user.Id);
                }
            });
            return Results.NoContent();
        }, ct);
    }
}
