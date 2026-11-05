using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Commercial;
using Humo.Api.Portfolio;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Work;

// The shapes match the app's staff model (domain/models/staff.ts).
public sealed record StaffCoverDto(string CoverId, string CoverName, string From, string To, string Reason, string SetBy, List<string> MovedIds);
public sealed record StaffSummaryDto(string Id, string IdentityId, string Name, string Initials, string? Title, string Email, List<string> Roles, bool AllSchemes,
    List<SchemeDto> Schemes, int OpenTasks, int OverdueTasks, int OpenMessages, int ApprovalsWaiting, StaffCoverDto? Away, List<string> Covering);
public sealed record StaffDetailDto(string Id, string IdentityId, string Name, string Initials, string? Title, string Email, List<string> Roles, bool AllSchemes,
    List<SchemeDto> Schemes, int OpenTasks, int OverdueTasks, int OpenMessages, int ApprovalsWaiting, StaffCoverDto? Away, List<string> Covering,
    List<WorkItemDto> OpenWork, List<WorkItemDto> DoneRecently);
public sealed record CoverRequest(string? CoverId, string? From, string? To, string? Reason);

/// <summary>
/// Staff on the API: the agency's team (from Users &amp; access) with each person's workload from My work, and away
/// cover. While someone is away, their open tasks and messages move to a colleague, and so does new work assigned to
/// them (the minute loop picks it up). Approvals don't move: they're decided by role. When the cover ends, early or on
/// its last day, what's still open moves back.
/// </summary>
public sealed class StaffCovers(HumoDbContext db, TimeProvider clock)
{
    public static readonly string[] StaffRoles = [Roles.AgencyAdmin, Roles.PortfolioManager, Roles.Finance, Roles.Operations];

    public DateTimeOffset Now => clock.GetUtcNow();
    public DateOnly Today => DateOnly.FromDateTime(Now.ToOffset(TimeSpan.FromHours(2)).DateTime);

    private static List<Guid> Moved(StaffCoverRow c) => JsonSerializer.Deserialize<List<Guid>>(c.MovedIds) ?? [];

    /// <summary>Active staff of the organisation and their staff assignments in it.</summary>
    public async Task<List<(HumoUser User, List<RoleAssignment> Assignments)>> TeamAsync(Guid org, CancellationToken ct)
    {
        var assignments = await db.RoleAssignments.AsNoTracking()
            .Where(a => a.OrganisationId == org && a.Status == AssignmentStatuses.Active && StaffRoles.Contains(a.Role)).ToListAsync(ct);
        var ids = assignments.Select(a => a.UserId).Distinct().ToList();
        var users = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id) && u.Status == IdentityStatuses.Active).ToListAsync(ct);
        return [.. users.OrderBy(u => u.Name).Select(u => (u, assignments.Where(a => a.UserId == u.Id).ToList()))];
    }

    /// <summary>Covers that aren't over: today's, and ones still to come.</summary>
    public Task<List<StaffCoverRow>> OpenCoversAsync(Guid org, CancellationToken ct) => db.StaffCovers.Where(c => c.OrganisationId == org && c.EndedAt == null).ToListAsync(ct);

    public bool Active(StaffCoverRow c) => c.From <= Today && Today <= c.To;

    public async Task<(List<StaffSummaryDto> Staff, List<WorkItemRow> Items, Dictionary<Guid, string> Names)> SummariesAsync(Guid org, CancellationToken ct)
    {
        var team = await TeamAsync(org, ct);
        var names = team.ToDictionary(t => t.User.Id, t => t.User.Name);
        var covers = await OpenCoversAsync(org, ct);
        var items = await db.WorkItems.AsNoTracking().Where(w => w.OrganisationId == org).ToListAsync(ct);
        var allSchemes = await db.Schemes.Where(s => s.OrganisationId == org && s.Status != "archived").ToListAsync(ct);
        var schemeDtos = (await SchemeEndpoints.ToDtos(allSchemes, db, ct)).ToDictionary(s => s.Id);
        var now = Now;
        var list = team.Select(t =>
        {
            var me = t.User.Id.ToString();
            var roles = t.Assignments.Select(a => a.Role).Distinct().ToList();
            var everywhere = t.Assignments.Any(a => a.ScopeType == ScopeTypes.Organisation);
            var schemeIds = everywhere ? [.. allSchemes.Select(s => s.Id.ToString())] : t.Assignments.SelectMany(a => a.SchemeIds).Distinct().Where(schemeDtos.ContainsKey).ToList();
            var open = items.Where(w => w.Status == "open" && w.AssigneeId == me).ToList();
            var approvals = items.Count(w => w.Kind == "approval" && w.Status == "open" && (w.SchemeId is null || schemeIds.Contains(w.SchemeId.Value.ToString()))
                && (JsonSerializer.Deserialize<List<string>>(w.ApproverRoles) ?? []).Intersect(roles).Any());
            var away = covers.Where(c => c.StaffId == t.User.Id && c.To >= Today).OrderBy(c => c.From).FirstOrDefault();
            var covering = covers.Where(c => c.CoverId == t.User.Id && Active(c)).Select(c => names.GetValueOrDefault(c.StaffId, "a colleague")).ToList();
            return new StaffSummaryDto(me, me, t.User.Name, Initials(t.User.Name), t.User.Title, t.User.Email ?? "", roles, everywhere,
                [.. schemeIds.Select(id => schemeDtos[id]).OrderBy(s => s.Name)], open.Count(w => w.Kind == "task"), open.Count(w => w.Kind == "task" && w.DueAt < now),
                open.Count(w => w.Kind == "message"), approvals, away is null ? null : ToDto(away, names), covering);
        }).ToList();
        return (list, items, names);
    }

    public static StaffCoverDto ToDto(StaffCoverRow c, Dictionary<Guid, string> names) => new(c.CoverId.ToString(), names.GetValueOrDefault(c.CoverId, ""), c.From.ToString("yyyy-MM-dd"),
        c.To.ToString("yyyy-MM-dd"), c.Reason, c.SetBy, [.. Moved(c).Select(g => g.ToString())]);

    public static string Initials(string name)
    {
        var parts = name.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length switch { 0 => "?", 1 => parts[0][..Math.Min(2, parts[0].Length)].ToUpperInvariant(), _ => $"{parts[0][0]}{parts[^1][0]}".ToUpperInvariant() };
    }

    /// <summary>Moves the away person's open tasks and messages to the cover, including work assigned to them since. Approvals stay.</summary>
    public async Task MoveToCoverAsync(StaffCoverRow c, CancellationToken ct)
    {
        var staff = c.StaffId.ToString();
        var items = await db.WorkItems.Where(w => w.OrganisationId == c.OrganisationId && w.Status == "open" && w.AssigneeId == staff && w.Kind != "approval").ToListAsync(ct);
        if (items.Count == 0) return;
        foreach (var w in items) w.AssigneeId = c.CoverId.ToString();
        c.MovedIds = JsonSerializer.Serialize(Moved(c).Concat(items.Select(w => w.Id)).Distinct());
    }

    /// <summary>The cover is over: what's still open with the cover moves back.</summary>
    public async Task EndAsync(StaffCoverRow c, CancellationToken ct)
    {
        var moved = Moved(c);
        var cover = c.CoverId.ToString();
        foreach (var w in await db.WorkItems.Where(w => moved.Contains(w.Id) && w.Status == "open" && w.AssigneeId == cover).ToListAsync(ct))
            w.AssigneeId = c.StaffId.ToString();
        c.EndedAt = Now;
    }

    /// <summary>
    /// The minute loop: covers that have started take the away person's work (new work too); covers past their last
    /// day hand it back.
    /// </summary>
    public async Task SweepAsync(CancellationToken ct)
    {
        foreach (var c in await db.StaffCovers.Where(c => c.EndedAt == null).ToListAsync(ct))
        {
            if (c.To < Today) await EndAsync(c, ct);
            else if (c.From <= Today) await MoveToCoverAsync(c, ct);
        }
        await db.SaveChangesAsync(ct);
    }
}

public static class StaffEndpoints
{
    /// <summary>The plan's feature applies to reading too: feature flags only hide screens (CLAUDE.md).</summary>
    private const string TeamManagement = "team-management";

    public static void MapStaff(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/staff").RequireAuthorization();
        g.MapGet("", List);
        g.MapGet("/{staffId:guid}", Get);
        g.MapPut("/{staffId:guid}/cover", SetCover);
        g.MapDelete("/{staffId:guid}/cover", EndCover);
    }

    private static async Task<IResult> List(CurrentActor current, CommercialRecords commercial, StaffCovers staff, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.OrganisationId is not { } org || !actor.Can("Portfolio.Browse")) return Results.Ok(Array.Empty<StaffSummaryDto>());
        if (!await commercial.EntitledAsync(org, TeamManagement, ct)) return Problems.Policy("not-entitled", "Not included in the agency’s plan");
        return Results.Ok((await staff.SummariesAsync(org, ct)).Staff);
    }

    private static async Task<IResult> Get(Guid staffId, CurrentActor current, CommercialRecords commercial, StaffCovers staff, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.OrganisationId is not { } org || !actor.Can("Portfolio.Browse")) return Problems.NotFound();
        if (!await commercial.EntitledAsync(org, TeamManagement, ct)) return Problems.Policy("not-entitled", "Not included in the agency’s plan");
        var (team, items, _) = await staff.SummariesAsync(org, ct);
        if (team.FirstOrDefault(s => s.Id == staffId.ToString()) is not { } s) return Problems.NotFound();
        var since = staff.Now.AddDays(-14);
        var open = items.Where(w => w.Status == "open" && w.AssigneeId == s.Id).OrderBy(w => w.DueAt).Select(WorkItemEndpoints.ToDto).ToList();
        var done = items.Where(w => w.Status != "open" && w.DecidedAt >= since && (w.DecidedById == staffId || (w.AssigneeId == s.Id && w.Status == "done")))
            .OrderByDescending(w => w.DecidedAt).Take(15).Select(WorkItemEndpoints.ToDto).ToList();
        return Results.Ok(new StaffDetailDto(s.Id, s.IdentityId, s.Name, s.Initials, s.Title, s.Email, s.Roles, s.AllSchemes, s.Schemes, s.OpenTasks, s.OverdueTasks, s.OpenMessages,
            s.ApprovalsWaiting, s.Away, s.Covering, open, done));
    }

    /// <summary>Your own cover, or anyone's with Users.Manage. Replaces a cover that isn't over yet.</summary>
    private static async Task<IResult> SetCover(Guid staffId, CoverRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, StaffCovers staff, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org } me) return Results.Unauthorized();
        var team = (await staff.TeamAsync(org, ct)).ToDictionary(t => t.User.Id, t => t.User.Name);
        var covers = await staff.OpenCoversAsync(org, ct);
        var coverId = Guid.TryParse(body.CoverId, out var c) ? c : Guid.Empty;
        var from = DateOnly.TryParseExact(body.From, "yyyy-MM-dd", out var f) ? f : (DateOnly?)null;
        var to = DateOnly.TryParseExact(body.To, "yyyy-MM-dd", out var t) ? t : (DateOnly?)null;
        var reason = (body.Reason ?? "").Trim();
        var name = team.GetValueOrDefault(staffId, "someone");
        return await commands.RunAsync(new CommandSpec($"Set away cover for {name}: {team.GetValueOrDefault(coverId, "?")}, {body.From} to {body.To}", "Work.Manage")
        {
            Resource = "Staff",
            ResourceId = staffId.ToString(),
            Feature = TeamManagement,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (staffId != me.Human.Id && !me.Can("Users.Manage")) e["staffId"] = "Only an agency administrator can set someone else’s cover.";
                else if (!team.ContainsKey(staffId)) e["staffId"] = "Not on the team.";
                if (coverId == staffId) e["coverId"] = "Choose someone else to cover.";
                else if (!team.ContainsKey(coverId)) e["coverId"] = "Choose a colleague.";
                else if (covers.Any(x => x.StaffId == coverId && staff.Active(x))) e["coverId"] = $"{team[coverId]} is away too.";
                if (from is null || to is null || to < from) e["to"] = "The last day can’t be before the first.";
                else if (to < staff.Today) e["to"] = "That’s already over.";
                if (reason.Length < 3) e["reason"] = "E.g. leave, training, sick.";
                return e;
            },
        }, async actor =>
        {
            foreach (var old in covers.Where(x => x.StaffId == staffId)) await staff.EndAsync(old, ct);
            var row = new StaffCoverRow
            {
                Id = Guid.CreateVersion7(), OrganisationId = org, StaffId = staffId, CoverId = coverId, From = from!.Value, To = to!.Value, Reason = reason, SetBy = actor.Human.Name,
                SetAt = staff.Now,
            };
            db.StaffCovers.Add(row);
            if (staff.Active(row)) await staff.MoveToCoverAsync(row, ct);
            return Results.NoContent();
        }, ct);
    }

    /// <summary>Back early (or a cover still to come is called off): what's still open moves back.</summary>
    private static async Task<IResult> EndCover(Guid staffId, CurrentActor current, CommandRunner commands, StaffCovers staff, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org } me) return Results.Unauthorized();
        var covers = (await staff.OpenCoversAsync(org, ct)).Where(c => c.StaffId == staffId).ToList();
        var team = (await staff.TeamAsync(org, ct)).ToDictionary(t => t.User.Id, t => t.User.Name);
        return await commands.RunAsync(new CommandSpec($"Ended away cover for {team.GetValueOrDefault(staffId, "someone")}", "Work.Manage")
        {
            Resource = "Staff",
            ResourceId = staffId.ToString(),
            Feature = TeamManagement,
            Validate = () =>
                staffId != me.Human.Id && !me.Can("Users.Manage") ? new() { ["staffId"] = "Only an agency administrator can end someone else’s cover." }
                : covers.Count == 0 ? new() { ["staffId"] = "They aren’t away." }
                : [],
        }, async _ =>
        {
            foreach (var c in covers) await staff.EndAsync(c, ct);
            return Results.NoContent();
        }, ct);
    }
}
