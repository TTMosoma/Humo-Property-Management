using System.Security.Claims;
using Humo.Api.Commands;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;

namespace Humo.Api.Auth;

public sealed record PasskeyDto(string Id, string Name, string Provider, string CreatedAt, string? LastUsedAt);
public sealed record ActiveSessionDto(string Id, string Device, string Browser, string Location, string Ip, string StartedAt, string LastActiveAt, bool Current);
public sealed record SecurityProfileDto(string IdentityId, IReadOnlyList<PasskeyDto> Passkeys, IReadOnlyList<object> Devices, IReadOnlyList<ActiveSessionDto> Sessions);

/// <summary>
/// Settings › Security: the signed-in person's own passkeys and sessions. Removing a passkey and
/// signing out other sessions need step-up (Security.ManageOwn). Adding a passkey is the WebAuthn
/// ceremony itself (POST /me/passkeys). Humo Mobile devices come later (D5).
/// </summary>
public static class SecurityEndpoints
{
    public static void MapSecurity(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/me/security").RequireAuthorization();
        g.MapGet("", Profile);
        g.MapPost("/passkeys/{id}/remove", RemovePasskey);
        g.MapPost("/sign-out-others", SignOutOthers);
    }

    private static async Task<IResult> Profile(HttpContext http, CurrentActor current, UserManager<HumoUser> users, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var me = actor.Human;
        var passkeys = await users.GetPasskeysAsync(me);
        var ip = http.Connection.RemoteIpAddress?.ToString() ?? "";
        var agent = http.Request.Headers.UserAgent.ToString();
        var now = DateTimeOffset.UtcNow.ToString("O");
        return Results.Ok(new SecurityProfileDto(
            me.Id.ToString(),
            passkeys.Select(p => new PasskeyDto(WebEncoders.Base64UrlEncode(p.CredentialId), p.Name ?? "Passkey", p.IsBackupEligible ? "Synced passkey" : "Device passkey", p.CreatedAt.ToString("O"), null)).ToList(),
            [],
            // Only this session is listed: the cookie holds the session, the server doesn't track devices yet.
            [new ActiveSessionDto("current", agent.Length > 0 ? agent[..Math.Min(agent.Length, 80)] : "This device", "", "", ip, now, now, true)]));
    }

    private static async Task<IResult> RemovePasskey(string id, CurrentActor current, CommandRunner commands, UserManager<HumoUser> users, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var me = actor.Human;
        var passkeys = await users.GetPasskeysAsync(me);
        var target = passkeys.FirstOrDefault(p => WebEncoders.Base64UrlEncode(p.CredentialId) == id);
        if (target is null) return Problems.NotFound();

        return await commands.RunAsync(new CommandSpec($"Removed a passkey ({target.Name ?? "Passkey"})", "Security.ManageOwn")
        {
            Resource = "Passkey",
            Category = "security",
            StepUp = true,
            // Keep a way in: the last passkey stays until another exists.
            Validate = () => passkeys.Count <= 1 ? new() { ["passkey"] = "Keep at least one way to verify: add another passkey first." } : [],
        }, async _ =>
        {
            await users.RemovePasskeyAsync(me, target.CredentialId);
            return Results.NoContent();
        }, ct);
    }

    /// <summary>Every other session ends (security stamp); this one is re-issued and carries on.</summary>
    private static async Task<IResult> SignOutOthers(ClaimsPrincipal principal, CurrentActor current, CommandRunner commands, UserManager<HumoUser> users, SignInManager<HumoUser> signIn,
        SignInSessions sessions, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var me = actor.Human;
        return await commands.RunAsync(new CommandSpec("Signed out every other session", "Security.ManageOwn")
        {
            Resource = "Session",
            Category = "security",
            StepUp = true,
        }, async _ =>
        {
            await users.UpdateSecurityStampAsync(me);
            if (await sessions.CurrentAsync(principal, ct) is { } keep) await sessions.RevokeOthersAsync(me.Id, keep.Id, ct);
            // This session carries on: the cookie is re-issued for it, keeping the person's own claims.
            var claims = principal.Claims.Where(c => c.Type.StartsWith("humo:") && c.Type != SessionPolicy.SessionClaim).ToList();
            await sessions.ReissueAsync(me, principal, claims, signIn, ct);
            return Results.NoContent();
        }, ct);
    }
}
