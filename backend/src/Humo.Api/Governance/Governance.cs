using System.Globalization;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Finance;
using Humo.Api.Portfolio;
using Humo.Api.Work;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Domain.Documents;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Governance;

// The shapes match the app's governance model (domain/models/meeting.ts).
public sealed class AgendaItem
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Notes { get; set; }
    public string? Minute { get; set; }
}

public sealed class Attendee
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>chair, trustee, agent or owner.</summary>
    public string Role { get; set; } = "trustee";
    public string Capacity { get; set; } = "";
    public bool? Present { get; set; }
    public bool Votes { get; set; }
}

public sealed record MeetingEvent(string Id, string At, string Kind, string Text, string By);
public sealed record DocumentRef(string TemplateId, int Version);
public sealed record MeetingNotice(string SentAt, string SentBy, int Recipients, DocumentRef? Document);
public sealed record MeetingHeld(string At, bool Quorate, int Present, int Voters, int Required);
public sealed record MeetingCancelled(string At, string By, string Reason);

public sealed class MeetingMinutes
{
    public string DraftedAt { get; set; } = "";
    public string DraftedBy { get; set; } = "";
    public string? ApprovalWorkItemId { get; set; }
    public string? ApprovedAt { get; set; }
    public string? ApprovedBy { get; set; }
    public DocumentRef? Document { get; set; }
}

public sealed class Meeting
{
    public string Id { get; set; } = "";
    public int Version { get; set; } = 1;
    public string Ref { get; set; } = "";
    public string SchemeId { get; set; } = "";
    /// <summary>trustee, agm or sgm.</summary>
    public string Type { get; set; } = "trustee";
    public string Title { get; set; } = "";
    public string ScheduledFor { get; set; } = "";
    public string Venue { get; set; } = "";
    public string Stage { get; set; } = "draft";
    public List<AgendaItem> Agenda { get; set; } = [];
    public List<Attendee> Attendees { get; set; } = [];
    public List<string> Pack { get; set; } = [];
    public MeetingNotice? Notice { get; set; }
    public MeetingHeld? Held { get; set; }
    public MeetingMinutes? Minutes { get; set; }
    public MeetingCancelled? Cancelled { get; set; }
    public List<MeetingEvent> Events { get; set; } = [];
}

public sealed record Votes(int For, int Against, int Abstain);
public sealed record ResolutionAction(string Id, string WorkItemId, string Title, string? AssigneeId, string DueAt);
public sealed record NewAction(string? Title, string? AssigneeId, string? DueAt);

public sealed class Resolution
{
    public string Id { get; set; } = "";
    public int Version { get; set; } = 1;
    public string Ref { get; set; } = "";
    public int Number { get; set; }
    public string SchemeId { get; set; } = "";
    /// <summary>meeting or written.</summary>
    public string Mode { get; set; } = "meeting";
    public string? MeetingId { get; set; }
    public string? AgendaItemId { get; set; }
    public string Title { get; set; } = "";
    public string Text { get; set; } = "";
    public string Outcome { get; set; } = "proposed";
    public Votes? Votes { get; set; }
    public string ProposedAt { get; set; } = "";
    public string ProposedBy { get; set; } = "";
    public string? DecidedAt { get; set; }
    public string? DecidedBy { get; set; }
    public string? ApprovalWorkItemId { get; set; }
    public List<ResolutionAction> Actions { get; set; } = [];
    public List<NewAction>? PlannedActions { get; set; }
}

public sealed record AssigneeDto(string Id, string Name, string Kind);
public sealed record ActionViewDto(ResolutionAction Action, string AssigneeName, string Status, string? CompletedAt, bool Overdue);
public sealed record MeetingRefDto(string Id, string Ref, string Title, string ScheduledFor, string Type);
public sealed record ResolutionViewDto(Resolution Resolution, SchemeDto Scheme, MeetingRefDto? Meeting, List<ActionViewDto> Actions, string Progress);
public sealed record MeetingSummaryDto(Meeting Meeting, SchemeDto Scheme, int Resolutions, int OpenActions);
public sealed record MeetingDetailDto(Meeting Meeting, SchemeDto Scheme, int Resolutions, int OpenActions, List<ResolutionViewDto> ResolutionViews, List<AssigneeDto> Assignees, string AgencyName);

/// <summary>
/// Governance on the API: Meeting → Resolution → Action → Completion. A meeting runs one lifecycle (draft agenda →
/// notice sent → pack ready → held → minutes draft → minutes approved); resolutions are recorded at the meeting, or
/// passed in writing by the trustees in My work; every action a resolution creates is a task in My work, and its
/// status is the action's. The resolutions register is a view over resolutions.
/// </summary>
public sealed class Governance(HumoDbContext db, PortfolioReads reads, Commercial.CommercialRecords commercial, TimeProvider clock)
{
    public static readonly Dictionary<string, string> TypeLabels = new() { ["trustee"] = "Trustee meeting", ["agm"] = "Annual general meeting", ["sgm"] = "Special general meeting" };
    public static readonly Dictionary<string, string> StageLabels = new()
    {
        ["draft"] = "Draft agenda", ["notice-sent"] = "Notice sent", ["pack-ready"] = "Pack ready", ["held"] = "Held", ["minutes-draft"] = "Minutes in draft",
        ["minutes-approved"] = "Minutes approved", ["cancelled"] = "Cancelled",
    };
    /// <summary>Days of written notice (prototype values; the scheme's rules decide in practice).</summary>
    public static readonly Dictionary<string, int> NoticeDays = new() { ["trustee"] = 7, ["agm"] = 14, ["sgm"] = 14 };
    private static readonly string[] HeldStages = ["held", "minutes-draft", "minutes-approved"];

    public DateTimeOffset Now => clock.GetUtcNow();
    public string NowText => Now.ToOffset(TimeSpan.FromHours(2)).ToString("O");

    public static Meeting Read(MeetingRow r) => JsonSerializer.Deserialize<Meeting>(r.Json, Json.Options)!;
    public static Resolution Read(ResolutionRow r) => JsonSerializer.Deserialize<Resolution>(r.Json, Json.Options)!;

    public static void Write(MeetingRow row, Meeting m)
    {
        row.Version = m.Version;
        row.Stage = m.Stage;
        row.ScheduledFor = DateTimeOffset.Parse(m.ScheduledFor, CultureInfo.InvariantCulture);
        row.Json = JsonSerializer.Serialize(m, Json.Options);
    }

    public static void Write(ResolutionRow row, Resolution r)
    {
        row.Version = r.Version;
        row.Outcome = r.Outcome;
        row.Json = JsonSerializer.Serialize(r, Json.Options);
    }

    public static bool Held(string stage) => HeldStages.Contains(stage);

    public void Log(Meeting m, string kind, string text, string by) => m.Events.Insert(0, new MeetingEvent(Guid.CreateVersion7().ToString(), NowText, kind, text, by));

    /// <summary>Quorum: a majority of the trustees at trustee meetings, a third of the units at general meetings (prototype rule; the scheme's rules decide).</summary>
    public static int QuorumRequired(string type, int voters) => type == "trustee" ? voters / 2 + 1 : (int)Math.Ceiling(voters / 3.0);

    public async Task<(int Present, int Voters, int Required)> QuorumAsync(Meeting m, List<string> presentIds, int ownersPresent, CancellationToken ct)
    {
        var voters = m.Type == "trustee" ? m.Attendees.Count(a => a.Votes) : await db.Units.CountAsync(u => u.SchemeId == Guid.Parse(m.SchemeId), ct);
        var present = m.Type == "trustee" ? m.Attendees.Count(a => a.Votes && presentIds.Contains(a.Id)) : ownersPresent;
        return (present, voters, QuorumRequired(m.Type, voters));
    }

    /// <summary>The scheme's trustees on the board register (D2), current today.</summary>
    public async Task<List<(Relationship Rel, Person Person)>> TrusteesAsync(Guid schemeId, CancellationToken ct)
    {
        var rels = (await db.Relationships.Where(r => r.SchemeId == schemeId && r.Type == "trustee").ToListAsync(ct)).Where(reads.IsCurrent).ToList();
        var ids = rels.Select(r => r.PersonId).ToList();
        var people = await db.People.Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        return [.. rels.Where(r => people.ContainsKey(r.PersonId)).Select(r => (r, people[r.PersonId]))];
    }

    /// <summary>Who actions can be given to: the agency's staff on the scheme, and its trustees with a Humo sign-in.</summary>
    public async Task<List<AssigneeDto>> AssigneesAsync(Scheme scheme, CancellationToken ct)
    {
        var staffAssignments = (await db.RoleAssignments.AsNoTracking()
            .Where(a => a.OrganisationId == scheme.OrganisationId && a.Status == AssignmentStatuses.Active && StaffCovers.StaffRoles.Contains(a.Role)).ToListAsync(ct))
            .Where(a => a.ScopeType == ScopeTypes.Organisation || a.SchemeIds.Contains(scheme.Id.ToString())).Select(a => a.UserId).Distinct().ToList();
        var staff = await db.Users.AsNoTracking().Where(u => staffAssignments.Contains(u.Id) && u.Status == IdentityStatuses.Active).OrderBy(u => u.Name).ToListAsync(ct);
        var trusteePeople = (await TrusteesAsync(scheme.Id, ct)).Select(t => t.Person.Id).ToList();
        var trusteeUsers = (await Access.PersonSignIns.ForAsync(db, trusteePeople, ct)).Values.SelectMany(x => x).ToList();
        var trustees = await db.Users.AsNoTracking().Where(u => trusteeUsers.Contains(u.Id) && u.Status == IdentityStatuses.Active).OrderBy(u => u.Name).ToListAsync(ct);
        return [.. staff.Select(u => new AssigneeDto(u.Id.ToString(), u.Name, "staff")), .. trustees.Where(u => staff.All(s => s.Id != u.Id)).Select(u => new AssigneeDto(u.Id.ToString(), u.Name, "trustee"))];
    }

    public async Task<List<Attendee>> AttendeesAsync(Scheme scheme, string type, CancellationToken ct)
    {
        var trustees = (await TrusteesAsync(scheme.Id, ct)).Select(t => new Attendee
        {
            Id = t.Person.Id.ToString(), Name = t.Person.DisplayName, Role = t.Rel.Portfolio == "Chairperson" ? "chair" : "trustee", Capacity = t.Rel.Portfolio ?? "Trustee", Votes = type == "trustee",
        }).ToList();
        var agent = (await AssigneesAsync(scheme, ct)).FirstOrDefault(a => a.Kind == "staff");
        if (agent is not null) trustees.Add(new Attendee { Id = agent.Id, Name = agent.Name, Role = "agent", Capacity = "Managing agent", Votes = false });
        return trustees;
    }

    public static List<AgendaItem> StandardAgenda(string type) =>
    [.. (type == "agm"
            ? new[] { "Quorum and proxies", "Minutes of the previous AGM", "Trustees’ report", "Audited financial statements", "Budget and levies for the coming year", "Election of trustees", "Appointment of the auditor", "Insurance replacement value" }
            : type == "sgm" ? ["Quorum and proxies", "Special resolution"]
            : ["Apologies and quorum", "Minutes of the previous meeting", "Financial report and arrears"])
        .Select(t => new AgendaItem { Id = Guid.CreateVersion7().ToString(), Title = t })];

    /// <summary>The agency's template for a meeting document (as statements choose theirs), recorded on the meeting when it's issued.</summary>
    public async Task<DocumentRef?> TemplateAsync(Guid organisationId, string type, CancellationToken ct)
    {
        var settings = await Documents.DocumentEndpoints.ReadAsync(db, organisationId, ct);
        var entitled = await Documents.DocumentEndpoints.EntitledAsync(commercial, organisationId, ct);
        var template = DocumentCatalogue.DefaultFor(await Documents.TemplateRegistry.ForOrganisationAsync(db, organisationId, ct), type, settings.Defaults.GetValueOrDefault(type), entitled);
        return template?.At() is { } v ? new DocumentRef(template.Id, v.Version) : null;
    }

    public async Task<int> NextNumberAsync(Guid schemeId, CancellationToken ct) =>
        Math.Max((await db.Resolutions.Where(r => r.SchemeId == schemeId).Select(r => (int?)r.Number).MaxAsync(ct)) ?? 0,
            db.Resolutions.Local.Where(r => r.SchemeId == schemeId).Select(r => r.Number).DefaultIfEmpty(0).Max()) + 1;

    /// <summary>An action is a task in My work: assigned, due, and completed there.</summary>
    public ResolutionAction CreateAction(Resolution r, Guid organisationId, NewAction a, string detail, string route)
    {
        var item = new WorkItemRow
        {
            Id = Guid.CreateVersion7(), OrganisationId = organisationId, SchemeId = Guid.Parse(r.SchemeId), Ref = r.Ref, Kind = "task", Type = "meeting-action", Title = (a.Title ?? "").Trim(),
            Detail = detail, CreatedAt = Now, DueAt = DateTimeOffset.Parse(a.DueAt!, CultureInfo.InvariantCulture), AssigneeId = a.AssigneeId, ApproverRoles = "[]", Evidence = "[]",
            Route = route, SourceId = Guid.Parse(r.Id),
        };
        db.WorkItems.Add(item);
        return new ResolutionAction(Guid.CreateVersion7().ToString(), item.Id.ToString(), item.Title, a.AssigneeId, a.DueAt!);
    }

    // ---- Reads ----

    public static string Progress(Resolution r, IReadOnlyDictionary<Guid, WorkItemRow> work)
    {
        if (r.Outcome == "proposed") return "awaiting-decision";
        if (r.Outcome is "not-passed" or "withdrawn") return r.Outcome;
        if (r.Actions.Count == 0) return "no-actions";
        var done = r.Actions.Count(a => work.TryGetValue(Guid.Parse(a.WorkItemId), out var w) && w.Status == "done");
        return done == r.Actions.Count ? "completed" : "in-progress";
    }

    public async Task<List<ResolutionViewDto>> ResolutionViewsAsync(List<ResolutionRow> rows, CancellationToken ct)
    {
        var resolutions = rows.Select(Read).ToList();
        var workIds = resolutions.SelectMany(r => r.Actions).Select(a => Guid.Parse(a.WorkItemId)).ToList();
        var work = await db.WorkItems.AsNoTracking().Where(w => workIds.Contains(w.Id)).ToDictionaryAsync(w => w.Id, ct);
        var assigneeIds = resolutions.SelectMany(r => r.Actions).Select(a => Guid.TryParse(a.AssigneeId, out var g) ? g : Guid.Empty).Distinct().ToList();
        var names = await db.Users.AsNoTracking().Where(u => assigneeIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id.ToString(), u => u.Name, ct);
        var meetingIds = rows.Where(r => r.MeetingId != null).Select(r => r.MeetingId!.Value).Distinct().ToList();
        var meetings = (await db.Meetings.AsNoTracking().Where(m => meetingIds.Contains(m.Id)).ToListAsync(ct)).Select(Read).ToDictionary(m => m.Id);
        var schemeIds = rows.Select(r => r.SchemeId).Distinct().ToList();
        var schemes = (await SchemeEndpoints.ToDtos(await db.Schemes.Where(s => schemeIds.Contains(s.Id)).ToListAsync(ct), db, ct)).ToDictionary(s => s.Id);
        return [.. resolutions.Select(r =>
        {
            var m = r.MeetingId is { } mid && meetings.TryGetValue(mid, out var x) ? new MeetingRefDto(x.Id, x.Ref, x.Title, x.ScheduledFor, x.Type) : null;
            var actions = r.Actions.Select(a =>
            {
                var done = work.TryGetValue(Guid.Parse(a.WorkItemId), out var w) && w.Status == "done";
                return new ActionViewDto(a, a.AssigneeId is { } id ? names.GetValueOrDefault(id, "—") : "Unassigned", done ? "done" : "open", done ? w!.DecidedAt?.ToString("O") : null,
                    !done && DateTimeOffset.Parse(a.DueAt, CultureInfo.InvariantCulture) < Now);
            }).ToList();
            return new ResolutionViewDto(r, schemes[r.SchemeId], m, actions, Progress(r, work));
        })];
    }

    public async Task<List<MeetingSummaryDto>> SummariesAsync(List<MeetingRow> rows, CancellationToken ct)
    {
        var ids = rows.Select(r => (Guid?)r.Id).ToList();
        var resolutions = (await db.Resolutions.AsNoTracking().Where(r => ids.Contains(r.MeetingId)).ToListAsync(ct)).Select(r => (r.MeetingId, Res: Read(r))).ToList();
        var workIds = resolutions.SelectMany(r => r.Res.Actions).Select(a => Guid.Parse(a.WorkItemId)).ToList();
        var open = (await db.WorkItems.AsNoTracking().Where(w => workIds.Contains(w.Id) && w.Status == "open").Select(w => w.Id).ToListAsync(ct)).Select(g => g.ToString()).ToHashSet();
        var schemeIds = rows.Select(r => r.SchemeId).Distinct().ToList();
        var schemes = (await SchemeEndpoints.ToDtos(await db.Schemes.Where(s => schemeIds.Contains(s.Id)).ToListAsync(ct), db, ct)).ToDictionary(s => s.Id);
        return [.. rows.Select(row =>
        {
            var mine = resolutions.Where(r => r.MeetingId == row.Id).Select(r => r.Res).ToList();
            return new MeetingSummaryDto(Read(row), schemes[row.SchemeId.ToString()], mine.Count(r => r.Outcome != "withdrawn"), mine.SelectMany(r => r.Actions).Count(a => open.Contains(a.WorkItemId)));
        })];
    }

    // ---- Notices by email ----

    /// <summary>Who a notice goes to: the trustees for a trustee meeting, every current owner of the scheme for a general meeting.</summary>
    public async Task<List<Person>> NoticeRecipientsAsync(Meeting m, CancellationToken ct)
    {
        var schemeId = Guid.Parse(m.SchemeId);
        if (m.Type == "trustee") return [.. (await TrusteesAsync(schemeId, ct)).Select(t => t.Person)];
        var owners = (await db.Relationships.Where(r => r.SchemeId == schemeId && r.Type == "owner").ToListAsync(ct)).Where(reads.IsCurrent).Select(r => r.PersonId).Distinct().ToList();
        return await db.People.Where(p => owners.Contains(p.Id)).ToListAsync(ct);
    }

    public static string When(string iso) => DateTimeOffset.Parse(iso, CultureInfo.InvariantCulture).ToOffset(TimeSpan.FromHours(2)).ToString("dddd d MMMM yyyy 'at' HH:mm", CultureInfo.InvariantCulture);

    public static EmailMessage NoticeEmail(Meeting m, Person to, string schemeName, string agencyName) => new(to.Email!,
        $"Notice: {m.Title} — {schemeName}",
        $"""
        Dear {to.DisplayName},

        You're invited to the {TypeLabels[m.Type].ToLowerInvariant()} of {schemeName}:

          {When(m.ScheduledFor)}
          {m.Venue}

        Agenda:
        {string.Join("\n", m.Agenda.Select((a, i) => $"  {i + 1}. {a.Title}"))}

        {(m.Type == "trustee" ? "Please let us know if you can't attend." : "If you can't attend, you may appoint a proxy in writing before the meeting.")}

        Kind regards,
        {agencyName}
        """);

    public static EmailMessage CancelEmail(Meeting m, Person to, string schemeName, string agencyName, string reason) => new(to.Email!,
        $"Cancelled: {m.Title} — {schemeName}",
        $"""
        Dear {to.DisplayName},

        The {TypeLabels[m.Type].ToLowerInvariant()} of {schemeName} on {When(m.ScheduledFor)} is cancelled: {reason}

        Kind regards,
        {agencyName}
        """);
}

/// <summary>Minutes decided in My work: approved, the meeting's minutes are final; sent back, they're draft again.</summary>
public sealed class MinutesApprovalHandler(HumoDbContext db, Governance governance) : IApprovalHandler
{
    public string Type => "minutes-approval";

    public Task<string?> RefuseAsync(WorkItemRow item, Actor actor, bool approve, CancellationToken ct) => Task.FromResult<string?>(null);

    public async Task DecidedAsync(WorkItemRow item, Actor actor, bool approve, string? comment, CancellationToken ct)
    {
        if (item.SourceId is not { } id || await db.Meetings.FirstOrDefaultAsync(m => m.Id == id, ct) is not { } row) return;
        var m = Governance.Read(row);
        if (m.Minutes?.ApprovalWorkItemId != item.Id.ToString()) return;
        var by = actor.Human.Name;
        if (approve)
        {
            m.Minutes.ApprovedAt = governance.NowText;
            m.Minutes.ApprovedBy = by;
            m.Minutes.Document = await governance.TemplateAsync(row.OrganisationId, "meeting-minutes", ct);
            m.Stage = "minutes-approved";
            governance.Log(m, "stage", $"Minutes approved by {by}", by);
        }
        else
        {
            m.Minutes.ApprovalWorkItemId = null;
            governance.Log(m, "stage", $"Minutes sent back by {by}{(comment is null ? "" : $": “{comment}”")}", by);
        }
        m.Version++;
        Governance.Write(row, m);
    }
}

/// <summary>A written (round-robin) resolution decided by the trustees in My work: passed, its actions start.</summary>
public sealed class ResolutionApprovalHandler(HumoDbContext db, Governance governance) : IApprovalHandler
{
    public string Type => "resolution-approval";

    public Task<string?> RefuseAsync(WorkItemRow item, Actor actor, bool approve, CancellationToken ct) => Task.FromResult<string?>(null);

    public async Task DecidedAsync(WorkItemRow item, Actor actor, bool approve, string? comment, CancellationToken ct)
    {
        if (item.SourceId is not { } id || await db.Resolutions.FirstOrDefaultAsync(r => r.Id == id, ct) is not { } row) return;
        var r = Governance.Read(row);
        if (r.Outcome != "proposed") return;
        r.DecidedAt = governance.NowText;
        r.DecidedBy = actor.Human.Name;
        r.Outcome = approve ? "passed" : "not-passed";
        if (approve) r.Actions = [.. (r.PlannedActions ?? []).Select(a => governance.CreateAction(r, row.OrganisationId, a, $"{r.Ref} · Written resolution", "/governance/resolutions"))];
        r.PlannedActions = null;
        r.Version++;
        Governance.Write(row, r);
    }
}
