using System.Globalization;
using System.Security.Claims;
using Humo.Api.Auth;
using Humo.Api.Session;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Commands;

/// <summary>
/// Who is acting, from the session cookie and the database (never from the client):
/// the person, the active assignment and what it may do (doc 24 C2).
/// </summary>
/// <remarks>
/// While Humo staff impersonate a customer, <see cref="User"/> and <see cref="Assignment"/> are the
/// customer's (so scope and permissions are theirs) and <see cref="Human"/> is the staff member at the
/// keyboard, who is the actor in the audit log.
/// </remarks>
public sealed record Actor(HumoUser User, RoleAssignment Assignment, IReadOnlySet<string> Permissions, DateTimeOffset? StepUpAt,
    HumoUser? ImpersonatedBy = null, ImpersonationSession? Impersonation = null)
{
    /// <summary>The person at the keyboard.</summary>
    public HumoUser Human => ImpersonatedBy ?? User;

    /// <summary>Observe impersonation: read-only (doc 24 C1).</summary>
    public bool Observing => Impersonation?.Mode == "observe";

    public bool Can(string permission) => Permissions.Contains(permission);

    public bool IsHumo => Roles.IsHumo(Assignment.Role);

    /// <summary>The organisation of the active assignment; null for Humo staff.</summary>
    public Guid? OrganisationId => Assignment.OrganisationId;

    /// <summary>D1: a scheme-scoped assignment changes only its own schemes. Organisation-wide and Humo roles aren't limited here.</summary>
    public bool CoversScheme(Guid schemeId) =>
        Assignment.ScopeType is not (ScopeTypes.Schemes or ScopeTypes.Unit) || Assignment.SchemeIds.Contains(schemeId.ToString());

    /// <summary>Schemes this assignment may read: its own, or the whole organisation with Portfolio.BrowseAgency (D1).</summary>
    public bool ReadsAllSchemesInOrganisation => Assignment.ScopeType == ScopeTypes.Organisation || Can("Portfolio.BrowseAgency");
}

/// <summary>Resolves the <see cref="Actor"/> once per request.</summary>
public sealed class CurrentActor(IHttpContextAccessor http, SessionBuilder sessions, UserManager<HumoUser> users, HumoDbContext db)
{
    public const string StepUpClaim = "humo:stepup";
    public const string ImpersonationClaim = "humo:impersonation";
    private Actor? actor;
    private bool loaded;

    /// <summary>Null when nobody is signed in, or they can't work (suspended, no role in force).</summary>
    public async Task<Actor?> GetAsync(CancellationToken ct)
    {
        if (loaded) return actor;
        loaded = true;
        var principal = http.HttpContext?.User;
        if (principal is null || !Guid.TryParse(users.GetUserId(principal), out var id)) return null;
        var user = await sessions.LoadUserAsync(id, ct);
        if (user is null || user.Status != IdentityStatuses.Active) return null;

        var session = await sessions.BuildAsync(user, principal.FindFirstValue(AuthEndpoints.AssignmentClaim), ct);
        if (!session.SignedIn) return null;
        var assignment = user.Assignments.First(a => a.Id.ToString() == session.ActiveAssignmentId);
        var stepUp = long.TryParse(principal.FindFirstValue(StepUpClaim), NumberStyles.None, CultureInfo.InvariantCulture, out var s) ? DateTimeOffset.FromUnixTimeSeconds(s) : (DateTimeOffset?)null;
        actor = new Actor(user, assignment, session.Permissions.ToHashSet(), stepUp);

        // Impersonating: act as the customer's role, recorded as the staff member (doc 24 section 8).
        if (await ActiveImpersonation(db, principal, user.Id, ct) is { } imp && await sessions.LoadUserAsync(imp.TargetId, ct) is { } target)
        {
            var targetSession = await sessions.BuildAsync(target, imp.TargetAssignmentId.ToString(), ct);
            if (targetSession.SignedIn && targetSession.ActiveAssignmentId == imp.TargetAssignmentId.ToString())
            {
                var targetAssignment = target.Assignments.First(a => a.Id == imp.TargetAssignmentId);
                actor = new Actor(target, targetAssignment, targetSession.Permissions.ToHashSet(), stepUp, user, imp);
            }
        }
        return actor;
    }

    /// <summary>The impersonation the session cookie names, while it hasn't ended and belongs to this person.</summary>
    public static async Task<ImpersonationSession?> ActiveImpersonation(HumoDbContext db, ClaimsPrincipal principal, Guid humanId, CancellationToken ct) =>
        Guid.TryParse(principal.FindFirstValue(ImpersonationClaim), out var id)
            ? await db.ImpersonationSessions.FirstOrDefaultAsync(x => x.Id == id && x.ActorId == humanId && x.EndedAt == null, ct)
            : null;
}
