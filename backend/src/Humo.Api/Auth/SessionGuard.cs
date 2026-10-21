using System.Security.Claims;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Auth;

/// <summary>
/// Ends a cookie whose server-side session no longer counts: revoked, idle longer than its limit, past its absolute
/// limit, or belonging to someone who is no longer active. Runs after authentication, on every request, so a
/// session can't outlive the policy just because its cookie is still held.
/// </summary>
public sealed class SessionGuard(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext http, HumoDbContext db, TimeProvider clock)
    {
        if (http.User.Identity?.IsAuthenticated == true && !await InForceAsync(http.User, db, clock, http.RequestAborted))
        {
            await http.SignOutAsync(IdentityConstants.ApplicationScheme);
            http.User = new ClaimsPrincipal(new ClaimsIdentity());
        }
        await next(http);
    }

    private static async Task<bool> InForceAsync(ClaimsPrincipal principal, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        // A cookie without a session (signed in before sessions were kept on the server) counts for nothing: sign in again.
        if (!Guid.TryParse(principal.FindFirstValue(SessionPolicy.SessionClaim), out var id)) return false;
        var session = await db.UserSessions.FirstOrDefaultAsync(s => s.Id == id, ct);
        var now = clock.GetUtcNow();
        if (session is null || session.RevokedAt is not null || now >= session.AbsoluteExpiresAt
            || now - session.LastActiveAt > TimeSpan.FromMinutes(session.IdleMinutes))
            return false;

        // A paused or removed person's sessions end with their access.
        var status = await db.Users.Where(u => u.Id == session.UserId).Select(u => u.Status).FirstOrDefaultAsync(ct);
        if (status != IdentityStatuses.Active) return false;

        if (now - session.LastActiveAt >= SessionPolicy.ActivityInterval)
            await db.UserSessions.Where(s => s.Id == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.LastActiveAt, now), ct);
        return true;
    }
}
