using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Work;

public sealed record WorkItemDto(string Id, string Ref, string Kind, string Type, string Title, string Detail, string SchemeId, decimal? Amount, int? Count, string CreatedAt, string DueAt,
    string? AssigneeId, IReadOnlyList<string> ApproverRoles, IReadOnlyList<string> Evidence, string Status, string? DecidedBy, string? DecidedAt, string? Comment, string Route);
public sealed record WorkIdsRequest(List<string> Ids);
public sealed record AssignRequest(List<string> Ids, string? AssigneeId);
public sealed record DecisionRequest(string Decision, string? Comment);

/// <summary>What happens to the record an approval is about once it's decided (e.g. a billing run moves on).</summary>
public interface IApprovalHandler
{
    string Type { get; }
    /// <summary>Refuse (with a reason) before the decision is recorded, e.g. the person who prepared it can't approve it.</summary>
    Task<string?> RefuseAsync(WorkItemRow item, Actor actor, bool approve, CancellationToken ct);
    Task DecidedAsync(WorkItemRow item, Actor actor, bool approve, string? comment, CancellationToken ct);
}

/// <summary>
/// The Attention model on the API: approvals and tasks in the person's organisation and schemes (My work).
/// Approvals are decided by the roles they name (Approvals.Decide); a large amount needs a fresh passkey,
/// at the agency's own threshold (R50 000 by default).
/// </summary>
public static class WorkItemEndpoints
{
    public static void MapWorkItems(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/work-items").RequireAuthorization();
        g.MapGet("", List);
        g.MapPost("/complete", Complete);
        g.MapPost("/reopen", Reopen);
        g.MapPost("/assign", Assign);
        g.MapPost("/{id:guid}/decision", Decide);
    }

    private static async Task<IResult> List(CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.OrganisationId is not { } org || !actor.Can("Work.View")) return Results.Ok(Array.Empty<WorkItemDto>());
        var schemes = await SchemeEndpoints.Visible(actor, db).Select(s => s.Id).ToListAsync(ct);
        var items = await db.WorkItems.Where(w => w.OrganisationId == org && (w.SchemeId == null || schemes.Contains(w.SchemeId.Value))).ToListAsync(ct);
        return Results.Ok(items.OrderBy(w => w.DueAt).Select(ToDto));
    }

    private static Task<IResult> Complete(WorkIdsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct) =>
        Change(body.Ids, "Completed", current, commands, db, (w, actor) => { w.Status = "done"; w.DecidedBy = actor.Human.Name; w.DecidedAt = DateTimeOffset.UtcNow; }, ct, onlyTasks: true);

    private static Task<IResult> Reopen(WorkIdsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct) =>
        Change(body.Ids, "Reopened", current, commands, db, (w, _) => { w.Status = "open"; w.DecidedBy = null; w.DecidedAt = null; }, ct, onlyTasks: true);

    private static Task<IResult> Assign(AssignRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct) =>
        Change(body.Ids, body.AssigneeId is null ? "Unassigned" : "Assigned", current, commands, db, (w, _) => w.AssigneeId = body.AssigneeId, ct, onlyTasks: false);

    private static async Task<IResult> Change(List<string>? ids, string verb, CurrentActor current, CommandRunner commands, HumoDbContext db, Action<WorkItemRow, Actor> apply,
        CancellationToken ct, bool onlyTasks)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var keys = (ids ?? []).Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).ToList();
        var schemes = await SchemeEndpoints.Visible(me, db).Select(s => s.Id).ToListAsync(ct);
        var items = await db.WorkItems.Where(w => keys.Contains(w.Id) && w.OrganisationId == me.OrganisationId && (w.SchemeId == null || schemes.Contains(w.SchemeId.Value))).ToListAsync(ct);
        return await commands.RunAsync(new CommandSpec($"{verb} {items.Count} work item{(items.Count == 1 ? "" : "s")}: {string.Join(", ", items.Select(i => i.Ref))}", "Work.Manage")
        {
            Resource = "Work item",
            Validate = () => items.Count != keys.Count || items.Count == 0 ? new() { ["ids"] = "Some of these aren’t yours to change." }
                : onlyTasks && items.Any(i => i.Kind == "approval") ? new() { ["ids"] = "Approvals are decided, not completed." } : [],
        }, actor =>
        {
            foreach (var w in items) apply(w, actor);
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> Decide(Guid id, DecisionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, IEnumerable<IApprovalHandler> handlers, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var item = await db.WorkItems.FirstOrDefaultAsync(w => w.Id == id && w.OrganisationId == me.OrganisationId, ct);
        if (item is null || (item.SchemeId is { } s && !await SchemeEndpoints.Visible(me, db).AnyAsync(x => x.Id == s, ct))) return Problems.NotFound();
        var org = await db.Organisations.FirstAsync(o => o.Id == item.OrganisationId, ct);
        var approve = body.Decision == "approved";
        var roles = JsonSerializer.Deserialize<List<string>>(item.ApproverRoles) ?? [];
        var handler = handlers.FirstOrDefault(h => h.Type == item.Type);
        var refused = handler is null ? null : await handler.RefuseAsync(item, me, approve, ct);

        return await commands.RunAsync(new CommandSpec($"{(approve ? "Approved" : "Rejected")} {item.Ref}: {item.Title}{(string.IsNullOrWhiteSpace(body.Comment) ? "" : $" — {body.Comment.Trim()}")}", "Approvals.Decide")
        {
            Resource = "Approval",
            ResourceId = id.ToString(),
            SchemeId = item.SchemeId,
            Category = "security",
            // Approving a large amount needs a fresh passkey; rejecting never does.
            StepUp = approve && item.Amount >= org.ApprovalStepUpAmount,
            Validate = () =>
                body.Decision is not ("approved" or "rejected") ? new() { ["decision"] = "Approve or reject." }
                : item.Kind != "approval" || item.Status != "open" ? new() { ["status"] = "This isn’t waiting for a decision." }
                : !approve && (body.Comment ?? "").Trim().Length < 5 ? new() { ["comment"] = "Say why, so it can be put right." } : [],
        }, async actor =>
        {
            if (!roles.Contains(actor.Assignment.Role)) throw new CommandRefused("forbidden", "Your role doesn’t decide this approval");
            if (refused is not null) throw new CommandRefused("conflict-of-interest", refused);
            item.Status = approve ? "approved" : "rejected";
            item.DecidedBy = actor.Human.Name;
            item.DecidedById = actor.Human.Id;
            item.DecidedAt = DateTimeOffset.UtcNow;
            item.Comment = string.IsNullOrWhiteSpace(body.Comment) ? null : body.Comment.Trim();
            if (handler is not null) await handler.DecidedAsync(item, actor, approve, item.Comment, ct);
            return Results.NoContent();
        }, ct);
    }

    internal static WorkItemDto ToDto(WorkItemRow w) => new(w.Id.ToString(), w.Ref, w.Kind, w.Type, w.Title, w.Detail, w.SchemeId?.ToString() ?? "", w.Amount, w.Count,
        w.CreatedAt.ToString("O"), w.DueAt.ToString("O"), w.AssigneeId, JsonSerializer.Deserialize<List<string>>(w.ApproverRoles) ?? [], JsonSerializer.Deserialize<List<string>>(w.Evidence) ?? [],
        w.Status, w.DecidedBy, w.DecidedAt?.ToString("O"), w.Comment, w.Route);

    public static string Roles(params string[] roles) => JsonSerializer.Serialize(roles, Json.Options);
}
