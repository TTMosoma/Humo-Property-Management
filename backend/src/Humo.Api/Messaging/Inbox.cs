using System.Globalization;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Finance;
using Humo.Api.Portfolio;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Messaging;

// The shapes match inbox.ts in the app.
public sealed record ConversationMessage(string Id, string At, string From, string By, string Body, string Channel, string? SentId);
public sealed record ConversationLink(string Label, string Route);
public sealed record ConversationDto(string Id, int Version, string Ref, string SchemeId, string PersonId, string? UnitId, string Subject, string Status, string? AssigneeId,
    string? WorkItemId, List<ConversationMessage> Messages, List<ConversationLink> Links);
public sealed record ConversationViewDto(ConversationDto Conversation, PersonDto Person, SchemeDto Scheme, UnitDto? Unit, AccountDto? Account, List<object> OpenJobs, string AssigneeName,
    string LastAt);
public sealed record ConversationAction(string Type, string? Body, string? Channel, bool? Close, string? AssigneeId, string? Title, string? Location, string? DueAt);
public sealed record ConversationActionRequest(ConversationAction? Action, int? ExpectedVersion);
public sealed record ResidentMessageRequest(string? Subject, string? Body, string? ConversationId);

/// <summary>
/// The Inbox on the API: conversations with owners, tenants and trustees, each with the person's unit, balance and scheme
/// in view. A conversation that needs a reply has an open "owner message" item in My work; replying closes it, and the
/// reply goes out by email, SMS or the portal and is recorded in Sent. Residents write from the portal.
/// </summary>
public sealed class Inbox(HumoDbContext db, TimeProvider clock)
{
    private DateTimeOffset Now => clock.GetUtcNow();

    public static List<ConversationMessage> Messages(ConversationRow c) => JsonSerializer.Deserialize<List<ConversationMessage>>(c.Messages, Json.Options) ?? [];

    public async Task<List<ConversationViewDto>> ViewsAsync(List<ConversationRow> rows, CancellationToken ct)
    {
        if (rows.Count == 0) return [];
        var people = await db.People.Where(p => rows.Select(r => r.PersonId).Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        var unitIds = rows.Where(r => r.UnitId != null).Select(r => r.UnitId!.Value).ToList();
        var units = await db.Units.Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, ct);
        var accounts = await db.LevyAccounts.Where(a => unitIds.Contains(a.UnitId)).ToDictionaryAsync(a => a.UnitId, ct);
        var schemes = (await SchemeEndpoints.ToDtos(await db.Schemes.Where(s => rows.Select(r => r.SchemeId).Contains(s.Id)).ToListAsync(ct), db, ct)).ToDictionary(s => s.Id);
        var assignees = rows.Where(r => Guid.TryParse(r.AssigneeId, out _)).Select(r => Guid.Parse(r.AssigneeId!)).Distinct().ToList();
        var names = await db.Users.Where(u => assignees.Contains(u.Id)).ToDictionaryAsync(u => u.Id.ToString(), u => u.Name, ct);
        return [.. rows.OrderByDescending(r => r.LastAt).Select(r => new ConversationViewDto(
            new ConversationDto(r.Id.ToString(), r.Version, r.Ref, r.SchemeId.ToString(), r.PersonId.ToString(), r.UnitId?.ToString(), r.Subject, r.Status, r.AssigneeId,
                r.WorkItemId?.ToString(), Messages(r), JsonSerializer.Deserialize<List<ConversationLink>>(r.Links, Json.Options) ?? []),
            PortfolioReads.ToDto(people[r.PersonId]), schemes[r.SchemeId.ToString()], r.UnitId is { } u && units.TryGetValue(u, out var unit) ? PortfolioReads.ToDto(unit) : null,
            r.UnitId is { } x && accounts.TryGetValue(x, out var a) ? PortfolioReads.ToDto(a) : null, [], r.AssigneeId is { } id ? names.GetValueOrDefault(id, "Unassigned") : "Unassigned",
            r.LastAt.ToString("O")))];
    }

    /// <summary>A message from the person: on their conversation, or a new one. Either way it needs a reply, so it's in My work.</summary>
    public async Task<ConversationRow> FromThemAsync(Person person, Guid schemeId, Guid? unitId, string subject, string body, string channel, ConversationRow? existing, CancellationToken ct)
    {
        var c = existing;
        if (c is null)
        {
            var orgId = await db.Schemes.Where(s => s.Id == schemeId).Select(s => s.OrganisationId).FirstAsync(ct);
            var refs = await db.Conversations.Where(x => x.OrganisationId == orgId).Select(x => x.Ref).ToListAsync(ct);
            var next = refs.Select(r => int.TryParse(r.AsSpan(3), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0).DefaultIfEmpty(1000).Max() + 1;
            c = new ConversationRow { Id = Guid.CreateVersion7(), Ref = $"CV-{next}", OrganisationId = orgId, SchemeId = schemeId, PersonId = person.Id, UnitId = unitId, Subject = subject };
            db.Conversations.Add(c);
        }
        Append(c, new ConversationMessage(NewId(), Now.ToString("O"), "them", person.DisplayName, body, channel, null));
        c.Status = "open";
        c.Version++;
        await OpenWorkAsync(c, person, body, ct);
        return c;
    }

    public void Append(ConversationRow c, ConversationMessage m)
    {
        var list = Messages(c);
        list.Add(m);
        c.Messages = JsonSerializer.Serialize(list, Json.Options);
        c.LastAt = Now;
    }

    public static string NewId() => $"cm-{Guid.NewGuid():N}"[..15];

    private async Task OpenWorkAsync(ConversationRow c, Person person, string detail, CancellationToken ct)
    {
        if (c.WorkItemId is { } open && await db.WorkItems.AnyAsync(w => w.Id == open && w.Status == "open", ct)) return;
        var unit = c.UnitId is { } u ? await db.Units.FirstOrDefaultAsync(x => x.Id == u, ct) : null;
        var item = new WorkItemRow
        {
            Id = Guid.CreateVersion7(), OrganisationId = c.OrganisationId, SchemeId = c.SchemeId, Ref = c.Ref, Kind = "message", Type = "owner-message", Title = c.Subject,
            Detail = $"{person.DisplayName}{(unit is null ? "" : $" · Unit {unit.Number}")}: {(detail.Length > 100 ? detail[..97] + "…" : detail)}", CreatedAt = Now, DueAt = Now.AddDays(1),
            AssigneeId = c.AssigneeId, Route = $"/inbox?c={c.Id}", SourceId = c.Id,
        };
        db.WorkItems.Add(item);
        c.WorkItemId = item.Id;
    }

    public async Task CloseWorkAsync(ConversationRow c, string by, CancellationToken ct)
    {
        if (c.WorkItemId is { } id && await db.WorkItems.FirstOrDefaultAsync(w => w.Id == id, ct) is { Status: "open" } w)
        {
            w.Status = "done";
            w.DecidedBy = by;
            w.DecidedAt = Now;
        }
        c.WorkItemId = null;
    }

    public async Task ReopenWorkAsync(ConversationRow c, CancellationToken ct)
    {
        var person = await db.People.FirstAsync(p => p.Id == c.PersonId, ct);
        await OpenWorkAsync(c, person, "Reopened", ct);
    }
}

/// <summary>
/// Inbox endpoints:
///   GET  /inbox?schemeIds=…       Communications.View, within the person's schemes
///   GET  /inbox/{id}
///   POST /inbox/{id}/actions       reply, assign, close, reopen, turn into a Task (Messages.Reply)
///   GET  /me/conversations         residents: their own (Resident.Portal)
///   POST /me/conversations         residents: write to the managing agent
/// </summary>
public static class InboxEndpoints
{
    public static void MapInbox(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/inbox").RequireAuthorization();
        g.MapGet("", List);
        g.MapGet("/{id:guid}", Get);
        g.MapPost("/{id:guid}/actions", Act);
        var me = api.MapGroup("/me/conversations").RequireAuthorization();
        me.MapGet("", Mine);
        me.MapPost("", Write);
    }

    private static async Task<IQueryable<ConversationRow>?> VisibleAsync(Actor actor, HumoDbContext db, CancellationToken ct)
    {
        if (actor.OrganisationId is not { } org || !actor.Can("Communications.View")) return null;
        var schemes = await SchemeEndpoints.Visible(actor, db).Select(s => s.Id).ToListAsync(ct);
        return db.Conversations.Where(c => c.OrganisationId == org && schemes.Contains(c.SchemeId));
    }

    private static async Task<IResult> List(string[]? schemeIds, CurrentActor current, HumoDbContext db, Inbox inbox, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await VisibleAsync(actor, db, ct) is not { } visible) return Results.Ok(Array.Empty<ConversationViewDto>());
        var wanted = (schemeIds ?? []).Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).ToList();
        return Results.Ok(await inbox.ViewsAsync(await visible.Where(c => wanted.Contains(c.SchemeId)).ToListAsync(ct), ct));
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, Inbox inbox, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await VisibleAsync(actor, db, ct) is not { } visible || await visible.FirstOrDefaultAsync(c => c.Id == id, ct) is not { } row) return Problems.NotFound();
        return Results.Ok((await inbox.ViewsAsync([row], ct))[0]);
    }

    private static async Task<IResult> Act(Guid id, ConversationActionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Inbox inbox, Communications comms,
        DeliveryQueue queue, TimeProvider clock, Maintenance.MaintenanceService maintenance, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await VisibleAsync(me, db, ct) is not { } visible || await visible.FirstOrDefaultAsync(c => c.Id == id, ct) is not { } c) return Problems.NotFound();
        var a = body.Action ?? new ConversationAction("", null, null, null, null, null, null, null);
        var person = await db.People.FirstAsync(p => p.Id == c.PersonId, ct);
        var (_, portal) = await comms.ContextAsync(c.SchemeId, ct);
        // Reply the way they wrote, unless the agent chooses: the portal for portal messages, else their preferred channel they can receive.
        var lastIn = Inbox.Messages(c).LastOrDefault(m => m.From == "them")?.Channel;
        var wanted = a.Channel is { } chosen ? [chosen] : lastIn is { } x && x is "portal" or "sms" or "email" ? new[] { x, person.PreferredChannel, "email", "sms", "portal" } : [person.PreferredChannel, "email", "sms", "portal"];
        // In that order: the first channel they can receive.
        var channel = wanted.Distinct().FirstOrDefault(w => Communications.ChannelFor(person, [w], portal).Channel is not null);
        var why = channel is null ? Communications.ChannelFor(person, wanted.Distinct().ToList(), portal).Why : null;
        var assignee = Guid.TryParse(a.AssigneeId, out var who) ? await db.RoleAssignments.AnyAsync(r => r.UserId == who && r.OrganisationId == c.OrganisationId && r.Status == AssignmentStatuses.Active, ct) : a.AssigneeId is null;
        DateOnly? due = DateOnly.TryParseExact((a.DueAt ?? "")[..Math.Min(10, (a.DueAt ?? "").Length)], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
        var verb = a.Type switch
        {
            "reply" => $"Replied to {c.Ref}", "assign" => $"Assigned {c.Ref}", "close" => $"Closed {c.Ref}", "reopen" => $"Reopened {c.Ref}", "to-task" => $"Made a Task from {c.Ref}",
            "to-job" => $"Made a job from {c.Ref}", _ => $"{a.Type} on {c.Ref}",
        };
        return await commands.RunAsync(new CommandSpec(verb, a.Type == "to-job" ? "Maintenance.Log" : Communications.Permission)
        {
            Resource = "Conversation",
            ResourceId = c.Ref,
            SchemeId = c.SchemeId,
            Feature = a.Type == "to-job" ? "maintenance-basic" : Communications.Feature,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = c.Version,
            Validate = () => a.Type switch
            {
                "reply" when (a.Body ?? "").Trim().Length < 2 => new() { ["body"] = "Write your reply." },
                "reply" when channel is null => new() { ["channel"] = $"{person.DisplayName}: {why}." },
                "assign" when !assignee => new() { ["assigneeId"] = "Choose someone in your team." },
                "close" when c.Status == "closed" => new() { ["id"] = "Already closed." },
                "reopen" when c.Status != "closed" => new() { ["id"] = "It’s not closed." },
                "to-task" when (a.Title ?? "").Trim().Length < 5 => new() { ["title"] = "What has to be done?" },
                "to-task" when due is null => new() { ["dueAt"] = "When by?" },
                "to-job" when (a.Title ?? "").Trim().Length < 5 => new() { ["title"] = "Describe the problem in a few words." },
                "to-job" when c.UnitId is null && (a.Location ?? "").Trim().Length < 2 => new() { ["location"] = "Where is it?" },
                "reply" or "assign" or "close" or "reopen" or "to-task" or "to-job" => [],
                _ => new() { ["type"] = "That isn’t something a conversation does." },
            },
        }, async actor =>
        {
            var by = actor.Human.Name;
            var result = c.Id.ToString();
            switch (a.Type)
            {
                case "reply":
                {
                    var text = a.Body!.Trim();
                    var unit = c.UnitId is { } u ? await db.Units.FirstOrDefaultAsync(x => x.Id == u, ct) : null;
                    var account = unit is null ? null : await db.LevyAccounts.FirstOrDefaultAsync(x => x.UnitId == unit.Id, ct);
                    var (message, now) = await comms.SendToAsync("reply", c.SchemeId, new Addressee(person, unit, account), channel!, $"Re: {c.Subject}", text,
                        $"{person.DisplayName} · {c.Ref}", by, new SentSourceDto($"Conversation {c.Ref}", $"/inbox?c={c.Id}"), ct);
                    inbox.Append(c, new ConversationMessage(Inbox.NewId(), clock.GetUtcNow().ToString("O"), "us", by, text, channel!, message.Id.ToString()));
                    c.Status = a.Close == true ? "closed" : "waiting";
                    await inbox.CloseWorkAsync(c, by, ct);
                    commands.AfterCommit(() =>
                    {
                        queue.Enqueue(DeliveryQueue.Messages, now);
                        return Task.CompletedTask;
                    });
                    break;
                }
                case "assign":
                    c.AssigneeId = a.AssigneeId;
                    if (c.WorkItemId is { } w && await db.WorkItems.FirstOrDefaultAsync(x => x.Id == w, ct) is { } item) item.AssigneeId = a.AssigneeId;
                    break;
                case "close":
                    c.Status = "closed";
                    await inbox.CloseWorkAsync(c, by, ct);
                    break;
                case "reopen":
                    c.Status = "open";
                    await inbox.ReopenWorkAsync(c, ct);
                    break;
                case "to-job":
                {
                    var scheme = await db.Schemes.FirstAsync(x => x.Id == c.SchemeId, ct);
                    var theirs = Inbox.Messages(c).LastOrDefault(m => m.From == "them")?.Body ?? c.Subject;
                    var role = c.UnitId is { } unitId && await db.Relationships.AnyAsync(r => r.PersonId == person.Id && r.UnitId == unitId && r.Type == "tenant", ct) ? "tenant"
                        : c.UnitId is not null ? "owner" : "trustee";
                    var reference = await maintenance.NewJobAsync(scheme, c.UnitId, a.Location, a.Title!.Trim(), theirs, "Building", "normal",
                        new Humo.Domain.Maintenance.ReportedBy(person.DisplayName, role, person.Id.ToString()), null, by, ct);
                    var links = JsonSerializer.Deserialize<List<ConversationLink>>(c.Links, Json.Options) ?? [];
                    links.Add(new ConversationLink($"Job {reference}", $"/maintenance/{reference}"));
                    c.Links = JsonSerializer.Serialize(links, Json.Options);
                    result = reference;
                    break;
                }
                case "to-task":
                {
                    var task = new WorkItemRow
                    {
                        Id = Guid.CreateVersion7(), OrganisationId = c.OrganisationId, SchemeId = c.SchemeId, Ref = $"{c.Ref}-T", Kind = "task", Type = "follow-up", Title = a.Title!.Trim(),
                        Detail = $"From {c.Ref}: {c.Subject}", CreatedAt = clock.GetUtcNow(), DueAt = new DateTimeOffset(due!.Value.ToDateTime(new TimeOnly(17, 0)), TimeSpan.FromHours(2)),
                        AssigneeId = actor.Human.Id.ToString(), Route = $"/inbox?c={c.Id}", SourceId = c.Id,
                    };
                    db.WorkItems.Add(task);
                    var links = JsonSerializer.Deserialize<List<ConversationLink>>(c.Links, Json.Options) ?? [];
                    links.Add(new ConversationLink($"Task: {task.Title}", "/tasks"));
                    c.Links = JsonSerializer.Serialize(links, Json.Options);
                    result = task.Id.ToString();
                    break;
                }
            }
            c.Version++;
            return Results.Ok(new { id = result });
        }, ct);
    }

    // ---------------------------------------------------------------- Residents

    private static async Task<(Person Person, Guid SchemeId, Guid? UnitId)?> ResidentAsync(Actor actor, HumoDbContext db, CancellationToken ct)
    {
        if (!actor.Can("Resident.Portal") || !Guid.TryParse(actor.User.PersonId, out var personId)) return null;
        if (await db.People.FirstOrDefaultAsync(p => p.Id == personId, ct) is not { } person) return null;
        Guid? unitId = Guid.TryParse(actor.Assignment.UnitId, out var u) ? u : null;
        var schemeId = Guid.TryParse(actor.Assignment.SchemeIds.FirstOrDefault(), out var s) ? s
            : await db.Relationships.Where(r => r.PersonId == personId).Select(r => r.SchemeId).FirstOrDefaultAsync(ct);
        if (unitId is null)
            unitId = await db.Relationships.Where(r => r.PersonId == personId && r.SchemeId == schemeId && r.UnitId != null).Select(r => r.UnitId).FirstOrDefaultAsync(ct);
        return schemeId == Guid.Empty ? null : (person, schemeId, unitId);
    }

    private static async Task<IResult> Mine(CurrentActor current, HumoDbContext db, Inbox inbox, SentRecords sent, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await ResidentAsync(actor, db, ct) is not { } me) return Results.Ok(Array.Empty<ConversationViewDto>());
        var rows = await db.Conversations.Where(c => c.PersonId == me.Person.Id).ToListAsync(ct);
        // Opening their conversations in the portal is reading our replies there.
        await sent.MarkReadAsync(rows.SelectMany(Inbox.Messages).Where(m => m.From == "us" && m.Channel == "portal" && m.SentId != null).Select(m => Guid.Parse(m.SentId!)), me.Person.Id, ct);
        return Results.Ok(await inbox.ViewsAsync(rows, ct));
    }

    private static async Task<IResult> Write(ResidentMessageRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Inbox inbox, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await ResidentAsync(actor, db, ct) is not { } me) return Problems.NotFound();
        var existing = Guid.TryParse(body.ConversationId, out var cid) ? await db.Conversations.FirstOrDefaultAsync(c => c.Id == cid && c.PersonId == me.Person.Id, ct) : null;
        var subject = (body.Subject ?? "").Trim();
        var text = (body.Body ?? "").Trim();
        return await commands.RunAsync(new CommandSpec(existing is null ? $"Wrote to the managing agent: {subject}" : $"Replied on {existing.Ref}", "Resident.Portal")
        {
            Resource = "Conversation",
            ResourceId = existing?.Ref,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (body.ConversationId is not null && existing is null) e["conversationId"] = "That conversation isn’t yours.";
                if (existing is null && subject.Length < 3) e["subject"] = "What is it about?";
                if (text.Length < 5) e["body"] = "Write your message.";
                return e;
            },
        }, async _ =>
        {
            var c = await inbox.FromThemAsync(me.Person, me.SchemeId, me.UnitId, subject, text, "portal", existing, ct);
            return Results.Created($"/api/me/conversations/{c.Id}", new { id = c.Id.ToString() });
        }, ct);
    }
}
