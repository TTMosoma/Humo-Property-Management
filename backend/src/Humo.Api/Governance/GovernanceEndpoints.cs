using System.Globalization;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Finance;
using Humo.Api.Portfolio;
using Humo.Api.Settings;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Governance;

public sealed record NewMeetingRequest(string? SchemeId, string? Type, string? Title, string? ScheduledFor, string? Venue);
public sealed record NewResolutionInput(string? Title, string? Text, string? AgendaItemId, string? Outcome, Votes? Votes, List<NewAction>? Actions);
public sealed record MeetingAction(string? Type, string? Title, string? Notes, string? ItemId, string? ScheduledFor, string? Venue, List<string>? Documents, List<string>? PresentIds,
    int? OwnersPresent, string? Minute, NewResolutionInput? Resolution, string? Reason, string? Text);
public sealed record MeetingActionRequest(MeetingAction? Action, int? ExpectedVersion);
public sealed record WrittenResolutionRequest(string? SchemeId, string? Title, string? Text, List<NewAction>? Actions);

/// <summary>
/// Governance › Meetings and resolutions on the API. Reading needs Governance.View (resolutions: Resolutions.View, D32) within the person's schemes;
/// scheduling and running meetings and proposing written resolutions need Meetings.Manage, on a plan with governance.
/// The API enforces the lifecycle (what each stage allows), the notice period and quorum.
/// </summary>
public static class GovernanceEndpoints
{
    private static readonly Dictionary<string, string> Verbs = new()
    {
        ["add-agenda-item"] = "Added an agenda item to", ["remove-agenda-item"] = "Removed an agenda item from", ["reschedule"] = "Rescheduled", ["send-notice"] = "Sent notice of",
        ["pack-ready"] = "Finalised the pack for", ["record-attendance"] = "Recorded attendance at", ["record-minute"] = "Recorded a minute for",
        ["add-resolution"] = "Recorded a resolution at", ["send-minutes-for-approval"] = "Sent for approval the minutes of", ["cancel"] = "Cancelled", ["comment"] = "Commented on",
    };

    public static void MapGovernance(this IEndpointRouteBuilder api)
    {
        var m = api.MapGroup("/meetings").RequireAuthorization();
        m.MapGet("", List);
        m.MapGet("/{id}", Get);
        m.MapPost("", Create);
        m.MapPost("/{id}/actions", Act);
        var r = api.MapGroup("/resolutions").RequireAuthorization();
        r.MapGet("", Resolutions);
        r.MapGet("/assignees", Assignees);
        r.MapPost("/written", ProposeWritten);
    }

    private static async Task<List<Guid>?> SchemesAsync(Actor actor, HumoDbContext db, string[]? schemeIds, CancellationToken ct, string permission = "Governance.View")
    {
        if (actor.OrganisationId is null || !actor.Can(permission)) return null;
        var wanted = (schemeIds ?? []).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).ToHashSet();
        return [.. (await SchemeEndpoints.Visible(actor, db).Select(s => s.Id).ToListAsync(ct)).Where(wanted.Contains)];
    }

    private static async Task<IResult> List(string[]? schemeIds, int? page, int? pageSize, string? view, CurrentActor current, HumoDbContext db, Governance governance, HttpContext http,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await SchemesAsync(actor, db, schemeIds, ct) is not { } schemes) return Results.Ok(PortfolioReads.Page(new List<MeetingSummaryDto>(), page, pageSize));
        // The app sends filters[view]=upcoming|held|all.
        view ??= http.Request.Query["filters[view]"].FirstOrDefault() ?? "all";
        var rows = await db.Meetings.Where(x => schemes.Contains(x.SchemeId)).ToListAsync(ct);
        rows = view switch
        {
            "upcoming" => [.. rows.Where(x => !Governance.Held(x.Stage) && x.Stage != "cancelled").OrderBy(x => x.ScheduledFor)],
            "held" => [.. rows.Where(x => Governance.Held(x.Stage)).OrderByDescending(x => x.ScheduledFor)],
            _ => [.. rows.OrderByDescending(x => x.ScheduledFor)],
        };
        return Results.Ok(PortfolioReads.Page(await governance.SummariesAsync(rows, ct), page, pageSize));
    }

    private static async Task<MeetingRow?> VisibleAsync(Actor actor, HumoDbContext db, string id, CancellationToken ct)
    {
        if (actor.OrganisationId is not { } org || !actor.Can("Governance.View")) return null;
        var row = Guid.TryParse(id, out var g) ? await db.Meetings.FirstOrDefaultAsync(x => x.Id == g && x.OrganisationId == org, ct)
            : await db.Meetings.FirstOrDefaultAsync(x => x.Ref == id && x.OrganisationId == org, ct);
        return row is not null && await SchemeEndpoints.Visible(actor, db).AnyAsync(s => s.Id == row.SchemeId, ct) ? row : null;
    }

    private static async Task<MeetingDetailDto> DetailAsync(MeetingRow row, HumoDbContext db, Governance governance, CancellationToken ct)
    {
        var summary = (await governance.SummariesAsync([row], ct))[0];
        var resolutions = (await db.Resolutions.Where(r => r.MeetingId == row.Id).ToListAsync(ct)).OrderBy(r => r.Number).ToList();
        var scheme = await db.Schemes.FirstAsync(s => s.Id == row.SchemeId, ct);
        var agency = await db.Organisations.Where(o => o.Id == row.OrganisationId).Select(o => o.Name).FirstAsync(ct);
        return new MeetingDetailDto(summary.Meeting, summary.Scheme, summary.Resolutions, summary.OpenActions, await governance.ResolutionViewsAsync(resolutions, ct),
            await governance.AssigneesAsync(scheme, ct), agency);
    }

    private static async Task<IResult> Get(string id, CurrentActor current, HumoDbContext db, Governance governance, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        return await VisibleAsync(actor, db, id, ct) is { } row ? Results.Ok(await DetailAsync(row, db, governance, ct)) : Problems.NotFound();
    }

    private static async Task<IResult> Create(NewMeetingRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Governance governance, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var scheme = Guid.TryParse(body.SchemeId, out var sid) ? await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(s => s.Id == sid, ct) : null;
        var type = body.Type ?? "";
        var when = DateTimeOffset.TryParse(body.ScheduledFor, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var w) ? w : (DateTimeOffset?)null;
        var label = Governance.TypeLabels.GetValueOrDefault(type, "meeting");
        return await commands.RunAsync(new CommandSpec($"Scheduled a {label.ToLowerInvariant()}{(scheme is null ? "" : $" of {scheme.Name}")}", "Meetings.Manage")
        {
            Resource = "Meeting",
            SchemeId = scheme?.Id,
            Feature = "governance",
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (scheme is null) return new() { ["schemeId"] = "Choose a scheme." };
                if (!Governance.TypeLabels.ContainsKey(type)) e["type"] = "Choose the kind of meeting.";
                if (when is null) e["scheduledFor"] = "Choose the date and time.";
                else if (when < governance.Now) e["scheduledFor"] = "Choose a date in the future.";
                if ((body.Venue ?? "").Trim().Length < 2) e["venue"] = "Where is it held?";
                return e;
            },
        }, async actor =>
        {
            var count = await db.Meetings.CountAsync(x => x.SchemeId == scheme!.Id, ct) + 1;
            var id = Guid.CreateVersion7();
            var meeting = new Meeting
            {
                Id = id.ToString(), Ref = $"MTG-{scheme!.Code}-{count:000}", SchemeId = scheme.Id.ToString(), Type = type,
                Title = string.IsNullOrWhiteSpace(body.Title) ? $"{label} — {when!.Value.ToOffset(TimeSpan.FromHours(2)).ToString("MMMM yyyy", CultureInfo.InvariantCulture)}" : body.Title.Trim(),
                ScheduledFor = when!.Value.ToString("O"), Venue = body.Venue!.Trim(), Agenda = Governance.StandardAgenda(type), Attendees = await governance.AttendeesAsync(scheme, type, ct),
            };
            governance.Log(meeting, "stage", $"Scheduled for {Governance.When(meeting.ScheduledFor)} at {meeting.Venue}", actor.Human.Name);
            var row = new MeetingRow { Id = id, OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, Ref = meeting.Ref, Type = type };
            Governance.Write(row, meeting);
            db.Meetings.Add(row);
            return Results.Created($"/api/meetings/{id}", new { id = id.ToString() });
        }, ct);
    }

    private static async Task<IResult> Act(string id, MeetingActionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Governance governance,
        Messaging.EmailSignatures signatures, IEmailSender email, ILogger<Governance> logger, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await VisibleAsync(me, db, id, ct) is not { } row) return Problems.NotFound();
        var m = Governance.Read(row);
        var a = body.Action ?? new MeetingAction(null, null, null, null, null, null, null, null, null, null, null, null, null);
        var scheme = await db.Schemes.FirstAsync(s => s.Id == row.SchemeId, ct);
        var quorum = a.Type == "record-attendance" ? await governance.QuorumAsync(m, a.PresentIds ?? [], a.OwnersPresent ?? 0, ct) : default;
        var minutesOpen = m.Minutes?.ApprovalWorkItemId is { } mw && await db.WorkItems.AnyAsync(w => w.Id == Guid.Parse(mw) && w.Status == "open", ct);
        var when = DateTimeOffset.TryParse(a.ScheduledFor, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var w) ? w : (DateTimeOffset?)null;
        var earliest = governance.Now.AddDays(Governance.NoticeDays[m.Type]);

        return await commands.RunAsync(new CommandSpec($"{Verbs.GetValueOrDefault(a.Type ?? "", "Changed")} {m.Ref}: {m.Title}", "Meetings.Manage")
        {
            Resource = "Meeting",
            ResourceId = row.Id.ToString(),
            SchemeId = row.SchemeId,
            Feature = "governance",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = row.Version,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                void At(string what, params string[] stages)
                {
                    if (!stages.Contains(m.Stage)) e["stage"] = $"{what} isn’t possible while the meeting is {Governance.StageLabels[m.Stage].ToLowerInvariant()}.";
                }
                switch (a.Type)
                {
                    case "add-agenda-item":
                        At("Changing the agenda", "draft");
                        if (string.IsNullOrWhiteSpace(a.Title)) e["title"] = "Give the item a title.";
                        break;
                    case "remove-agenda-item":
                        At("Changing the agenda", "draft");
                        break;
                    case "reschedule":
                        At("Rescheduling", "draft");
                        if (when is null) e["date"] = "Choose a date.";
                        if (string.IsNullOrWhiteSpace(a.Venue)) e["venue"] = "Where is it held?";
                        break;
                    case "send-notice":
                        At("Sending notice", "draft");
                        if (m.Agenda.Count == 0) e["agenda"] = "Add at least one agenda item first.";
                        if (DateTimeOffset.Parse(m.ScheduledFor, CultureInfo.InvariantCulture) < earliest)
                            e["scheduledFor"] = $"{Governance.TypeLabels[m.Type]}s need {Governance.NoticeDays[m.Type]} days’ notice: the earliest date is {earliest.ToOffset(TimeSpan.FromHours(2)):d MMMM yyyy}. Reschedule first.";
                        break;
                    case "pack-ready":
                        At("Finalising the pack", "notice-sent");
                        if ((a.Documents ?? []).Count == 0) e["documents"] = "List the documents in the pack.";
                        break;
                    case "record-attendance":
                        At("Recording the meeting", "notice-sent", "pack-ready");
                        if (quorum.Present < quorum.Required)
                            e["presentIds"] = $"Not quorate: {quorum.Present} of {quorum.Voters} present, {quorum.Required} needed. The meeting can’t take decisions; adjourn it and reschedule.";
                        break;
                    case "record-minute":
                        At("Recording minutes", "held", "minutes-draft");
                        break;
                    case "add-resolution":
                    {
                        At("Recording a resolution", "held", "minutes-draft");
                        var r = a.Resolution;
                        if (r is null) return new() { ["title"] = "Describe the resolution." };
                        if (string.IsNullOrWhiteSpace(r.Title)) e["title"] = "Give the resolution a short title.";
                        if ((r.Text ?? "").Trim().Length < 10) e["text"] = "Write the resolution as it was passed.";
                        var v = r.Votes ?? new Votes(0, 0, 0);
                        var voters = m.Held?.Present ?? 0;
                        if (new[] { v.For, v.Against, v.Abstain }.Any(x => x < 0)) e["for"] = "Votes are whole numbers.";
                        else if (v.For + v.Against + v.Abstain > voters) e["for"] = $"Only {voters} voters were present.";
                        else if (r.Outcome == "passed" && v.For <= v.Against) e["outcome"] = "A resolution passes with more votes for than against.";
                        if (r.Outcome is not ("passed" or "not-passed")) e["outcome"] = "Passed or not passed.";
                        foreach (var (x, i) in (r.Actions ?? []).Select((x, i) => (x, i)))
                        {
                            if (string.IsNullOrWhiteSpace(x.Title)) e[$"action{i}"] = "Describe the action.";
                            if (!DateTimeOffset.TryParse(x.DueAt, CultureInfo.InvariantCulture, out _)) e[$"due{i}"] = "Give it a due date.";
                        }
                        break;
                    }
                    case "send-minutes-for-approval":
                        At("Sending minutes for approval", "held", "minutes-draft");
                        if (minutesOpen) e["stage"] = "The minutes are already with the trustees.";
                        break;
                    case "cancel":
                        At("Cancelling", "draft", "notice-sent", "pack-ready");
                        if ((a.Reason ?? "").Trim().Length < 5) e["reason"] = "Give a short reason; it goes to everyone who received notice.";
                        break;
                    case "comment":
                        if (string.IsNullOrWhiteSpace(a.Text)) e["text"] = "Write a comment.";
                        break;
                    default:
                        e["type"] = "Not something a meeting can do.";
                        break;
                }
                return e;
            },
        }, async actor =>
        {
            var by = actor.Human.Name;
            switch (a.Type)
            {
                case "add-agenda-item":
                    m.Agenda.Add(new AgendaItem { Id = Guid.CreateVersion7().ToString(), Title = a.Title!.Trim(), Notes = string.IsNullOrWhiteSpace(a.Notes) ? null : a.Notes.Trim() });
                    governance.Log(m, "stage", $"Agenda item added: {a.Title!.Trim()}", by);
                    break;
                case "remove-agenda-item":
                    if (m.Agenda.FirstOrDefault(x => x.Id == a.ItemId) is { } removed)
                    {
                        m.Agenda.Remove(removed);
                        governance.Log(m, "stage", $"Agenda item removed: {removed.Title}", by);
                    }
                    break;
                case "reschedule":
                    m.ScheduledFor = when!.Value.ToString("O");
                    m.Venue = a.Venue!.Trim();
                    governance.Log(m, "stage", $"Moved to {Governance.When(m.ScheduledFor)} at {m.Venue}", by);
                    break;
                case "send-notice":
                {
                    var recipients = await governance.NoticeRecipientsAsync(m, ct);
                    var byEmail = recipients.Where(p => SettingsEndpoints.IsEmail(p.Email)).ToList();
                    m.Notice = new MeetingNotice(governance.NowText, by, recipients.Count, await governance.TemplateAsync(row.OrganisationId, "meeting-notice", ct));
                    m.Stage = "notice-sent";
                    var who = m.Type == "trustee" ? "trustees" : "owners";
                    governance.Log(m, "notice", $"Notice sent to {recipients.Count} {who}: {byEmail.Count} by email{(recipients.Count > byEmail.Count ? $", {recipients.Count - byEmail.Count} without an email address to post" : "")}", by);
                    await SendAsync(byEmail, (p, agency) => Governance.NoticeEmail(m, p, scheme.Name, agency), "notice", m, row, db, signatures, email, logger, commands, ct);
                    break;
                }
                case "pack-ready":
                    m.Pack = a.Documents!;
                    m.Stage = "pack-ready";
                    governance.Log(m, "document", $"Meeting pack ready: {string.Join(", ", m.Pack)}", by);
                    break;
                case "record-attendance":
                    foreach (var at in m.Attendees) at.Present = (a.PresentIds ?? []).Contains(at.Id);
                    m.Held = new MeetingHeld(governance.NowText, true, quorum.Present, quorum.Voters, quorum.Required);
                    m.Stage = "held";
                    governance.Log(m, "stage", $"Meeting held: {quorum.Present} of {quorum.Voters} {(m.Type == "trustee" ? "trustees" : "owners (in person or by proxy)")} present, quorate", by);
                    break;
                case "record-minute":
                    if (m.Agenda.FirstOrDefault(x => x.Id == a.ItemId) is { } minuteItem) minuteItem.Minute = string.IsNullOrWhiteSpace(a.Minute) ? null : a.Minute.Trim();
                    StartMinutes(m, governance, by);
                    break;
                case "add-resolution":
                    await AddResolutionAsync(m, row, a.Resolution!, governance, db, by, ct);
                    StartMinutes(m, governance, by);
                    break;
                case "send-minutes-for-approval":
                {
                    StartMinutes(m, governance, by);
                    var count = await db.Resolutions.CountAsync(x => x.MeetingId == row.Id, ct);
                    var approval = new WorkItemRow
                    {
                        Id = Guid.CreateVersion7(), OrganisationId = row.OrganisationId, SchemeId = row.SchemeId, Ref = m.Ref, Kind = "approval", Type = "minutes-approval",
                        Title = $"Approve the minutes: {m.Title}", Detail = $"{count} resolution{(count == 1 ? "" : "s")} · held {Governance.When(m.Held?.At ?? m.ScheduledFor)}",
                        CreatedAt = governance.Now, DueAt = governance.Now.AddDays(7), ApproverRoles = Work.WorkItemEndpoints.Roles(Domain.Access.Roles.Trustee, Domain.Access.Roles.AgencyAdmin),
                        Evidence = JsonSerializer.Serialize(new[] { "Draft minutes" }.Concat(m.Pack)), Route = $"/governance/meetings/{m.Id}", SourceId = row.Id,
                    };
                    db.WorkItems.Add(approval);
                    m.Minutes!.ApprovalWorkItemId = approval.Id.ToString();
                    governance.Log(m, "stage", "Minutes sent to the trustees for approval", by);
                    break;
                }
                case "cancel":
                {
                    m.Stage = "cancelled";
                    m.Cancelled = new MeetingCancelled(governance.NowText, by, a.Reason!.Trim());
                    governance.Log(m, "stage", $"Cancelled: {a.Reason!.Trim()}{(m.Notice is not null ? " (everyone who received notice is told)" : "")}", by);
                    if (m.Notice is not null)
                    {
                        var told = (await governance.NoticeRecipientsAsync(m, ct)).Where(p => SettingsEndpoints.IsEmail(p.Email)).ToList();
                        await SendAsync(told, (p, agency) => Governance.CancelEmail(m, p, scheme.Name, agency, a.Reason!.Trim()), "cancellation", m, row, db, signatures, email, logger, commands, ct);
                    }
                    break;
                }
                case "comment":
                    governance.Log(m, "comment", a.Text!.Trim(), by);
                    break;
            }
            m.Version++;
            Governance.Write(row, m);
            return Results.NoContent();
        }, ct);
    }

    /// <summary>Emails a meeting's notice (or its cancellation) once the change is saved; a failed email never undoes it.</summary>
    private static async Task SendAsync(List<Person> to, Func<Person, string, EmailMessage> build, string what, Meeting m, MeetingRow row, HumoDbContext db, Messaging.EmailSignatures signatures,
        IEmailSender email, ILogger logger, CommandRunner commands, CancellationToken ct)
    {
        var agency = await db.Organisations.Where(o => o.Id == row.OrganisationId).Select(o => o.Name).FirstAsync(ct);
        var messages = to.Select(p => build(p, agency)).ToList();
        commands.AfterCommit(async () =>
        {
            foreach (var message in messages)
            {
                try
                {
                    await email.SendAsync(await signatures.SignAsync(message, row.OrganisationId, null, ct), ct);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    logger.LogError(e, "Couldn't email the {What} of {Meeting}", what, m.Ref);
                }
            }
        });
    }

    private static void StartMinutes(Meeting m, Governance governance, string by)
    {
        if (m.Stage != "held") return;
        m.Stage = "minutes-draft";
        m.Minutes = new MeetingMinutes { DraftedAt = governance.NowText, DraftedBy = by };
        governance.Log(m, "stage", "Minutes started", by);
    }

    private static async Task AddResolutionAsync(Meeting m, MeetingRow row, NewResolutionInput input, Governance governance, HumoDbContext db, string by, CancellationToken ct)
    {
        var scheme = await db.Schemes.FirstAsync(s => s.Id == row.SchemeId, ct);
        var number = await governance.NextNumberAsync(row.SchemeId, ct);
        var id = Guid.CreateVersion7();
        var votes = input.Votes ?? new Votes(0, 0, 0);
        var r = new Resolution
        {
            Id = id.ToString(), Ref = $"RES-{scheme.Code}-{number}", Number = number, SchemeId = m.SchemeId, Mode = "meeting", MeetingId = m.Id, AgendaItemId = input.AgendaItemId,
            Title = input.Title!.Trim(), Text = input.Text!.Trim(), Outcome = input.Outcome!, Votes = votes, ProposedAt = m.Held?.At ?? governance.NowText, ProposedBy = by,
            DecidedAt = m.Held?.At ?? governance.NowText, DecidedBy = m.Title,
        };
        if (r.Outcome == "passed")
            r.Actions = [.. (input.Actions ?? []).Select(x => governance.CreateAction(r, row.OrganisationId, x, $"{r.Ref} · {m.Title}", $"/governance/meetings/{m.Id}"))];
        var rrow = new ResolutionRow { Id = id, OrganisationId = row.OrganisationId, SchemeId = row.SchemeId, Ref = r.Ref, Number = number, MeetingId = row.Id };
        Governance.Write(rrow, r);
        db.Resolutions.Add(rrow);
        governance.Log(m, "resolution", $"{r.Ref} {(r.Outcome == "passed" ? "passed" : "not passed")} ({votes.For}–{votes.Against}–{votes.Abstain}): {r.Title}{(r.Actions.Count > 0 ? $" · {r.Actions.Count} action{(r.Actions.Count > 1 ? "s" : "")} created" : "")}", by);
        // A budget on this AGM agenda item is approved by the resolution passed on it (D28).
        if (r.Outcome == "passed" && r.AgendaItemId is { } itemId)
            foreach (var b in await db.Budgets.Where(x => x.SchemeId == row.SchemeId && x.Status == "proposed" && x.Agm != null).ToListAsync(ct))
            {
                var agm = JsonSerializer.Deserialize<BudgetAgm>(b.Agm!, Json.Options)!;
                if (agm.MeetingId != m.Id || agm.AgendaItemId != itemId) continue;
                b.Status = "approved";
                b.Approved = JsonSerializer.Serialize(new BudgetApproval(r.DecidedAt!, r.Ref, m.Id), Json.Options);
                b.Version++;
                governance.Log(m, "resolution", $"The {b.Year} budget is approved by {r.Ref}", by);
            }
    }

    /// <summary>
    /// Puts a matter on a draft meeting's agenda, reusing the standard item for it when there is one (an AGM's
    /// "Budget and levies for the coming year"). Returns the agenda item's id.
    /// </summary>
    public static string PlaceOnAgenda(Meeting m, Governance governance, Func<string, bool> existing, string title, string notes, string by, IReadOnlyCollection<string> skip)
    {
        var item = m.Agenda.FirstOrDefault(x => existing(x.Title) && !skip.Contains(x.Id));
        if (item is null)
        {
            item = new AgendaItem { Id = Guid.CreateVersion7().ToString(), Title = title, Notes = notes };
            m.Agenda.Add(item);
            governance.Log(m, "stage", $"Agenda item added: {title}", by);
        }
        else
        {
            item.Notes = string.Join(" ", new[] { item.Notes, notes }.Where(x => !string.IsNullOrWhiteSpace(x)));
            governance.Log(m, "stage", $"Agenda item updated: {item.Title} — {title}", by);
        }
        m.Version++;
        return item.Id;
    }

    // ---- Resolutions ----

    private static async Task<IResult> Resolutions(string[]? schemeIds, int? page, int? pageSize, CurrentActor current, HumoDbContext db, Governance governance, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await SchemesAsync(actor, db, schemeIds, ct, "Resolutions.View") is not { } schemes) return Results.Ok(PortfolioReads.Page(new List<ResolutionViewDto>(), page, pageSize));
        var rows = (await db.Resolutions.Where(r => schemes.Contains(r.SchemeId)).ToListAsync(ct)).OrderBy(r => r.SchemeId).ThenByDescending(r => r.Number).ToList();
        return Results.Ok(PortfolioReads.Page(await governance.ResolutionViewsAsync(rows, ct), page, pageSize));
    }

    private static async Task<IResult> Assignees(string[]? schemeIds, CurrentActor current, HumoDbContext db, Governance governance, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await SchemesAsync(actor, db, schemeIds, ct, "Resolutions.View") is not { } ids) return Results.Ok(Array.Empty<AssigneeDto>());
        var all = new List<AssigneeDto>();
        foreach (var s in await db.Schemes.Where(x => ids.Contains(x.Id)).ToListAsync(ct))
            all.AddRange((await governance.AssigneesAsync(s, ct)).Where(x => all.All(y => y.Id != x.Id)));
        return Results.Ok(all);
    }

    /// <summary>A round-robin resolution: the trustees decide it in My work; its actions start when it passes. Returns its reference.</summary>
    private static async Task<IResult> ProposeWritten(WrittenResolutionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Governance governance, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var scheme = Guid.TryParse(body.SchemeId, out var sid) ? await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(s => s.Id == sid, ct) : null;
        var trustees = scheme is null ? 0 : (await governance.TrusteesAsync(scheme.Id, ct)).Count;
        return await commands.RunAsync(new CommandSpec($"Proposed a written resolution{(scheme is null ? "" : $" to {scheme.Name}’s trustees")}: {body.Title?.Trim()}", "Meetings.Manage")
        {
            Resource = "Resolution",
            SchemeId = scheme?.Id,
            Feature = "governance",
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (scheme is null) return new() { ["schemeId"] = "Choose a scheme." };
                if (string.IsNullOrWhiteSpace(body.Title)) e["title"] = "Give the resolution a short title.";
                if ((body.Text ?? "").Trim().Length < 10) e["text"] = "Write the resolution the trustees are asked to pass.";
                if (trustees == 0) e["schemeId"] = "This scheme has no trustees on record.";
                foreach (var (x, i) in (body.Actions ?? []).Select((x, i) => (x, i)))
                {
                    if (string.IsNullOrWhiteSpace(x.Title)) e[$"action{i}"] = "Describe the action.";
                    if (!DateTimeOffset.TryParse(x.DueAt, CultureInfo.InvariantCulture, out _)) e[$"due{i}"] = "Give it a due date.";
                }
                return e;
            },
        }, async actor =>
        {
            var number = await governance.NextNumberAsync(scheme!.Id, ct);
            var id = Guid.CreateVersion7();
            var r = new Resolution
            {
                Id = id.ToString(), Ref = $"RES-{scheme.Code}-{number}", Number = number, SchemeId = scheme.Id.ToString(), Mode = "written", Title = body.Title!.Trim(),
                Text = body.Text!.Trim(), ProposedAt = governance.NowText, ProposedBy = actor.Human.Name, PlannedActions = body.Actions ?? [],
            };
            var item = new WorkItemRow
            {
                Id = Guid.CreateVersion7(), OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, Ref = r.Ref, Kind = "approval", Type = "resolution-approval",
                Title = $"Written resolution: {r.Title}", Detail = $"Round-robin to {trustees} trustee{(trustees == 1 ? "" : "s")} of {scheme.Name}", CreatedAt = governance.Now,
                DueAt = governance.Now.AddDays(5), ApproverRoles = Work.WorkItemEndpoints.Roles(Domain.Access.Roles.Trustee), BoardMajority = true, Evidence = JsonSerializer.Serialize(new[] { r.Text }),
                Route = "/governance/resolutions", SourceId = id,
            };
            r.ApprovalWorkItemId = item.Id.ToString();
            var row = new ResolutionRow { Id = id, OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, Ref = r.Ref, Number = number };
            Governance.Write(row, r);
            db.Resolutions.Add(row);
            db.WorkItems.Add(item);
            return Results.Created($"/api/resolutions/{id}", new { id = r.Ref });
        }, ct);
    }
}
