using System.Globalization;
using System.Security.Claims;
using Humo.Api.Auth;
using Humo.Api.Session;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;

namespace Humo.Api.Commands;

/// <summary>
/// Who is acting, from the session cookie and the database (never from the client):
/// the person, the active assignment and what it may do (doc 24 C2).
/// </summary>
public sealed record Actor(HumoUser User, RoleAssignment Assignment, IReadOnlySet<string> Permissions, DateTimeOffset? StepUpAt)
{
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
public sealed class CurrentActor(IHttpContextAccessor http, SessionBuilder sessions, UserManager<HumoUser> users)
{
    public const string StepUpClaim = "humo:stepup";
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
        return actor;
    }
}
