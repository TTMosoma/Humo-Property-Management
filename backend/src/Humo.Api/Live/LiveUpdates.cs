using System.Runtime.CompilerServices;
using Humo.Api.Commands;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Humo.Api.Live;

/// <summary>
/// Live updates (docs/08 §5): when other people's changes land in someone's bell or work, their open app hears at once and
/// fetches again. The hub sends only the names of what changed ("notifications", "work-items", "session", "jobs", "inbox"), never the data: the app
/// re-reads through the normal endpoints, which apply every permission check. So a message reaching a wider group than
/// strictly needed shows nobody anything they couldn't already read.
///   /api/hubs/updates   (SignalR; signed in)
/// </summary>
[Authorize]
public sealed class UpdatesHub(HumoDbContext db, UserManager<HumoUser> users) : Hub
{
    public const string Path = "/api/hubs/updates";
    public const string Changed = "changed";

    public static string UserGroup(Guid id) => $"user:{id}";
    /// <summary>The agency's own people (staff and trustees): its work, jobs and Inbox. Residents aren't in it.</summary>
    public static string OrganisationGroup(Guid id) => $"org:{id}";
    /// <summary>A resident (their person record): their own requests and messages.</summary>
    public static string PersonGroup(Guid id) => $"person:{id}";
    /// <summary>The residents of a unit: requests about their unit.</summary>
    public static string UnitGroup(Guid id) => $"unit:{id}";

    /// <summary>Residents hear only about what's theirs, not every change at their agency.</summary>
    private static readonly string[] ResidentRoles = [Roles.Owner, Roles.Tenant, Roles.PastResident];
    /// <summary>A role across Humo (no organisation), or within one agency.</summary>
    public static string RoleGroup(string role, Guid? organisationId) => organisationId is { } org ? $"role:{role}:{org}" : $"role:{role}";

    /// <summary>Joins the groups of the person signed in, and of the person they're impersonating. The app reconnects when either changes.</summary>
    public override async Task OnConnectedAsync()
    {
        var principal = Context.User;
        if (principal is null || !Guid.TryParse(users.GetUserId(principal), out var id))
        {
            Context.Abort();
            return;
        }
        var people = new List<Guid> { id };
        if (await CurrentActor.ActiveImpersonation(db, principal, id, Context.ConnectionAborted) is { } imp) people.Add(imp.TargetId);

        var assignments = await db.RoleAssignments.AsNoTracking()
            .Where(a => people.Contains(a.UserId) && a.Status == AssignmentStatuses.Active).Select(a => new { a.Role, a.OrganisationId, a.UnitId }).ToListAsync(Context.ConnectionAborted);
        // D46: their record at each agency (the memberships'), as well as the one the sign-in points at.
        var viaMemberships = await db.Memberships.AsNoTracking().Where(m => people.Contains(m.UserId) && m.PersonId != null && m.Status == MembershipStatuses.Active)
            .Select(m => m.PersonId!.Value).ToListAsync(Context.ConnectionAborted);
        var personIds = (await db.Users.AsNoTracking().Where(u => people.Contains(u.Id)).Select(u => u.PersonId).ToListAsync(Context.ConnectionAborted))
            .Select(p => Guid.TryParse(p, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).Concat(viaMemberships).Distinct();
        var groups = people.Select(UserGroup)
            .Concat(assignments.Select(a => RoleGroup(a.Role, a.OrganisationId)))
            .Concat(assignments.Select(a => RoleGroup(a.Role, null)))
            .Concat(assignments.Where(a => a.OrganisationId != null && !ResidentRoles.Contains(a.Role)).Select(a => OrganisationGroup(a.OrganisationId!.Value)))
            .Concat(personIds.Select(PersonGroup))
            .Concat(assignments.Where(a => Guid.TryParse(a.UnitId, out _)).Select(a => UnitGroup(Guid.Parse(a.UnitId!))))
            .Distinct();
        foreach (var group in groups) await Groups.AddToGroupAsync(Context.ConnectionId, group, Context.ConnectionAborted);
        await base.OnConnectedAsync();
    }
}

/// <summary>
/// Watches every save, wherever it comes from (a command, a cooling-off taking effect, a scheduled run), and after it's saved
/// tells the people whose bell or work changed. A failure here is logged and never undoes the save.
/// </summary>
public sealed class LiveUpdates(IHubContext<UpdatesHub> hub, ILogger<LiveUpdates> logger) : SaveChangesInterceptor
{
    private readonly ConditionalWeakTable<DbContext, Dictionary<string, HashSet<string>>> pending = new();

    /// <summary>Group → topics, for what this save changes.</summary>
    public static Dictionary<string, HashSet<string>> Targets(DbContext db)
    {
        var targets = new Dictionary<string, HashSet<string>>();
        void Add(string group, string topic)
        {
            if (!targets.TryGetValue(group, out var topics)) targets[group] = topics = [];
            topics.Add(topic);
        }

        foreach (var e in db.ChangeTracker.Entries<Notice>().Where(e => e.State == EntityState.Added))
        {
            if (e.Entity.ToIdentityId is { } person) Add(UpdatesHub.UserGroup(person), "notifications");
            else if (e.Entity.ToRole is { } role) Add(UpdatesHub.RoleGroup(role, e.Entity.OrganisationId), "notifications");
        }
        foreach (var e in db.ChangeTracker.Entries<WorkItemRow>().Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
            Add(UpdatesHub.OrganisationGroup(e.Entity.OrganisationId), "work-items");
        // A job or a conversation: the agency's people, and the resident it's about (their own request or their unit's).
        foreach (var e in db.ChangeTracker.Entries<JobRow>().Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
        {
            Add(UpdatesHub.OrganisationGroup(e.Entity.OrganisationId), "jobs");
            if (e.Entity.ReportedByPersonId is { } reporter) Add(UpdatesHub.PersonGroup(reporter), "jobs");
            if (e.Entity.UnitId is { } unit) Add(UpdatesHub.UnitGroup(unit), "jobs");
        }
        foreach (var e in db.ChangeTracker.Entries<ConversationRow>().Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
        {
            Add(UpdatesHub.OrganisationGroup(e.Entity.OrganisationId), "inbox");
            Add(UpdatesHub.PersonGroup(e.Entity.PersonId), "inbox");
        }
        // Their access changed: suspended, removed, signed out everywhere (a new security stamp), or a role given or ended.
        // The app checks /me again at once, and leaves for the signed-out page if the session no longer counts.
        foreach (var e in db.ChangeTracker.Entries<HumoUser>().Where(e => e.State == EntityState.Modified
            && (e.Property(u => u.Status).IsModified || e.Property(u => u.SecurityStamp).IsModified)))
            Add(UpdatesHub.UserGroup(e.Entity.Id), "session");
        foreach (var e in db.ChangeTracker.Entries<RoleAssignment>().Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted))
            Add(UpdatesHub.UserGroup(e.Entity.UserId), "session");
        return targets;
    }

    /// <summary>
    /// The person's sessions changed outside a tracked save (sessions are ended in bulk): their open apps check /me again
    /// at once. Never throws.
    /// </summary>
    public async Task SessionChangedAsync(Guid userId)
    {
        try
        {
            await hub.Clients.Group(UpdatesHub.UserGroup(userId)).SendAsync(UpdatesHub.Changed, new[] { "session" });
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogWarning(e, "Couldn't tell {User}'s open apps their session changed; they find out on their next request", userId);
        }
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
    {
        Remember(eventData.Context);
        return base.SavingChangesAsync(eventData, result, ct);
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Remember(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override async ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken ct = default)
    {
        await SendAsync(eventData.Context);
        return await base.SavedChangesAsync(eventData, result, ct);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        _ = SendAsync(eventData.Context);
        return base.SavedChanges(eventData, result);
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData)
    {
        if (eventData.Context is { } db) pending.Remove(db);
        base.SaveChangesFailed(eventData);
    }

    public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken ct = default)
    {
        if (eventData.Context is { } db) pending.Remove(db);
        return base.SaveChangesFailedAsync(eventData, ct);
    }

    private void Remember(DbContext? db)
    {
        if (db is null) return;
        var targets = Targets(db);
        pending.Remove(db);
        if (targets.Count > 0) pending.Add(db, targets);
    }

    private async Task SendAsync(DbContext? db)
    {
        if (db is null || !pending.TryGetValue(db, out var targets)) return;
        pending.Remove(db);
        foreach (var (group, topics) in targets)
        {
            try
            {
                await hub.Clients.Group(group).SendAsync(UpdatesHub.Changed, topics.Order().ToArray());
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Couldn't send a live update to {Group}; the app catches up on its next fetch", group);
            }
        }
    }
}
