using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Session;

/// <summary>
/// Works out the session from the database, never from the client (doc 24 S1):
/// the assignments in force, the active one, its permissions, the organisation,
/// and whether the person may work at all (S3).
/// </summary>
public sealed class SessionBuilder(HumoDbContext db, TimeProvider clock, Commercial.CommercialRecords commercial)
{
    public async Task<HumoUser?> LoadUserAsync(Guid userId, CancellationToken ct) =>
        await db.Users.Include(u => u.Memberships).Include(u => u.Assignments).AsSplitQuery().FirstOrDefaultAsync(u => u.Id == userId, ct);

    /// <summary>Assignments in force today: active, not expired, in an organisation the person still belongs to.</summary>
    public IReadOnlyList<RoleAssignment> InForce(HumoUser user)
    {
        var now = clock.GetUtcNow();
        return user.Assignments
            .Where(a => a.Status == AssignmentStatuses.Active && (a.ValidUntil is null || a.ValidUntil > now))
            .Where(a => a.OrganisationId is null || user.Memberships.Any(m => m.OrganisationId == a.OrganisationId && m.Status == MembershipStatuses.Active))
            .OrderBy(a => a.GrantedAt)
            .ToList();
    }

    public async Task<CurrentSessionDto> BuildAsync(HumoUser user, string? requestedAssignmentId, CancellationToken ct)
    {
        var inForce = InForce(user);
        var orgIds = inForce.Where(a => a.OrganisationId is not null).Select(a => a.OrganisationId!.Value).Distinct().ToList();
        var orgs = await db.Organisations.Where(o => orgIds.Contains(o.Id)).ToDictionaryAsync(o => o.Id, ct);

        // Nobody works in a suspended or archived organisation (S3).
        var available = inForce.Where(a => a.OrganisationId is null || (orgs.TryGetValue(a.OrganisationId.Value, out var o) && OrganisationStatuses.IsOpen(o.Status))).ToList();
        var active = available.FirstOrDefault(a => a.Id.ToString() == requestedAssignmentId) ?? available.FirstOrDefault();

        string? blocked = user.Status switch
        {
            IdentityStatuses.Suspended => "identity-suspended",
            IdentityStatuses.Deactivated => "identity-deactivated",
            _ => available.Count == 0 && inForce.Count > 0 ? "organisation-suspended" : null,
        };

        var identity = ToDto(user);
        var permissions = active is null ? [] : AccessCatalogue.PermissionsOf(active.Role, active.Grants).Order().ToList();
        var actorPermissions = available.SelectMany(a => AccessCatalogue.PermissionsOf(a.Role, a.Grants)).Distinct().Order().ToList();
        var org = active?.OrganisationId is { } id && orgs.TryGetValue(id, out var current) ? current : null;
        // The customer's plan: the app gates on these entitlements, and the API checks them on every command.
        var plan = org is null ? null : await commercial.PlanAsync(org.Id, ct);

        return new CurrentSessionDto(
            SignedIn: user.Status == IdentityStatuses.Active && blocked is null && active is not null,
            Blocked: blocked,
            Actor: identity,
            Identity: identity,
            Assignments: available.Select(ToDto).ToList(),
            ActiveAssignmentId: active?.Id.ToString() ?? "none",
            Permissions: permissions,
            PagePermissions: permissions,
            ActorPermissions: actorPermissions,
            Organisation: org is null ? null : new OrganisationDto(org.Id.ToString(), org.Version, org.Kind, org.Status, org.Name, org.ShortName, org.City, org.Province, 0, 0, org.ApprovalStepUpAmount),
            // Null for Humo staff: no customer plan applies.
            Subscription: plan?.Subscription,
            Entitlements: plan?.Entitlements,
            // Impersonation arrives later in slice 1 (doc 24 §8).
            Impersonation: null);
    }

    /// <summary>
    /// GET /me while impersonating: the app renders the customer's role, the staff member stays the
    /// actor. Observe mode keeps only permissions that change nothing; pages follow the full set.
    /// Null when the impersonation can't continue (the target can no longer work in that role).
    /// </summary>
    public async Task<CurrentSessionDto?> BuildImpersonatedAsync(HumoUser human, string? humanAssignmentId, ImpersonationSession imp, CancellationToken ct)
    {
        var target = await LoadUserAsync(imp.TargetId, ct);
        if (target is null) return null;
        var t = await BuildAsync(target, imp.TargetAssignmentId.ToString(), ct);
        if (!t.SignedIn || t.ActiveAssignmentId != imp.TargetAssignmentId.ToString()) return null;
        var h = await BuildAsync(human, humanAssignmentId, ct);
        var permissions = imp.Mode == "observe"
            ? t.Permissions.Where(p => AccessCatalogue.Permissions.TryGetValue(p, out var info) && !info.Mutates).ToList()
            : t.Permissions;
        return t with
        {
            SignedIn = h.SignedIn,
            Actor = h.Actor,
            Assignments = t.Assignments.Where(a => a.Id == t.ActiveAssignmentId).ToList(),
            Permissions = permissions,
            PagePermissions = t.Permissions,
            ActorPermissions = h.ActorPermissions,
            Impersonation = new ImpersonationDto(imp.Id.ToString(), imp.ActorId.ToString(), imp.TargetId.ToString(), imp.TargetAssignmentId.ToString(), imp.Mode, imp.Reason,
                imp.Note, imp.Ticket, imp.StartedAt.ToString("O")),
        };
    }

    public static IdentityDto ToDto(HumoUser u) => new(
        u.Id.ToString(),
        u.Version,
        u.Name,
        Initials(u.Name),
        u.Email ?? "",
        u.Kind,
        u.Status,
        u.SuspendedFrom,
        u.Title,
        u.PersonId,
        u.Memberships.OrderBy(m => m.Since).Select(m => new MembershipDto(m.OrganisationId.ToString(), m.Status, m.Since, m.EndedAt)).ToList(),
        u.Assignments.OrderBy(a => a.GrantedAt).Select(ToDto).ToList());

    public static RoleAssignmentDto ToDto(RoleAssignment a) => new(
        a.Id.ToString(),
        a.Version,
        a.Role,
        new AssignmentScopeDto(a.ScopeType, a.OrganisationId?.ToString(), a.SchemeIds, a.UnitId),
        a.Label,
        a.Grants.Count > 0 ? a.Grants : null,
        a.Status,
        a.GrantedBy,
        a.GrantedAt,
        a.ValidUntil,
        a.EndedBy,
        a.EndedAt);

    public static string Initials(string name)
    {
        var parts = name.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length switch
        {
            0 => "",
            1 => parts[0][..1].ToUpperInvariant(),
            _ => (parts[0][..1] + parts[^1][..1]).ToUpperInvariant(),
        };
    }
}
