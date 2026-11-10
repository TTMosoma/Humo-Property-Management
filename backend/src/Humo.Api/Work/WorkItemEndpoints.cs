using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Work;

public sealed record WorkItemDto(string Id, string Ref, string Kind, string Type, string Title, string Detail, string SchemeId, decimal? Amount, int? Count, string CreatedAt, string DueAt,
    string? AssigneeId, IReadOnlyList<string> ApproverRoles, IReadOnlyList<string> Evidence, string Status, string? DecidedBy, string? DecidedAt, string? Comment, string Route,
    string? HeldUntil = null, string? HeldBy = null, SecondAuthoriserDto? SecondAuthoriser = null, Finance.BudgetLineSpendDto? Budget = null, BoardProgressDto? Board = null);
public sealed record WorkIdsRequest(List<string> Ids);
public sealed record AssignRequest(List<string> Ids, string? AssigneeId);
/// <param name="Alone">Approve alone under the trustees' permission (D24), when that's the only way.</param>
public sealed record DecisionRequest(string Decision, string? Comment, bool? Alone = null);

/// <summary>What happens to the record an approval is about once it's decided (e.g. a billing run moves on).</summary>
public interface IApprovalHandler
{
    string Type { get; }
    /// <summary>Refuse (with a reason) before the decision is recorded, e.g. the person who prepared it can't approve it.</summary>
    Task<string?> RefuseAsync(WorkItemRow item, Actor actor, bool approve, CancellationToken ct);
    Task DecidedAsync(WorkItemRow item, Actor actor, bool approve, string? comment, CancellationToken ct);
    /// <summary>Approving always needs the passkey, whatever the amount, and never an SMS code (e.g. a supplier's bank details, D27).</summary>
    bool NeedsPasskey => false;
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
        g.MapPost("/{id:guid}/cancel-hold", CancelHold);
    }

    private static async Task<IResult> List(CurrentActor current, HumoDbContext db, IEnumerable<IApprovalHandler> handlers, SoleAuthority sole, BoardApprovals board, Finance.Budgets budgets,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.OrganisationId is not { } org || !actor.Can("Work.View")) return Results.Ok(Array.Empty<WorkItemDto>());
        var schemes = await SchemeEndpoints.Visible(actor, db).Select(s => s.Id).ToListAsync(ct);
        var items = await db.WorkItems.Where(w => w.OrganisationId == org && (w.SchemeId == null || schemes.Contains(w.SchemeId.Value))).ToListAsync(ct);
        var list = new List<WorkItemDto>();
        foreach (var w in items.OrderBy(w => w.DueAt))
        {
            // An approval this person can't approve (they prepared it): who can, when the agency has nobody else (D24).
            SecondAuthoriserDto? second = null;
            if (w.Kind == "approval" && w.Status == "open" && handlers.FirstOrDefault(h => h.Type == w.Type) is { } handler && await handler.RefuseAsync(w, actor, true, ct) is not null)
                second = await sole.SecondAuthoriserAsync(w, actor.Human.Id, ct);
            var dto = ToDto(w) with { SecondAuthoriser = second };
            // D39: the board decides it, by a majority; who has decided so far.
            if (w.BoardMajority) dto = dto with { Board = await board.ProgressAsync(w, actor, ct) };
            // With one authoriser at the agency, the scheme's trustees decide it too (D24).
            if (w.Kind == "approval" && w.Status == "open" && w.SchemeId is not null && !w.BoardMajority && !dto.ApproverRoles.Contains(Domain.Access.Roles.Trustee)
                && (await sole.StaffApproversAsync(w, ct)).Count <= 1)
                dto = dto with { ApproverRoles = [.. dto.ApproverRoles, Domain.Access.Roles.Trustee] };
            // Quotes and invoices waiting for a decision show the job's budget line and what's been spent (D28).
            if (w.Kind == "approval" && w.Status == "open" && w.SchemeId is { } scheme && w.Type is "quote-approval" or "invoice-approval"
                && await JobCategoryAsync(w, db, ct) is { } category)
                dto = dto with { Budget = await budgets.LineForAsync(scheme, category, ct) };
            if (WorkItemAccess.CanSee(actor, w, dto.ApproverRoles)) list.Add(dto);
        }
        return Results.Ok(list);
    }

    private static Task<IResult> Complete(WorkIdsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct) =>
        Change(body.Ids, "Completed", current, commands, db, (w, actor) => { w.Status = "done"; w.DecidedBy = actor.Human.Name; w.DecidedAt = DateTimeOffset.UtcNow; }, ct, onlyTasks: true,
            refuse: items => items.Any(w => WorkItemAccess.ClosedByTheirOwnStep.Contains(w.Type)) ? "This task closes itself when the work is done: open it and take the next step." : null);

    private static Task<IResult> Reopen(WorkIdsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct) =>
        Change(body.Ids, "Reopened", current, commands, db, (w, _) => { w.Status = "open"; w.DecidedBy = null; w.DecidedAt = null; }, ct, onlyTasks: true);

    private static async Task<IResult> Assign(AssignRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, StaffCovers staff, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org }) return Results.Unauthorized();
        // D32: a rule breach goes only to someone who can act on it.
        var canTakeBreaches = body.AssigneeId is null || await staff.CanEnforceRulesAsync(org, body.AssigneeId, ct);
        return await Change(body.Ids, body.AssigneeId is null ? "Unassigned" : "Assigned", current, commands, db, (w, _) => w.AssigneeId = body.AssigneeId, ct, onlyTasks: false,
            refuse: items => !canTakeBreaches && items.Any(w => w.Type == WorkItemAccess.RuleBreach) ? "A rule breach can only go to someone who enforces the rules: a portfolio manager or an administrator." : null);
    }

    private static async Task<IResult> Change(List<string>? ids, string verb, CurrentActor current, CommandRunner commands, HumoDbContext db, Action<WorkItemRow, Actor> apply,
        CancellationToken ct, bool onlyTasks, Func<List<WorkItemRow>, string?>? refuse = null)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var keys = (ids ?? []).Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).ToList();
        var schemes = await SchemeEndpoints.Visible(me, db).Select(s => s.Id).ToListAsync(ct);
        var items = await db.WorkItems.Where(w => keys.Contains(w.Id) && w.OrganisationId == me.OrganisationId && (w.SchemeId == null || schemes.Contains(w.SchemeId.Value))).ToListAsync(ct);
        return await commands.RunAsync(new CommandSpec($"{verb} {items.Count} work item{(items.Count == 1 ? "" : "s")}: {string.Join(", ", items.Select(i => i.Ref))}", "Work.Manage")
        {
            Resource = "Work item",
            Validate = () => items.Count != keys.Count || items.Count == 0 || !items.All(w => WorkItemAccess.CanSee(me, w)) ? new() { ["ids"] = "Some of these aren’t yours to change." }
                : onlyTasks && items.Any(i => i.Kind == "approval") ? new() { ["ids"] = "Approvals are decided, not completed." }
                : refuse?.Invoke(items) is { } reason ? new() { ["ids"] = reason } : [],
        }, actor =>
        {
            foreach (var w in items) apply(w, actor);
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> Decide(Guid id, DecisionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, IEnumerable<IApprovalHandler> handlers,
        SoleAuthority sole, BoardApprovals board, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var item = await db.WorkItems.FirstOrDefaultAsync(w => w.Id == id && w.OrganisationId == me.OrganisationId, ct);
        if (item is null || (item.SchemeId is { } s && !await SchemeEndpoints.Visible(me, db).AnyAsync(x => x.Id == s, ct))) return Problems.NotFound();
        var org = await db.Organisations.FirstAsync(o => o.Id == item.OrganisationId, ct);
        var approve = body.Decision == "approved";
        var roles = JsonSerializer.Deserialize<List<string>>(item.ApproverRoles) ?? [];
        var handler = handlers.FirstOrDefault(h => h.Type == item.Type);
        var refused = handler is null ? null : await handler.RefuseAsync(item, me, approve, ct);
        // D24: the preparer is the agency's only approver. A trustee on Humo approves instead; failing that, approving
        // alone under the trustees' permission, held for the cooling-off.
        var second = refused is not null ? await sole.SecondAuthoriserAsync(item, me.Human.Id, ct) : null;
        if (second is not null) refused = second.Note;
        var permission = second?.Mode == "alone" && body.Alone == true && item.SchemeId is { } scheme ? await sole.InForceAsync(scheme, ct) : null;
        var alone = permission is not null;
        var trusteeMay = await sole.TrusteeMayDecideAsync(item, me, ct);

        var verb = alone ? "Approved alone under the trustees’ permission (D24), in effect after the 24-hour cooling-off:" : approve ? "Approved" : "Rejected";
        return await commands.RunAsync(new CommandSpec($"{verb} {item.Ref}: {item.Title}{(string.IsNullOrWhiteSpace(body.Comment) ? "" : $" — {body.Comment.Trim()}")}", "Approvals.Decide")
        {
            Resource = "Approval",
            ResourceId = id.ToString(),
            SchemeId = item.SchemeId,
            Category = "security",
            // Approving a large amount needs a fresh passkey; rejecting never does.
            // Approving alone always does (D24).
            StepUp = approve && (alone || item.Amount >= org.ApprovalStepUpAmount || handler?.NeedsPasskey == true),
            // D26: an SMS code can confirm an approval, but approving alone (D24) and bank details (D27) always need the passkey.
            SmsStepUpAllowed = !alone && handler?.NeedsPasskey != true,
            Validate = () =>
                body.Decision is not ("approved" or "rejected") ? new() { ["decision"] = "Approve or reject." }
                : item.Kind != "approval" || item.Status != "open" ? new() { ["status"] = "This isn’t waiting for a decision." }
                : !approve && (body.Comment ?? "").Trim().Length < 5 ? new() { ["comment"] = "Say why, so it can be put right." } : [],
        }, async actor =>
        {
            if (!roles.Contains(actor.Assignment.Role) && !trusteeMay) throw new CommandRefused("forbidden", "Your role doesn’t decide this approval");
            // D39: one trustee's vote; the board's majority decides.
            if (item.BoardMajority)
            {
                await board.VoteAsync(item, actor, approve, body.Comment, ct);
                return Results.NoContent();
            }
            if (alone)
            {
                sole.Hold(item, actor, permission!, body.Comment);
                return Results.NoContent();
            }
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

    /// <summary>Stops an approval in its cooling-off (D24): it's waiting for a decision again. The approver, or another approver.</summary>
    private static async Task<IResult> CancelHold(Guid id, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var item = await db.WorkItems.FirstOrDefaultAsync(w => w.Id == id && w.OrganisationId == me.OrganisationId, ct);
        if (item is null) return Problems.NotFound();
        var roles = JsonSerializer.Deserialize<List<string>>(item.ApproverRoles) ?? [];
        return await commands.RunAsync(new CommandSpec($"Stopped {item.Ref} in its cooling-off: it waits for a decision again", "Approvals.Decide")
        {
            Resource = "Approval",
            ResourceId = id.ToString(),
            SchemeId = item.SchemeId,
            Category = "security",
            Validate = () => item.Status != SoleAuthority.HeldStatus ? new() { ["status"] = "This isn’t in its cooling-off." } : [],
        }, actor =>
        {
            if (item.HeldById != actor.Human.Id && !roles.Contains(actor.Assignment.Role) && actor.Assignment.Role != Domain.Access.Roles.Trustee)
                throw new CommandRefused("forbidden", "Only an approver can stop it");
            SoleAuthority.CancelHold(item);
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>The category of the job a quote or invoice approval is about.</summary>
    private static async Task<string?> JobCategoryAsync(WorkItemRow w, HumoDbContext db, CancellationToken ct)
    {
        var jobId = w.Type == "quote-approval" ? w.SourceId
            : await db.SupplierInvoices.Where(i => i.ApprovalWorkItemId == w.Id).Select(i => i.JobId).FirstOrDefaultAsync(ct);
        return jobId is { } id && await db.Jobs.FirstOrDefaultAsync(j => j.Id == id, ct) is { } row ? Maintenance.MaintenanceService.Read(row).Category : null;
    }

    internal static WorkItemDto ToDto(WorkItemRow w) => new(w.Id.ToString(), w.Ref, w.Kind, w.Type, w.Title, w.Detail, w.SchemeId?.ToString() ?? "", w.Amount, w.Count,
        w.CreatedAt.ToString("O"), w.DueAt.ToString("O"), w.AssigneeId, JsonSerializer.Deserialize<List<string>>(w.ApproverRoles) ?? [], JsonSerializer.Deserialize<List<string>>(w.Evidence) ?? [],
        w.Status, w.DecidedBy, w.DecidedAt?.ToString("O"), w.Comment, w.Route, w.HeldUntil?.ToString("O"), w.HeldBy);

    public static string Roles(params string[] roles) => JsonSerializer.Serialize(roles, Json.Options);
}
