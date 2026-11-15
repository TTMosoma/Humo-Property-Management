using System.Globalization;
using System.Text.Json;
using Humo.Api.Platform;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Work;

/// <summary>
/// Every task or approval that lands on someone is also in their bell. The command runner calls this before saving, so it
/// covers work raised anywhere: a new task or approval, and work given to someone else (assigned, or moved by away cover).
///
/// Who hears about it:
/// - work with an assignee: that person;
/// - an approval: the staff who can decide it, covering its scheme; with nobody else at the agency, the scheme's trustees on
///   Humo (D24). Board approvals are told by <see cref="BoardApprovals.AskForAddedAsync"/>;
/// - a task nobody has yet: the role that does that kind of work (Finance, Operations) and the scheme's portfolio managers,
///   as My work shows it to them (D32); the agency's administrators only when nobody else would hear.
///
/// The person who raised it never gets their own. Several items for one person in one change arrive as one notice. These
/// are in the app only: emails about work stay as each feature sends them.
/// </summary>
public static class WorkNotices
{
    public static async Task TellAsync(HumoDbContext db, Notices notices, Guid? actorId, CancellationToken ct)
    {
        var entries = db.ChangeTracker.Entries<WorkItemRow>()
            .Where(e => e.Entity.Status == "open" && !e.Entity.BoardMajority && (e.State == EntityState.Added
                || (e.State == EntityState.Modified && e.Property(w => w.AssigneeId).IsModified && e.Entity.AssigneeId is not null
                    && e.Property(w => w.AssigneeId).OriginalValue != e.Entity.AssigneeId)))
            .Select(e => (Item: e.Entity, Reassigned: e.State == EntityState.Modified)).ToList();
        if (entries.Count == 0) return;

        var perPerson = new Dictionary<Guid, List<(WorkItemRow Item, bool Reassigned)>>();
        foreach (var (item, reassigned) in entries)
            foreach (var person in await WhoActsAsync(db, item, actorId, ct))
            {
                if (!perPerson.TryGetValue(person, out var list)) perPerson[person] = list = [];
                list.Add((item, reassigned));
            }

        var schemeIds = entries.Select(e => e.Item.SchemeId).OfType<Guid>().Distinct().ToList();
        var schemes = await db.Schemes.AsNoTracking().Where(s => schemeIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name, ct);
        foreach (var (person, items) in perPerson)
        {
            if (items.Count == 1)
            {
                var (item, reassigned) = items[0];
                var link = LinkOf(item);
                if (AlreadyTold(db, person, link)) continue;
                var title = reassigned ? $"Assigned to you: {item.Title}" : item.Kind == "approval" ? $"To approve: {item.Title}" : item.AssigneeId == person.ToString() ? $"For you: {item.Title}" : $"New task: {item.Title}";
                notices.ToPerson(person, actorId, title, Detail(item, schemes), link, sendEmail: false, kind: KindOf(item.Type));
            }
            else
            {
                var approvals = items.Count(i => i.Item.Kind == "approval");
                var what = approvals == items.Count ? $"{items.Count} approvals" : approvals == 0 ? $"{items.Count} tasks" : $"{items.Count} items of work";
                var refs = string.Join(", ", items.Take(5).Select(i => i.Item.Ref)) + (items.Count > 5 ? $" and {items.Count - 5} more" : "");
                notices.ToPerson(person, actorId, items.All(i => i.Reassigned) ? $"{what} assigned to you" : $"{what} for you", $"{refs}. They’re in My work.",
                    approvals == items.Count ? "/approvals" : "/tasks", sendEmail: false, kind: KindOf(items[0].Item.Type));
            }
        }
    }

    /// <summary>The people who act on this item, active, without the person who raised it.</summary>
    private static async Task<List<Guid>> WhoActsAsync(HumoDbContext db, WorkItemRow item, Guid? actorId, CancellationToken ct)
    {
        if (Guid.TryParse(item.AssigneeId, out var assignee)) return assignee == actorId ? [] : [assignee];

        List<Guid> people;
        if (item.Kind == "approval")
        {
            var roles = (JsonSerializer.Deserialize<List<string>>(item.ApproverRoles) ?? []).Where(r => r != Roles.Trustee).ToList();
            people = await StaffAsync(db, item, roles, actorId, ct);
            // D24: with nobody else at the agency to decide it, a trustee on Humo approves.
            if (people.Count == 0 && item.SchemeId is { } scheme) people = await TrusteesOnHumoAsync(db, scheme, actorId, ct);
            return people;
        }

        var doers = new List<string>();
        if (WorkItemAccess.FinanceTypes.Contains(item.Type)) doers.Add(Roles.Finance);
        if (WorkItemAccess.OperationsTypes.Contains(item.Type)) doers.Add(Roles.Operations);
        if (!WorkItemAccess.NotForPortfolioManagers.Contains(item.Type)) doers.Add(Roles.PortfolioManager);
        // D32: conduct records stay with those who enforce the rules.
        if (item.Type == WorkItemAccess.RuleBreach) doers = [.. doers.Where(r => AccessCatalogue.PermissionsOf(r).Contains("Rules.Enforce"))];
        people = await StaffAsync(db, item, doers, actorId, ct);
        return people.Count > 0 ? people : await StaffAsync(db, item, [Roles.AgencyAdmin], actorId, ct);
    }

    private static async Task<List<Guid>> StaffAsync(HumoDbContext db, WorkItemRow item, List<string> roles, Guid? actorId, CancellationToken ct)
    {
        if (roles.Count == 0) return [];
        var assignments = await db.RoleAssignments.AsNoTracking()
            .Where(a => a.OrganisationId == item.OrganisationId && a.Status == AssignmentStatuses.Active && roles.Contains(a.Role)).ToListAsync(ct);
        var users = assignments.Where(a => a.ScopeType == ScopeTypes.Organisation || (item.SchemeId is { } s && a.SchemeIds.Contains(s.ToString())))
            .Select(a => a.UserId).Where(u => u != actorId).Distinct().ToList();
        return await db.Users.AsNoTracking().Where(u => users.Contains(u.Id) && u.Status == IdentityStatuses.Active).Select(u => u.Id).ToListAsync(ct);
    }

    private static async Task<List<Guid>> TrusteesOnHumoAsync(HumoDbContext db, Guid schemeId, Guid? actorId, CancellationToken ct)
    {
        var assignments = await db.RoleAssignments.AsNoTracking().Where(a => a.Role == Roles.Trustee && a.Status == AssignmentStatuses.Active).ToListAsync(ct);
        var users = assignments.Where(a => a.SchemeIds.Contains(schemeId.ToString())).Select(a => a.UserId).Where(u => u != actorId).Distinct().ToList();
        return await db.Users.AsNoTracking().Where(u => users.Contains(u.Id) && u.Status == IdentityStatuses.Active).Select(u => u.Id).ToListAsync(ct);
    }

    /// <summary>A feature that already told this person about this record in the same change, e.g. a breach's trustees.</summary>
    private static bool AlreadyTold(HumoDbContext db, Guid person, string link) =>
        db.ChangeTracker.Entries<Notice>().Any(e => e.State == EntityState.Added && e.Entity.ToIdentityId == person && e.Entity.Link == link);

    private static string LinkOf(WorkItemRow item) =>
        !string.IsNullOrWhiteSpace(item.Route) ? item.Route : item.Kind == "approval" ? "/approvals" : "/tasks";

    private static string Detail(WorkItemRow item, IReadOnlyDictionary<Guid, string> schemes)
    {
        var parts = new List<string> { item.Ref };
        if (item.SchemeId is { } s && schemes.TryGetValue(s, out var name)) parts.Add(name);
        if (item.Amount is { } amount) parts.Add(Humo.Domain.Finance.BillingRules.Rand(amount));
        // South African dates (CLAUDE.md).
        parts.Add("due " + item.DueAt.ToOffset(TimeSpan.FromHours(2)).ToString("d MMMM", CultureInfo.InvariantCulture));
        return string.Join(" · ", parts) + ".";
    }

    /// <summary>The bell's icon for the kind of work (the app's NotificationKind).</summary>
    public static string KindOf(string type) => type switch
    {
        "receipt-allocation" or "debtor-follow-up" or "demand-approval" or "invoice-approval" or "payment-batch-approval" or "billing-run-approval"
            or "account-correction" or "bank-details-verification" => "finance",
        "maintenance-triage" or "maintenance-overdue" or "quote-approval" => "maintenance",
        "document-expiry" => "compliance",
        "owner-message" => "communication",
        "resolution-approval" or "minutes-approval" or "meeting-action" or WorkItemAccess.RuleBreach => "governance",
        _ => "platform",
    };
}
