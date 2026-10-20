using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Humo.Api.Commands;
using Humo.Api.Finance;
using Humo.Api.Portfolio;
using Humo.Api.Settings;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Messaging;

// The shapes match messaging.ts and notice.ts in the app.
public sealed record AudienceDto(string SchemeId, string Kind, int? MinDays, List<string>? UnitIds, bool? IncludeTenants);
public sealed record PreviewRequest(AudienceDto? Audience, List<string>? Channels);
public sealed record PreviewRecipientDto(string PersonId, string Name, string? UnitLabel, string Channel, string Address, Dictionary<string, string> Values);
public sealed record ComposePreviewDto(string AudienceLabel, List<PreviewRecipientDto> Recipients, List<SkippedDto> Skipped, Dictionary<string, int> ByChannel);
public sealed record ComposeRequest(AudienceDto? Audience, string? TemplateId, string? Subject, string? Body, List<string>? Channels, string? SendAt);
public sealed record MessageTemplateDto(string Id, int Version, string Name, string Category, string Subject, string Body, List<string> Channels, bool BuiltIn, string UpdatedAt,
    string UpdatedBy, bool? Archived);
public sealed record TemplateRequest(string? Name, string? Category, string? Subject, string? Body, List<string>? Channels, int? ExpectedVersion);
public sealed record NoticeDto(string Id, int Version, string Ref, string SchemeId, string Title, string Body, string Audience, string Category, string PublishedAt, string PublishedBy,
    bool Pinned, string? ExpiresAt, List<string> SentBy, int Recipients, object? Withdrawn);
public sealed record NoticeViewDto(NoticeDto Notice, SchemeDto Scheme, bool Current);
public sealed record NewNoticeRequest(string? SchemeId, string? Title, string? Body, string? Audience, string? Category, bool Pinned, string? ExpiresAt);
public sealed record NoticeActionRequest(NoticeAction? Action, int? ExpectedVersion);
public sealed record NoticeAction(string Type, string? Reason);

/// <summary>Someone an audience covers: the person, and the unit they're reached about (owners and tenants).</summary>
public sealed record Addressee(Person Person, Unit? Unit, LevyAccount? Account);

/// <summary>
/// Communications on the API (docs/18 R-5): who an audience reaches and by which channel, Compose (now or
/// scheduled), message templates, and notices. Everything sent is one record in Sent, delivered in the
/// background with each person's merge values, and its result is recorded as the mail server or SMS network reports it.
/// </summary>
public sealed partial class Communications(HumoDbContext db, SentRecords sent, IEmailSender email, SmsGateway sms, TimeProvider clock, ILogger<Communications> logger)
{
    public const string Feature = "communications";
    public const string Permission = "Messages.Reply";

    public static readonly string[] Channels = ["email", "sms", "whatsapp", "portal", "push"];
    public static readonly string[] Categories = ["levies", "collections", "maintenance", "meetings", "general"];
    public static readonly string[] MergeFields = ["person.name", "person.firstName", "unit.number", "scheme.name", "account.number", "account.balance", "account.overdue", "agency.name", "agency.phone"];
    private static readonly Dictionary<string, string> ChannelNames = new() { ["email"] = "email", ["sms"] = "SMS", ["whatsapp"] = "WhatsApp", ["portal"] = "the portal", ["push"] = "Humo Mobile" };
    private static readonly Dictionary<string, string> AudienceNames = new()
    {
        ["owners"] = "All owners", ["residents"] = "Owners and tenants", ["tenants"] = "Tenants only", ["trustees"] = "Trustees", ["arrears"] = "Owners in arrears", ["units"] = "Chosen units",
    };

    private DateTimeOffset Now => clock.GetUtcNow();
    private DateOnly Today => DateOnly.FromDateTime(Now.ToOffset(TimeSpan.FromHours(2)).DateTime);

    // ---------------------------------------------------------------- Audiences

    /// <summary>The people an audience covers, each once per unit.</summary>
    public async Task<List<Addressee>> PeopleAsync(AudienceDto a, CancellationToken ct)
    {
        var schemeId = Guid.Parse(a.SchemeId);
        var today = Today;
        var rels = (await db.Relationships.Where(r => r.SchemeId == schemeId).ToListAsync(ct)).Where(r => r.Until is null || r.Until >= today).ToList();
        var people = await db.People.Where(p => rels.Select(r => r.PersonId).Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        var units = await db.Units.Where(u => u.SchemeId == schemeId).ToDictionaryAsync(u => u.Id, ct);
        var accounts = await db.LevyAccounts.Where(x => x.SchemeId == schemeId).ToDictionaryAsync(x => x.UnitId, ct);
        var wantedUnits = (a.UnitIds ?? []).Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).ToHashSet();
        bool InArrears(Guid unitId) => accounts.TryGetValue(unitId, out var acc) && CreditControlRules.Overdue(CreditControl.Ageing(acc)) > 0
            && CreditControlRules.DaysInArrears(CreditControl.Ageing(acc)) >= (a.MinDays ?? 30);
        bool Wanted(Relationship r) => a.Kind switch
        {
            "owners" => r.Type == "owner",
            "residents" => r.Type is "owner" or "tenant",
            "tenants" => r.Type == "tenant",
            "trustees" => r.Type == "trustee",
            "arrears" => r.Type == "owner" && r.UnitId is { } u && InArrears(u),
            "units" => r.UnitId is { } u && wantedUnits.Contains(u) && (r.Type == "owner" || (a.IncludeTenants == true && r.Type == "tenant")),
            _ => false,
        };
        var out_ = new List<Addressee>();
        foreach (var r in rels.Where(Wanted).OrderBy(r => r.UnitId is { } u && units.TryGetValue(u, out var unit) ? unit.Number : ""))
        {
            if (!people.TryGetValue(r.PersonId, out var p)) continue;
            var unit = r.Type == "trustee" || r.UnitId is null ? null : units.GetValueOrDefault(r.UnitId.Value);
            if (out_.Any(x => x.Person.Id == p.Id && x.Unit?.Id == unit?.Id)) continue;
            out_.Add(new Addressee(p, unit, unit is null ? null : accounts.GetValueOrDefault(unit.Id)));
        }
        return out_;
    }

    public async Task<string> AudienceLabelAsync(AudienceDto a, CancellationToken ct)
    {
        var scheme = await db.Schemes.Where(s => s.Id == Guid.Parse(a.SchemeId)).Select(s => s.Name).FirstOrDefaultAsync(ct) ?? a.SchemeId;
        var what = a.Kind == "arrears" ? $"Owners {a.MinDays ?? 30}+ days in arrears"
            : a.Kind == "units" ? $"{a.UnitIds?.Count ?? 0} chosen unit{(a.UnitIds?.Count == 1 ? "" : "s")}" : AudienceNames.GetValueOrDefault(a.Kind, a.Kind);
        return $"{what} · {scheme}";
    }

    /// <summary>Their preference if it's one of the channels and they can receive it; else the first chosen channel they can. Or why not.</summary>
    public static (string? Channel, string? Why) ChannelFor(Person p, IReadOnlyList<string> channels, ISet<Guid> portalPeople)
    {
        bool Can(string c) => c switch
        {
            "email" => SettingsEndpoints.IsEmail(p.Email),
            "sms" => MobileNumber.TryNormalise(p.Phone, out _),
            "portal" => portalPeople.Contains(p.Id),
            _ => false, // WhatsApp and Humo Mobile aren't on the API yet.
        };
        if (channels.Contains(p.PreferredChannel) && Can(p.PreferredChannel)) return (p.PreferredChannel, null);
        if (channels.FirstOrDefault(Can) is { } c) return (c, null);
        if (channels.All(x => x is "whatsapp" or "push")) return (null, $"{string.Join(" and ", channels.Select(x => ChannelNames[x]))} isn’t available on Humo Property Management yet");
        return (null, $"Can’t be reached by {string.Join(" or ", channels.Select(x => ChannelNames.GetValueOrDefault(x, x)))}");
    }

    private static string Address(Person p, string channel) => channel switch { "email" => p.Email.Trim(), "portal" => "Resident portal", _ => p.Phone };

    public async Task<(Dictionary<string, string> Base, ISet<Guid> Portal)> ContextAsync(Guid schemeId, CancellationToken ct)
    {
        var scheme = await db.Schemes.FirstAsync(s => s.Id == schemeId, ct);
        var org = await db.Organisations.FirstAsync(o => o.Id == scheme.OrganisationId, ct);
        var portal = (await db.Users.Where(u => u.PersonId != null && u.Status == IdentityStatuses.Active).Select(u => u.PersonId!).ToListAsync(ct))
            .Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).ToHashSet();
        return (new Dictionary<string, string> { ["scheme.name"] = scheme.Name, ["agency.name"] = org.ShortName, ["agency.phone"] = await SentRecords.AgencyPhoneAsync(db, org.Id, ct) }, portal);
    }

    private static Dictionary<string, string> Values(Addressee x, Dictionary<string, string> b)
    {
        var v = new Dictionary<string, string>(b)
        {
            ["person.name"] = x.Person.DisplayName,
            ["person.firstName"] = x.Person.Kind == "individual" ? x.Person.FirstName : x.Person.DisplayName,
        };
        if (x.Unit is { } u) v["unit.number"] = u.Number;
        if (x.Account is { } a)
        {
            v["account.number"] = a.AccountNo;
            v["account.balance"] = BillingRules.Rand(Math.Max(0, a.Balance));
            v["account.overdue"] = BillingRules.Rand(CreditControlRules.Overdue(CreditControl.Ageing(a)));
        }
        return v;
    }

    public async Task<ComposePreviewDto> PreviewAsync(AudienceDto a, IReadOnlyList<string> channels, CancellationToken ct)
    {
        var (b, portal) = await ContextAsync(Guid.Parse(a.SchemeId), ct);
        var recipients = new List<PreviewRecipientDto>();
        var skipped = new List<SkippedDto>();
        foreach (var x in await PeopleAsync(a, ct))
        {
            var label = x.Unit is { } u ? $"Unit {u.Number}" : null;
            var (c, why) = ChannelFor(x.Person, channels, portal);
            if (c is not null) recipients.Add(new PreviewRecipientDto(x.Person.Id.ToString(), x.Person.DisplayName, label, c, Address(x.Person, c), Values(x, b)));
            else skipped.Add(new SkippedDto(x.Person.Id.ToString(), x.Person.DisplayName, label, why!));
        }
        return new ComposePreviewDto(await AudienceLabelAsync(a, ct), recipients, skipped, recipients.GroupBy(r => r.Channel).ToDictionary(g => g.Key, g => g.Count()));
    }

    public static string Render(string text, IReadOnlyDictionary<string, string> values) =>
        MergeField().Replace(text, m => values.TryGetValue(m.Groups[1].Value, out var v) ? v : m.Value);

    [GeneratedRegex(@"\{([a-z]+\.[a-zA-Z]+)\}")]
    private static partial Regex MergeField();

    public static IEnumerable<string> UnknownFields(string text) => MergeField().Matches(text).Select(m => m.Groups[1].Value).Where(f => !MergeFields.Contains(f)).Distinct();

    // ---------------------------------------------------------------- Sending

    /// <summary>
    /// Records the send in Sent with a delivery per reachable person: scheduled until its time, otherwise queued. Portal
    /// deliveries are delivered at once (the portal shows them). Returns the record and the deliveries to send now.
    /// </summary>
    public async Task<(SentMessageRow Message, List<Guid> SendNow)> SendAsync(string kind, AudienceDto audience, string subject, string body, IReadOnlyList<string> channels,
        DateTimeOffset? sendAt, Guid? templateId, string by, SentSourceDto? source, CancellationToken ct)
    {
        var preview = await PreviewAsync(audience, channels, ct);
        var schemeId = Guid.Parse(audience.SchemeId);
        var orgId = await db.Schemes.Where(s => s.Id == schemeId).Select(s => s.OrganisationId).FirstAsync(ct);
        var scheduled = sendAt is { } at && at > Now.AddSeconds(30);
        var to = preview.Recipients.Select(r => new Recipient(Guid.Parse(r.PersonId), r.Name, r.UnitLabel, r.Channel, r.Address, r.Values, null,
            scheduled ? "scheduled" : r.Channel == "portal" ? "delivered" : "queued")).ToList();
        var message = await sent.RecordAsync(kind, orgId, schemeId, subject, body, preview.AudienceLabel, by, source, to, preview.Skipped, ct);
        message.Channels = JsonSerializer.Serialize(channels, Json.Options);
        message.TemplateId = templateId;
        if (scheduled) message.SendAt = sendAt!.Value;
        var queued = db.Deliveries.Local.Where(d => d.SentMessageId == message.Id && d.Status == "queued").Select(d => d.Id).ToList();
        return (message, queued);
    }

    /// <summary>One message to one person by one channel (an Inbox reply), recorded in Sent. Returns the record and the delivery to send.</summary>
    public async Task<(SentMessageRow Message, List<Guid> SendNow)> SendToAsync(string kind, Guid schemeId, Addressee to, string channel, string subject, string body, string audienceLabel,
        string by, SentSourceDto? source, CancellationToken ct)
    {
        var (b, _) = await ContextAsync(schemeId, ct);
        var orgId = await db.Schemes.Where(s => s.Id == schemeId).Select(s => s.OrganisationId).FirstAsync(ct);
        var r = new Recipient(to.Person.Id, to.Person.DisplayName, to.Unit is { } u ? $"Unit {u.Number}" : null, channel, Address(to.Person, channel), Values(to, b), null,
            channel == "portal" ? "delivered" : "queued");
        var message = await sent.RecordAsync(kind, orgId, schemeId, subject, body, audienceLabel, by, source, [r], null, ct);
        return (message, db.Deliveries.Local.Where(d => d.SentMessageId == message.Id && d.Status == "queued").Select(d => d.Id).ToList());
    }

    /// <summary>Sends each delivery by its channel with its own merge values, and records what the mail server or SMS provider said.</summary>
    public async Task DeliverAsync(IReadOnlyCollection<Guid> deliveryIds, CancellationToken ct)
    {
        foreach (var id in deliveryIds)
        {
            try
            {
                var d = await db.Deliveries.FirstAsync(x => x.Id == id, ct);
                if (d.Status is not ("queued" or "scheduled")) continue;
                var m = await db.SentMessages.FirstAsync(x => x.Id == d.SentMessageId, ct);
                if (m.CancelledAt is not null) continue;
                var values = JsonSerializer.Deserialize<Dictionary<string, string>>(d.Values, Json.Options) ?? [];
                var text = Render(m.Body, values);
                switch (d.Channel)
                {
                    case "email":
                        try
                        {
                            await email.SendAsync(new EmailMessage(d.Address, Render(m.Subject, values), text), ct);
                            // Accepted by Humo's mail server. Bounces come back later by email and aren't matched up yet.
                            sent.Mark(d, "delivered", null);
                        }
                        catch (Exception e) when (e is not OperationCanceledException)
                        {
                            logger.LogError(e, "The mail server didn’t accept delivery {Id}", id);
                            sent.Mark(d, "failed", "The mail server didn’t accept it. Retry from Sent.");
                        }
                        break;
                    case "sms":
                        var receipt = await sms.SendAsync(new SmsMessage(d.Address, text, d.Id.ToString("N")), ct);
                        sent.Mark(d, receipt.Accepted ? "queued" : "failed", receipt.Accepted ? null : receipt.Error ?? "The SMS provider refused it.", receipt.ProviderMessageId ?? "");
                        break;
                    default:
                        sent.Mark(d, "delivered", null);
                        break;
                }
                await db.SaveChangesAsync(ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError(e, "Couldn’t deliver {Id}", id);
            }
        }
    }

    /// <summary>Scheduled sends whose time has come go out (every minute, from the delivery host). Returns how many deliveries were sent.</summary>
    public async Task<int> SendDueAsync(CancellationToken ct)
    {
        var now = Now;
        var due = (await db.SentMessages.Where(m => m.CancelledAt == null).ToListAsync(ct)).Where(m => m.SendAt <= now).Select(m => m.Id).ToList();
        var deliveries = await db.Deliveries.Where(d => due.Contains(d.SentMessageId) && d.Status == "scheduled").ToListAsync(ct);
        foreach (var d in deliveries) sent.Mark(d, d.Channel == "portal" ? "delivered" : "queued", null);
        await db.SaveChangesAsync(ct);
        var send = deliveries.Where(d => d.Status == "queued").Select(d => d.Id).ToList();
        await DeliverAsync(send, ct);
        return send.Count;
    }

    // ---------------------------------------------------------------- Templates

    private static readonly (string Key, string Name, string Category, string[] Channels, string Subject, string Body)[] Starters =
    [
        ("reminder", "Levy reminder", "collections", ["sms", "email"], "Your levy account {account.number}",
            "Hi {person.firstName}, a friendly reminder that {account.overdue} is overdue on your levy account for unit {unit.number}, {scheme.name}. Please pay using reference {account.number}, or call {agency.name} on {agency.phone} to arrange."),
        ("statement", "Statement covering note", "levies", ["email"], "Your {scheme.name} levy statement",
            "Dear {person.name},\n\nYour levy statement for unit {unit.number} is attached and in the resident portal. The balance owing is {account.balance}.\n\nKind regards,\n{agency.name}"),
        ("water", "Water outage", "maintenance", ["sms", "whatsapp", "email", "portal"], "Water off at {scheme.name}",
            "Hi {person.firstName}, the water at {scheme.name} will be off on [day] from [time] to [time] for [reason]. Please keep some water aside. – {agency.name}"),
        ("agm", "AGM date announcement", "meetings", ["email", "portal"], "{scheme.name}: AGM date",
            "Dear {person.name},\n\nThe annual general meeting of {scheme.name} will be held on [date] at [venue]. The formal notice, agenda and proxy form follow at least 14 days before.\n\nKind regards,\n{agency.name}"),
        ("request", "Request update", "maintenance", ["sms", "whatsapp", "portal"], "Update on your request",
            "Hi {person.firstName}, an update on the problem you reported at unit {unit.number}: [update]. – {agency.name}"),
        ("welcome", "Welcome to the portal", "general", ["email"], "Welcome to {scheme.name} on Humo Property Management",
            "Dear {person.name},\n\nYou can now see your levy account, statements, notices and requests for unit {unit.number} in the resident portal.\n\nKind regards,\n{agency.name}"),
    ];

    /// <summary>The organisation's templates. The first time, Humo's starter templates are added for it to edit.</summary>
    public async Task<List<MessageTemplateRow>> TemplatesAsync(Guid orgId, CancellationToken ct)
    {
        var rows = await db.MessageTemplates.Where(t => t.OrganisationId == orgId).ToListAsync(ct);
        if (rows.Count > 0) return rows;
        foreach (var s in Starters)
            db.MessageTemplates.Add(new MessageTemplateRow
            {
                Id = Guid.CreateVersion7(), OrganisationId = orgId, BuiltInKey = s.Key, Name = s.Name, Category = s.Category, Subject = s.Subject, Body = s.Body,
                Channels = JsonSerializer.Serialize(s.Channels, Json.Options), UpdatedAt = Now, UpdatedBy = "Humo PM",
            });
        await db.SaveChangesAsync(ct);
        return await db.MessageTemplates.Where(t => t.OrganisationId == orgId).ToListAsync(ct);
    }

    public static MessageTemplateDto ToDto(MessageTemplateRow t) => new(t.Id.ToString(), t.Version, t.Name, t.Category, t.Subject, t.Body,
        JsonSerializer.Deserialize<List<string>>(t.Channels, Json.Options) ?? [], t.BuiltInKey is not null, t.UpdatedAt.ToString("O"), t.UpdatedBy, t.Archived ? true : null);

    public static Dictionary<string, string> CheckTemplate(TemplateRequest t, IEnumerable<MessageTemplateRow> others)
    {
        var e = new Dictionary<string, string>();
        var name = (t.Name ?? "").Trim();
        var channels = t.Channels ?? [];
        var body = (t.Body ?? "").Trim();
        if (name.Length < 3) e["name"] = "Give it a name your team will recognise.";
        else if (others.Any(x => !x.Archived && string.Equals(x.Name.Trim(), name, StringComparison.OrdinalIgnoreCase))) e["name"] = "There’s already a template with that name.";
        if (!Categories.Contains(t.Category)) e["category"] = "Choose a category.";
        if (channels.Count == 0 || channels.Any(c => !Channels.Contains(c))) e["channels"] = "Which channels is it written for?";
        if (channels.Contains("email") && (t.Subject ?? "").Trim().Length < 3) e["subject"] = "Email templates need a subject.";
        if (body.Length < 10) e["body"] = "Write the message.";
        else if (channels.Contains("sms") && body.Length > 480) e["body"] = "Too long for SMS (480 characters at most).";
        else if (UnknownFields(body + " " + t.Subject).ToList() is { Count: > 0 } unknown) e["body"] = $"Unknown field{(unknown.Count == 1 ? "" : "s")}: {string.Join(", ", unknown.Select(f => "{" + f + "}"))}.";
        return e;
    }

    // ---------------------------------------------------------------- Notices

    public static readonly string[] NoticeAudiences = ["residents", "owners", "trustees"];
    public static readonly string[] NoticeCategories = ["general", "maintenance", "meeting", "finance", "security", "rules"];

    /// <summary>How new notices go out: the agency's rule for "New notice" (Settings › Notifications), else Humo's default (email and the portal).</summary>
    public async Task<List<string>> NoticeChannelsAsync(Guid orgId, CancellationToken ct)
    {
        var json = await db.AgencySettings.Where(s => s.OrganisationId == orgId).Select(s => s.NotificationsJson).FirstOrDefaultAsync(ct);
        var rule = json is null ? null : JsonSerializer.Deserialize<List<NotificationRuleDto>>(json, Json.Options)?.FirstOrDefault(r => r.Event == "notice-published");
        return rule is null ? ["email", "portal"] : rule.Enabled ? rule.Channels : ["portal"];
    }

    public static NoticeViewDto View(NoticeRow n, SchemeDto scheme, DateTimeOffset now) => new(
        new NoticeDto(n.Id.ToString(), n.Version, n.Ref, n.SchemeId.ToString(), n.Title, n.Body, n.Audience, n.Category, n.PublishedAt.ToString("O"), n.PublishedBy, n.Pinned,
            n.ExpiresAt?.ToString("O"), JsonSerializer.Deserialize<List<string>>(n.SentBy, Json.Options) ?? [], n.Recipients,
            n.WithdrawnAt is { } w ? new { at = w.ToString("O"), by = n.WithdrawnBy, reason = n.WithdrawnReason } : null),
        scheme, n.WithdrawnAt is null && (n.ExpiresAt is null || n.ExpiresAt > now));
}

/// <summary>
/// Communications endpoints (docs/18 R-5). Reads: Communications.View within the person's schemes. Sending, templates
/// and notices: Messages.Reply and the communications entitlement.
///   GET  /communications/templates    POST /communications/templates    PUT …/templates/{id}    POST …/templates/{id}/archive
///   POST /communications/preview      POST /communications/messages
///   GET  /notices?schemeIds=…   GET /me/notices   POST /notices   POST /notices/{id}/actions
/// </summary>
public static class CommunicationsEndpoints
{
    public static void MapCommunications(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/communications").RequireAuthorization();
        g.MapGet("/templates", Templates);
        g.MapPost("/templates", CreateTemplate);
        g.MapPut("/templates/{id:guid}", UpdateTemplate);
        g.MapPost("/templates/{id:guid}/archive", ArchiveTemplate);
        g.MapPost("/preview", Preview);
        g.MapPost("/messages", Send);
        var n = api.MapGroup("/notices").RequireAuthorization();
        n.MapGet("", Notices);
        n.MapPost("", Publish);
        n.MapPost("/{id:guid}/actions", ActOnNotice);
        api.MapGet("/me/notices", MyNotices).RequireAuthorization();
        api.MapPost("/me/notices/{id:guid}/read", ReadNotice).RequireAuthorization();
    }

    private static async Task<IResult> Templates(CurrentActor current, Communications comms, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org } actor || !actor.Can("Communications.View")) return Results.Ok(Array.Empty<MessageTemplateDto>());
        return Results.Ok((await comms.TemplatesAsync(org, ct)).Where(t => !t.Archived).OrderBy(t => t.BuiltInKey is null).ThenBy(t => t.Name).Select(Communications.ToDto));
    }

    private static async Task<IResult> CreateTemplate(TemplateRequest body, CurrentActor current, CommandRunner commands, Communications comms, HumoDbContext db, TimeProvider clock,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org }) return Problems.NotFound();
        var others = await comms.TemplatesAsync(org, ct);
        return await commands.RunAsync(new CommandSpec($"Created message template “{body.Name?.Trim()}”", Communications.Permission)
        {
            Resource = "MessageTemplate",
            Feature = Communications.Feature,
            Validate = () => Communications.CheckTemplate(body, others),
        }, actor =>
        {
            var row = new MessageTemplateRow { Id = Guid.CreateVersion7(), OrganisationId = org };
            Apply(row, body, actor, clock);
            db.MessageTemplates.Add(row);
            return Task.FromResult(Results.Created($"/api/communications/templates/{row.Id}", new { id = row.Id.ToString() }));
        }, ct);
    }

    private static async Task<IResult> UpdateTemplate(Guid id, TemplateRequest body, CurrentActor current, CommandRunner commands, Communications comms, TimeProvider clock,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org }) return Problems.NotFound();
        var all = await comms.TemplatesAsync(org, ct);
        if (all.FirstOrDefault(t => t.Id == id) is not { } row) return Problems.NotFound();
        return await commands.RunAsync(new CommandSpec($"Edited message template “{body.Name?.Trim()}”", Communications.Permission)
        {
            Resource = "MessageTemplate",
            ResourceId = id.ToString(),
            Feature = Communications.Feature,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = row.Version,
            Validate = () => Communications.CheckTemplate(body, all.Where(t => t.Id != id)),
        }, actor =>
        {
            Apply(row, body, actor, clock);
            row.Version++;
            return Task.FromResult(Results.Ok(new { id = row.Id.ToString() }));
        }, ct);
    }

    private static void Apply(MessageTemplateRow row, TemplateRequest t, Actor actor, TimeProvider clock)
    {
        row.Name = t.Name!.Trim();
        row.Category = t.Category!;
        row.Subject = (t.Subject ?? "").Trim();
        row.Body = t.Body!.Trim();
        row.Channels = JsonSerializer.Serialize(t.Channels!.Distinct(), Json.Options);
        row.UpdatedAt = clock.GetUtcNow();
        row.UpdatedBy = actor.Human.Name;
    }

    /// <summary>Humo's starter templates can be edited but not archived; the agency's own can.</summary>
    private static async Task<IResult> ArchiveTemplate(Guid id, CurrentActor current, CommandRunner commands, Communications comms, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org }) return Problems.NotFound();
        if ((await comms.TemplatesAsync(org, ct)).FirstOrDefault(t => t.Id == id) is not { } row) return Problems.NotFound();
        return await commands.RunAsync(new CommandSpec($"Archived message template “{row.Name}”", Communications.Permission)
        {
            Resource = "MessageTemplate",
            ResourceId = id.ToString(),
            Feature = Communications.Feature,
            Validate = () => row.BuiltInKey is not null ? new() { ["id"] = "Humo’s starter templates can be edited, not archived." } : row.Archived ? new() { ["id"] = "Already archived." } : [],
        }, _ =>
        {
            row.Archived = true;
            row.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<Scheme?> SchemeAsync(Actor actor, HumoDbContext db, string? schemeId, CancellationToken ct) =>
        Guid.TryParse(schemeId, out var id) ? await SchemeEndpoints.Visible(actor, db).FirstOrDefaultAsync(s => s.Id == id, ct) : null;

    private static Dictionary<string, string> CheckAudience(AudienceDto? a, Scheme? scheme)
    {
        if (a is null || scheme is null) return new() { ["schemeId"] = "Choose a scheme." };
        if (!new[] { "owners", "residents", "tenants", "trustees", "arrears", "units" }.Contains(a.Kind)) return new() { ["audience"] = "Choose who it’s for." };
        if (a.Kind == "units" && (a.UnitIds?.Count ?? 0) == 0) return new() { ["units"] = "Choose at least one unit." };
        return [];
    }

    /// <summary>Who the audience reaches, by which channel, and who can't be reached. Changes nothing.</summary>
    private static async Task<IResult> Preview(PreviewRequest body, CurrentActor current, HumoDbContext db, Communications comms, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Communications.View")) return Problems.NotFound();
        var scheme = await SchemeAsync(actor, db, body.Audience?.SchemeId, ct);
        var e = CheckAudience(body.Audience, scheme);
        if (e.Count > 0) return Problems.Validation(e);
        return Results.Ok(await comms.PreviewAsync(body.Audience! with { SchemeId = scheme!.Id.ToString() }, body.Channels ?? [], ct));
    }

    private static async Task<IResult> Send(ComposeRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Communications comms, DeliveryQueue queue,
        TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var scheme = await SchemeAsync(me, db, body.Audience?.SchemeId, ct);
        var channels = body.Channels ?? [];
        var subject = (body.Subject ?? "").Trim();
        var text = (body.Body ?? "").Trim();
        DateTimeOffset? sendAt = DateTimeOffset.TryParse(body.SendAt, CultureInfo.InvariantCulture, DateTimeStyles.None, out var at) ? at : null;
        var reachable = scheme is not null && body.Audience is not null && CheckAudience(body.Audience, scheme).Count == 0
            && (await comms.PreviewAsync(body.Audience with { SchemeId = scheme.Id.ToString() }, channels, ct)).Recipients.Count > 0;
        var templateId = Guid.TryParse(body.TemplateId, out var t) ? t : (Guid?)null;
        var label = scheme is null || body.Audience is null ? "an audience" : await comms.AudienceLabelAsync(body.Audience with { SchemeId = scheme.Id.ToString() }, ct);
        return await commands.RunAsync(new CommandSpec($"{(sendAt is null ? "Sent" : "Scheduled")} “{(subject.Length > 0 ? subject : text[..Math.Min(40, text.Length)])}” to {label}", Communications.Permission)
        {
            Resource = "Message",
            SchemeId = scheme?.Id,
            Feature = Communications.Feature,
            Validate = () =>
            {
                var e = CheckAudience(body.Audience, scheme);
                if (channels.Count == 0 || channels.Any(c => !Communications.Channels.Contains(c))) e["channels"] = "Choose at least one channel.";
                if (channels.Contains("email") && subject.Length < 3) e["subject"] = "Emails need a subject.";
                if (text.Length < 10) e["body"] = "Write the message.";
                else if (channels is ["sms"] && text.Length > 480) e["body"] = "Too long for SMS: keep it under 480 characters (3 messages).";
                else if (Communications.UnknownFields(text + " " + subject).ToList() is { Count: > 0 } unknown)
                    e["body"] = $"Unknown field{(unknown.Count == 1 ? "" : "s")}: {string.Join(", ", unknown.Select(f => "{" + f + "}"))}.";
                if (body.SendAt is not null && sendAt is null) e["sendAt"] = "Choose a date and time.";
                else if (sendAt < clock.GetUtcNow().AddMinutes(-1)) e["sendAt"] = "That time has passed: send now instead.";
                if (e.Count == 0 && !reachable) e["audience"] = "Nobody in this audience can be reached by the chosen channels.";
                return e;
            },
        }, async actor =>
        {
            var (message, now) = await comms.SendAsync("message", body.Audience! with { SchemeId = scheme!.Id.ToString() }, subject, text, channels, sendAt, templateId, actor.Human.Name, null, ct);
            commands.AfterCommit(() =>
            {
                queue.Enqueue(DeliveryQueue.Messages, now);
                return Task.CompletedTask;
            });
            return Results.Created($"/api/communications/sent/{message.Id}", new { id = message.Id.ToString() });
        }, ct);
    }

    // ---------------------------------------------------------------- Notices

    private static async Task<IResult> Notices(string[]? schemeIds, CurrentActor current, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Communications.View")) return Results.Ok(Array.Empty<NoticeViewDto>());
        var wanted = (schemeIds ?? []).Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).ToList();
        var visible = await SchemeEndpoints.Visible(actor, db).Where(s => wanted.Contains(s.Id)).ToListAsync(ct);
        var ids = visible.Select(s => s.Id).ToList();
        var rows = await db.SchemeNotices.Where(n => ids.Contains(n.SchemeId)).ToListAsync(ct);
        // Trustees see notices for residents, owners and trustees of their scheme; that's all of them.
        return Results.Ok(await ViewsAsync(rows, visible, db, clock, ct));
    }

    private static async Task<List<NoticeViewDto>> ViewsAsync(List<NoticeRow> rows, List<Scheme> schemes, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var dtos = (await SchemeEndpoints.ToDtos(schemes, db, ct)).ToDictionary(s => s.Id);
        var now = clock.GetUtcNow();
        return [.. rows.Select(n => Communications.View(n, dtos[n.SchemeId.ToString()], now))
            .OrderByDescending(v => v.Current && v.Notice.Pinned).ThenByDescending(v => v.Notice.PublishedAt, StringComparer.Ordinal)];
    }

    /// <summary>Residents: current notices for their scheme and audience (owners see owners' notices too).</summary>
    private static async Task<IResult> MyNotices(CurrentActor current, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var role = actor.Assignment.Role;
        if (role is not (Roles.Owner or Roles.Tenant) || actor.Assignment.SchemeIds.FirstOrDefault() is not { } s || !Guid.TryParse(s, out var schemeId))
            return Results.Ok(Array.Empty<NoticeViewDto>());
        var audiences = role == Roles.Owner ? new[] { "residents", "owners" } : ["residents"];
        var rows = await db.SchemeNotices.Where(n => n.SchemeId == schemeId && audiences.Contains(n.Audience) && n.WithdrawnAt == null).ToListAsync(ct);
        var scheme = await db.Schemes.FirstAsync(x => x.Id == schemeId, ct);
        return Results.Ok((await ViewsAsync(rows, [scheme], db, clock, ct)).Where(v => v.Current));
    }

    /// <summary>A resident opened the notice in the portal: their portal delivery shows as read in Sent.</summary>
    private static async Task<IResult> ReadNotice(Guid id, CurrentActor current, HumoDbContext db, SentRecords sent, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!Guid.TryParse(actor.User.PersonId, out var personId) || await db.SchemeNotices.FirstOrDefaultAsync(n => n.Id == id, ct) is not { } n) return Problems.NotFound();
        if (n.SentMessageId is { } m) await sent.MarkReadAsync([m], personId, ct);
        return Results.NoContent();
    }

    private static async Task<IResult> Publish(NewNoticeRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Communications comms, DeliveryQueue queue,
        TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var scheme = await SchemeAsync(me, db, body.SchemeId, ct);
        var title = (body.Title ?? "").Trim();
        var text = (body.Body ?? "").Trim();
        DateTimeOffset? expires = DateOnly.TryParseExact((body.ExpiresAt ?? "")[..Math.Min(10, (body.ExpiresAt ?? "").Length)], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)
            ? new DateTimeOffset(day.ToDateTime(new TimeOnly(23, 59)), TimeSpan.FromHours(2)) : null;
        return await commands.RunAsync(new CommandSpec($"Published notice “{title}”", Communications.Permission)
        {
            Resource = "Notice",
            SchemeId = scheme?.Id,
            Feature = Communications.Feature,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (scheme is null) e["schemeId"] = "Choose a scheme.";
                if (title.Length < 5) e["title"] = "A short headline people will understand at a glance.";
                else if (title.Length > 120) e["title"] = "Keep the headline under 120 characters.";
                if (text.Length < 20) e["body"] = "Say what’s happening, when, and what people should do.";
                if (!Communications.NoticeAudiences.Contains(body.Audience)) e["audience"] = "Choose who it’s for.";
                if (!Communications.NoticeCategories.Contains(body.Category)) e["category"] = "Choose a category.";
                if (body.ExpiresAt is not null && expires is null) e["expiresAt"] = "Choose a date.";
                else if (expires < clock.GetUtcNow()) e["expiresAt"] = "The end date has already passed.";
                return e;
            },
        }, async actor =>
        {
            var refs = await db.SchemeNotices.Where(n => n.SchemeId == scheme!.Id).Select(n => n.Ref).ToListAsync(ct);
            var next = refs.Select(r => int.TryParse(r.Split('-')[^1], out var x) ? x : 0).DefaultIfEmpty(0).Max() + 1;
            var channels = await comms.NoticeChannelsAsync(scheme!.OrganisationId, ct);
            var audience = new AudienceDto(scheme.Id.ToString(), body.Audience!, null, null, null);
            var notice = new NoticeRow
            {
                Id = Guid.CreateVersion7(), Ref = $"NTC-{scheme.Code}-{next}", OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, Title = title, Body = text,
                Audience = body.Audience!, Category = body.Category!, PublishedAt = clock.GetUtcNow(), PublishedBy = actor.Human.Name, Pinned = body.Pinned, ExpiresAt = expires,
                SentBy = JsonSerializer.Serialize(channels, Json.Options), Recipients = (await comms.PeopleAsync(audience, ct)).Count,
            };
            db.SchemeNotices.Add(notice);
            // It goes out by the agency's rule for new notices, and is recorded in Sent like everything else.
            var (record, now) = await comms.SendAsync("notice", audience, title, text, channels, null, null, actor.Human.Name, new SentSourceDto($"Notice {notice.Ref}", "/communications/notices"), ct);
            notice.SentMessageId = record.Id;
            commands.AfterCommit(() =>
            {
                queue.Enqueue(DeliveryQueue.Messages, now);
                return Task.CompletedTask;
            });
            return Results.Created($"/api/notices/{notice.Id}", new { id = notice.Id.ToString() });
        }, ct);
    }

    private static async Task<IResult> ActOnNotice(Guid id, NoticeActionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var n = await db.SchemeNotices.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (n is null || !await SchemeEndpoints.Visible(me, db).AnyAsync(s => s.Id == n.SchemeId, ct)) return Problems.NotFound();
        var a = body.Action ?? new NoticeAction("", null);
        var verb = a.Type switch { "withdraw" => "Withdrew", "pin" => "Pinned", "unpin" => "Unpinned", _ => a.Type };
        return await commands.RunAsync(new CommandSpec($"{verb} notice “{n.Title}”", Communications.Permission)
        {
            Resource = "Notice",
            ResourceId = n.Ref,
            SchemeId = n.SchemeId,
            Feature = Communications.Feature,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = n.Version,
            Validate = () => a.Type is not ("pin" or "unpin" or "withdraw") ? new() { ["type"] = "Pin, unpin or withdraw." }
                : a.Type == "withdraw" && n.WithdrawnAt is not null ? new() { ["id"] = "Already withdrawn." }
                : a.Type == "withdraw" && (a.Reason ?? "").Trim().Length < 3 ? new() { ["reason"] = "Say why, for the audit log." } : [],
        }, actor =>
        {
            if (a.Type == "withdraw")
            {
                n.WithdrawnAt = clock.GetUtcNow();
                n.WithdrawnBy = actor.Human.Name;
                n.WithdrawnReason = a.Reason!.Trim();
            }
            else n.Pinned = a.Type == "pin";
            n.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }
}
