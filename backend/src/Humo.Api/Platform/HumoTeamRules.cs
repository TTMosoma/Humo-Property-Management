using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Platform;

/// <summary>Facts about the Humo team that rules depend on, worked out live (doc 16).</summary>
public static class HumoTeamRules
{
    /// <summary>The sole-administrator safeguard applies only while exactly one System Administrator is active (doc 16).</summary>
    public const int SoleAdminCoolingOffHours = 24;

    /// <summary>Active Humo staff holding an active System Administrator role.</summary>
    public static async Task<List<Guid>> SystemAdmins(HumoDbContext db, CancellationToken ct) =>
        await db.RoleAssignments
            .Where(a => a.Role == Roles.SystemAdmin && a.Status == AssignmentStatuses.Active)
            .Join(db.Users.Where(u => u.Kind == IdentityKinds.Humo && u.Status == IdentityStatuses.Active), a => a.UserId, u => u.Id, (a, u) => u.Id)
            .Distinct().ToListAsync(ct);

    public static async Task<bool> IsSoleSystemAdmin(HumoDbContext db, Guid identityId, CancellationToken ct)
    {
        var admins = await SystemAdmins(db, ct);
        return admins.Count == 1 && admins[0] == identityId;
    }

    public static async Task<bool> IsActiveAccountManager(HumoDbContext db, Guid identityId, CancellationToken ct) =>
        await db.Users.AnyAsync(u => u.Id == identityId && u.Kind == IdentityKinds.Humo && u.Status == IdentityStatuses.Active
            && u.Assignments.Any(a => a.Role == Roles.AccountManager && a.Status == AssignmentStatuses.Active), ct);
}
