using System.Security.Claims;
using Humo.Api.Commands;
using Humo.Api.Platform;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Auth;

public sealed record PasskeyDto(string Id, string Name, string Provider, string CreatedAt, string? LastUsedAt);
public sealed record TrustedDeviceDto(string Id, string Name, string Kind, bool Trusted, bool HumoMobile, string AddedAt, string LastSeenAt);
public sealed record ActiveSessionDto(string Id, string Device, string Browser, string Location, string Ip, string StartedAt, string LastActiveAt, bool Current);
public sealed record SecurityProfileDto(string IdentityId, IReadOnlyList<PasskeyDto> Passkeys, IReadOnlyList<TrustedDeviceDto> Devices, IReadOnlyList<ActiveSessionDto> Sessions);
public sealed record BrowserTrustRequest(bool Trusted);
/// <param name="Ids">The computers to remove; leave out, with <paramref name="All"/>, to remove every one.</param>
public sealed record RemoveDevicesRequest(IReadOnlyList<string>? Ids, bool All = false);

/// <summary>
/// Settings › Security: the signed-in person's own passkeys, trusted browsers and sessions. Removing a passkey and
/// signing out other sessions need step-up (Security.ManageOwn). Adding a passkey is the WebAuthn ceremony itself
/// (POST /me/passkeys), which needs an existing passkey once they have one (D30). Humo Mobile devices come later (D5).
/// </summary>
public static class SecurityEndpoints
{
    public static void MapSecurity(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/me/security").RequireAuthorization();
        g.MapGet("", Profile);
        g.MapPost("/passkeys/{id}/remove", RemovePasskey);
        g.MapPost("/devices/{id}/remove", RemoveDevice);
        g.MapPost("/devices/remove", RemoveDevices);
        g.MapPost("/browser", AnswerBrowserTrust);
        g.MapPost("/sessions/{id}/sign-out", SignOutSession);
        g.MapPost("/sign-out-others", SignOutOthers);
    }

    private static async Task<IResult> Profile(HttpContext http, ClaimsPrincipal principal, CurrentActor current, UserManager<HumoUser> users, HumoDbContext db,
        SignInSessions sessions, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var me = actor.Human;
        var passkeys = await users.GetPasskeysAsync(me);
        var now = clock.GetUtcNow();
        // Every browser that has answered the question, so a "shared" answer can be seen and removed too.
        var remembered = (await db.TrustedBrowsers.AsNoTracking()
            .Where(t => t.UserId == me.Id && t.RevokedAt == null)
            .ToListAsync(ct))
            .Where(t => t.ExpiresAt > now)
            .OrderBy(t => t.CreatedAt)
            .ToList();
        var here = await sessions.CurrentAsync(principal, ct);
        // Every session still in force: not signed out, not past its limits. The limits are checked here, as SessionGuard does.
        var active = (await db.UserSessions.AsNoTracking()
            .Where(s => s.UserId == me.Id && s.RevokedAt == null)
            .ToListAsync(ct))
            .Where(s => s.AbsoluteExpiresAt > now && now - s.LastActiveAt <= TimeSpan.FromMinutes(s.IdleMinutes))
            .OrderByDescending(s => s.LastActiveAt)
            .ToList();
        return Results.Ok(new SecurityProfileDto(
            me.Id.ToString(),
            passkeys.Select(p => new PasskeyDto(WebEncoders.Base64UrlEncode(p.CredentialId), p.Name ?? "Passkey", p.IsBackupEligible ? "Synced passkey" : "Device passkey", p.CreatedAt.ToString("O"), null)).ToList(),
            remembered.Select(t => new TrustedDeviceDto(t.Id.ToString(), t.Label, SignInSessions.KindOf(t.Label), t.Trusted, false, t.CreatedAt.ToString("O"), t.CreatedAt.ToString("O"))).ToList(),
            active.Select(s => new ActiveSessionDto(s.Id.ToString(), s.Device, "", "", s.Ip, s.StartedAt.ToString("O"), s.LastActiveAt.ToString("O"), s.Id == here?.Id)).ToList()));
    }

    private static async Task<IResult> RemovePasskey(string id, CurrentActor current, CommandRunner commands, UserManager<HumoUser> users, Notices notices, CancellationToken ct)
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
            notices.ToPerson(me.Id, null, "A passkey was removed from your Humo account",
                $"“{target.Name ?? "Passkey"}” can no longer sign in as you. If this wasn’t you, sign in now, sign out every other session in Settings › Security, and tell your administrator or Humo Support straight away.",
                "/settings/security");
            return Results.NoContent();
        }, ct);
    }

    /// <summary>
    /// Removes a browser's answer, trusted or shared. The question comes back the next time that browser signs in. Other sessions that were
    /// trusted on it end now; a session in this browser keeps going, with the limits of an untrusted sign-in. Its label
    /// is the only record of which browser a session came from.
    /// </summary>
    private static Task<IResult> RemoveDevice(string id, ClaimsPrincipal principal, CurrentActor current, CommandRunner commands, HumoDbContext db,
        SignInSessions sessions, TimeProvider clock, CancellationToken ct) =>
        RemoveDevices(new RemoveDevicesRequest([id]), principal, current, commands, db, sessions, clock, ct);

    /// <summary>Several computers at once, or every one: each is removed as <see cref="RemoveDevice"/> removes one, in one step-up.</summary>
    private static async Task<IResult> RemoveDevices(RemoveDevicesRequest body, ClaimsPrincipal principal, CurrentActor current, CommandRunner commands, HumoDbContext db,
        SignInSessions sessions, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var me = actor.Human;
        var ids = (body.Ids ?? []).Select(i => Guid.TryParse(i, out var g) ? g : (Guid?)null).ToList();
        if (!body.All && (ids.Count == 0 || ids.Any(i => i is null))) return Problems.NotFound();
        var wanted = ids.Select(i => i!.Value).ToHashSet();
        var devices = await db.TrustedBrowsers.Where(t => t.UserId == me.Id && t.RevokedAt == null && (body.All || wanted.Contains(t.Id))).ToListAsync(ct);
        // Each one asked for must be theirs and still remembered: nothing is removed if any isn't.
        if (devices.Count == 0 || (!body.All && devices.Count != wanted.Count)) return Problems.NotFound();

        var now = clock.GetUtcNow();
        var here = await sessions.CurrentAsync(principal, ct);
        var hereId = here?.Id ?? Guid.Empty;
        var labels = devices.Select(d => d.Label).Distinct().Order(StringComparer.OrdinalIgnoreCase).ToList();
        var action = devices.Count == 1 ? $"Removed a trusted browser ({devices[0].Label})"
            : body.All ? $"Removed every trusted browser ({devices.Count}: {string.Join(", ", labels)})"
            : $"Removed {devices.Count} trusted browsers ({string.Join(", ", labels)})";
        return await commands.RunAsync(new CommandSpec(action, "Security.ManageOwn")
        {
            Resource = "Device",
            Category = "security",
        }, async _ =>
        {
            foreach (var device in devices) device.RevokedAt = now;
            await db.UserSessions.Where(s => s.UserId == me.Id && s.Trusted && labels.Contains(s.Device) && s.RevokedAt == null && s.Id != hereId)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, now), ct);
            if (here is { Trusted: true } && labels.Contains(here.Device)) await sessions.ApplyTrustAsync(here.Id, me, false, ct);
            return Results.NoContent();
        }, ct);
    }

    /// <summary>
    /// Answers "is this your own computer?" for the browser that asks. A session started in that browser takes the
    /// answer's limits from now on. The answer is kept on the browser, so it isn't asked again.
    /// </summary>
    private static async Task<IResult> AnswerBrowserTrust(BrowserTrustRequest body, ClaimsPrincipal principal, CurrentActor current, SignInManager<HumoUser> signIn,
        SignInSessions sessions, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var me = actor.Human;
        await sessions.AnswerBrowserAsync(me, body.Trusted, ct);
        if (await sessions.CurrentAsync(principal, ct) is { } session)
        {
            await sessions.ApplyTrustAsync(session.Id, me, body.Trusted, ct);
            // Re-issue the cookie with the same claims, so it persists the way the new answer says.
            var claims = principal.Claims.Where(c => c.Type.StartsWith("humo:") && c.Type != SessionPolicy.SessionClaim).ToList();
            await sessions.ReissueAsync(me, principal, claims, signIn, ct);
        }
        return Results.NoContent();
    }

    /// <summary>Ends one of the person's other sessions. This one is ended with Sign out, not here.</summary>
    private static async Task<IResult> SignOutSession(string id, ClaimsPrincipal principal, CurrentActor current, CommandRunner commands, SignInSessions sessions,
        HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var me = actor.Human;
        if (!Guid.TryParse(id, out var sessionId)) return Problems.NotFound();
        var target = await db.UserSessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sessionId && s.UserId == me.Id && s.RevokedAt == null, ct);
        if (target is null) return Problems.NotFound();
        if (await sessions.CurrentAsync(principal, ct) is { } here && here.Id == sessionId) return Problems.Policy("use-sign-out", "Sign out of this session with Sign out.");

        return await commands.RunAsync(new CommandSpec($"Signed out a session ({target.Device})", "Security.ManageOwn")
        {
            Resource = "Session",
            Category = "security",
            StepUp = true,
        }, async _ =>
        {
            await sessions.RevokeAsync(sessionId, ct);
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
