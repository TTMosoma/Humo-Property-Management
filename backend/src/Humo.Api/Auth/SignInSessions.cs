using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Humo.Api.Session;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Auth;

/// <summary>
/// Server-side sessions and trusted browsers. A sign-in starts a session; the cookie carries only its id, and the
/// session row decides whether the cookie still counts (see <see cref="SessionGuard"/>). Re-issuing the cookie
/// (role switch, step-up) never extends a session: its lifetime comes from the row.
/// </summary>
public sealed class SignInSessions(HumoDbContext db, SessionBuilder sessions, TimeProvider clock, IHttpContextAccessor http)
{
    /// <summary>The cookie that marks a browser as the person's own. Its value is random; the server keeps only its hash.</summary>
    public const string DeviceCookie = "humo.device";

    private DateTimeOffset Now => clock.GetUtcNow();

    /// <summary>Starts a session for a person who has just proved who they are, and signs this browser in.</summary>
    public async Task StartAsync(HumoUser user, string method, bool trusted, SignInManager<HumoUser> signIn, CancellationToken ct)
    {
        var ctx = http.HttpContext!;
        var (idle, absolute) = SessionPolicy.For(method, trusted, await RoleAsync(user, null, ct));
        var session = new UserSession
        {
            Id = Guid.CreateVersion7(), UserId = user.Id, Method = method, Trusted = trusted, Device = Label(ctx), Ip = ctx.Connection.RemoteIpAddress?.ToString() ?? "",
            StartedAt = Now, LastActiveAt = Now, IdleMinutes = idle, AbsoluteExpiresAt = Now + absolute,
        };
        db.UserSessions.Add(session);
        await db.SaveChangesAsync(ct);
        await signIn.SignInWithClaimsAsync(user, Properties(session), [new Claim(SessionPolicy.SessionClaim, session.Id.ToString())]);
    }

    /// <summary>Re-issues the cookie for the same session, with the claims given.</summary>
    public async Task ReissueAsync(HumoUser user, ClaimsPrincipal principal, IEnumerable<Claim> claims, SignInManager<HumoUser> signIn, CancellationToken ct)
    {
        var session = await CurrentAsync(principal, ct) ?? throw new InvalidOperationException("The cookie has no session to re-issue.");
        await signIn.SignInWithClaimsAsync(user, Properties(session), claims.Append(new Claim(SessionPolicy.SessionClaim, session.Id.ToString())));
    }

    /// <summary>The session the cookie names, if there is one.</summary>
    public Task<UserSession?> CurrentAsync(ClaimsPrincipal principal, CancellationToken ct) =>
        Guid.TryParse(principal.FindFirstValue(SessionPolicy.SessionClaim), out var id)
            ? db.UserSessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id, ct)
            : Task.FromResult<UserSession?>(null);

    /// <summary>The role a session starts with (or the one named), for the policy's admin rule.</summary>
    public async Task<string?> RoleAsync(HumoUser user, string? assignmentId, CancellationToken ct)
    {
        var loaded = await sessions.LoadUserAsync(user.Id, ct);
        if (loaded is null) return null;
        var session = await sessions.BuildAsync(loaded, assignmentId, ct);
        return loaded.Assignments.FirstOrDefault(a => a.Id.ToString() == session.ActiveAssignmentId)?.Role;
    }

    /// <summary>A role switch changes the idle limit: admin roles are shorter.</summary>
    public async Task SetRoleAsync(Guid sessionId, string? role, CancellationToken ct)
    {
        var session = await db.UserSessions.FirstAsync(s => s.Id == sessionId, ct);
        session.IdleMinutes = SessionPolicy.For(session.Method, session.Trusted, role).IdleMinutes;
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Ends one session now (sign-out). Its cookie is refused from then on, even if the browser still holds it.</summary>
    public Task RevokeAsync(Guid sessionId, CancellationToken ct) =>
        db.UserSessions.Where(s => s.Id == sessionId && s.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, Now), ct);

    /// <summary>Ends every other session of the person, and keeps this one.</summary>
    public Task RevokeOthersAsync(Guid userId, Guid keepSessionId, CancellationToken ct) =>
        db.UserSessions.Where(s => s.UserId == userId && s.Id != keepSessionId && s.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.RevokedAt, Now), ct);

    /// <summary>Is this browser one the person marked as their own, and has the mark not lapsed?</summary>
    public async Task<bool> IsTrustedBrowserAsync(HumoUser user, CancellationToken ct)
    {
        var token = http.HttpContext?.Request.Cookies[DeviceCookie];
        if (string.IsNullOrEmpty(token)) return false;
        var hash = Hash(token);
        return await db.TrustedBrowsers.AnyAsync(t => t.UserId == user.Id && t.TokenHash == hash && t.RevokedAt == null && t.ExpiresAt > Now, ct);
    }

    /// <summary>Marks this browser as the person's own for 30 days.</summary>
    public async Task MarkTrustedAsync(HumoUser user, CancellationToken ct)
    {
        var ctx = http.HttpContext!;
        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        db.TrustedBrowsers.Add(new TrustedBrowser
        {
            Id = Guid.CreateVersion7(), UserId = user.Id, TokenHash = Hash(token), Label = Label(ctx), CreatedAt = Now, ExpiresAt = Now + SessionPolicy.TrustLifetime,
        });
        ctx.Response.Cookies.Append(DeviceCookie, token, new CookieOptions
        {
            HttpOnly = true, Secure = ctx.Request.IsHttps, SameSite = SameSiteMode.Lax, Expires = Now + SessionPolicy.TrustLifetime, IsEssential = true,
        });
        await db.SaveChangesAsync(ct);
    }

    public static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    /// <summary>The browser as the person will recognise it: the start of its user agent, not a fingerprint.</summary>
    public static string Label(HttpContext ctx)
    {
        var agent = ctx.Request.Headers.UserAgent.ToString();
        return agent.Length == 0 ? "Unknown browser" : agent[..Math.Min(agent.Length, 120)];
    }

    /// <summary>A browser the person marked as their own stays signed in across restarts (until the policy's limits); any other session ends with the browser.</summary>
    private static AuthenticationProperties Properties(UserSession session) =>
        new() { IsPersistent = session.Trusted, ExpiresUtc = session.AbsoluteExpiresAt, AllowRefresh = false };
}
