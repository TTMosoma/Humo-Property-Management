using System.Globalization;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Finance;
using Humo.Api.Portfolio;
using Humo.Domain.Commercial;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Messaging;

// The shapes match SentMessage and SentView in the app (messaging.ts).
public sealed record DeliveryDto(string Id, string PersonId, string Name, string? UnitLabel, string Channel, string Address, string Status, string At, string? Error,
    Dictionary<string, string> Values);
public sealed record SkippedDto(string PersonId, string Name, string? UnitLabel, string Reason);
public sealed record SentSourceDto(string Label, string Route);
public sealed record SentMessageDto(string Id, int Version, string Ref, string Kind, string SchemeId, string Subject, string Body, string? TemplateId, List<string> Channels,
    string AudienceLabel, string CreatedAt, string SentBy, string SendAt, object? Cancelled, IReadOnlyList<DeliveryDto> Deliveries, IReadOnlyList<SkippedDto> Skipped, SentSourceDto? Source);
public sealed record SentViewDto(SentMessageDto Message, SchemeDto Scheme, Dictionary<string, int> Counts, string State);

/// <summary>Someone a send reaches, by which channel, and the document it carries.</summary>
public sealed record Recipient(Guid PersonId, string Name, string? UnitLabel, string Channel, string Address, Dictionary<string, string> Values, Guid? DocumentId,
    string Status = "queued", string? Error = null);

/// <summary>
/// Communications › Sent on the API (docs/18 R-5): one record of what Humo PM sent, with each person's
/// delivery and its result as the mail server or SMS provider reported it. Statements and collection
/// letters are recorded when they're sent; composed messages and notices follow with Compose on the API.
/// </summary>
public sealed class SentRecords(HumoDbContext db, TimeProvider clock)
{
    public static readonly string[] Statuses = ["scheduled", "queued", "delivered", "read", "failed", "bounced"];

    /// <summary>A Sent record and its deliveries, added to this unit of work.</summary>
    public async Task<SentMessageRow> RecordAsync(string kind, Guid orgId, Guid schemeId, string subject, string body, string audienceLabel, string by, SentSourceDto? source,
        IReadOnlyList<Recipient> to, IReadOnlyList<SkippedDto>? skipped, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var message = new SentMessageRow
        {
            Id = Guid.CreateVersion7(), Ref = await NextRefAsync(orgId, ct), OrganisationId = orgId, SchemeId = schemeId, Kind = kind, Subject = subject, Body = body,
            Channels = JsonSerializer.Serialize(to.Select(r => r.Channel).Distinct(), Json.Options), AudienceLabel = audienceLabel, CreatedAt = now, SentBy = by, SendAt = now,
            SourceLabel = source?.Label, SourceRoute = source?.Route, Skipped = JsonSerializer.Serialize(skipped ?? [], Json.Options),
        };
        db.SentMessages.Add(message);
        foreach (var r in to)
            db.Deliveries.Add(new DeliveryRow
            {
                Id = Guid.CreateVersion7(), SentMessageId = message.Id, PersonId = r.PersonId, Name = r.Name, UnitLabel = r.UnitLabel, Channel = r.Channel, Address = r.Address,
                Status = r.Status, Error = r.Error, At = now, Values = JsonSerializer.Serialize(r.Values, Json.Options), DocumentId = r.DocumentId,
            });
        return message;
    }

    /// <summary>"MSG-2001" onwards, per organisation.</summary>
    private async Task<string> NextRefAsync(Guid orgId, CancellationToken ct)
    {
        var refs = (await db.SentMessages.Where(m => m.OrganisationId == orgId).Select(m => m.Ref).ToListAsync(ct))
            .Concat(db.SentMessages.Local.Where(m => m.OrganisationId == orgId).Select(m => m.Ref));
        var last = refs.Select(r => int.TryParse(r.AsSpan(4), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0).DefaultIfEmpty(2000).Max();
        return $"MSG-{last + 1}";
    }

    /// <summary>The latest delivery carrying this statement or letter, if it was recorded in Sent.</summary>
    public async Task<DeliveryRow?> DeliveryForAsync(Guid documentId, CancellationToken ct) =>
        (await db.Deliveries.Where(d => d.DocumentId == documentId).ToListAsync(ct)).OrderByDescending(d => d.At).FirstOrDefault();

    /// <summary>Records what the mail server or SMS provider said about a delivery.</summary>
    public async Task MarkAsync(Guid documentId, string status, string? error, CancellationToken ct, string? providerMessageId = null)
    {
        if (await DeliveryForAsync(documentId, ct) is not { } d) return;
        Mark(d, status, error, providerMessageId);
        await db.SaveChangesAsync(ct);
    }

    public void Mark(DeliveryRow d, string status, string? error, string? providerMessageId = null)
    {
        d.Status = status;
        d.Error = error;
        d.At = clock.GetUtcNow();
        if (providerMessageId is not null) d.ProviderMessageId = providerMessageId;
    }

    /// <summary>
    /// An account holder as a recipient by this channel. Someone who can't be reached by it is recorded as a failed
    /// delivery with the reason, so it shows in Sent instead of disappearing. Null when the account has no holder.
    /// </summary>
    public async Task<Recipient?> RecipientAsync(LevyAccount a, string channel, Guid? documentId, CancellationToken ct)
    {
        if (a.HolderPersonId is not { } holderId || await db.People.AsNoTracking().FirstOrDefaultAsync(p => p.Id == holderId, ct) is not { } holder) return null;
        var unit = await db.Units.AsNoTracking().FirstAsync(u => u.Id == a.UnitId, ct);
        var scheme = await db.Schemes.AsNoTracking().FirstAsync(s => s.Id == a.SchemeId, ct);
        var org = await db.Organisations.AsNoTracking().FirstAsync(o => o.Id == scheme.OrganisationId, ct);
        var values = Values(holder, unit, scheme, a, org.ShortName, await AgencyPhoneAsync(db, org.Id, ct));
        var label = $"Unit {unit.Number}";
        return channel switch
        {
            "email" when !Settings.SettingsEndpoints.IsEmail(holder.Email) => new(holder.Id, holder.DisplayName, label, channel, "", values, documentId, "failed", "No email address on record"),
            "email" => new(holder.Id, holder.DisplayName, label, channel, holder.Email.Trim(), values, documentId),
            "sms" when !Humo.Infrastructure.Messaging.MobileNumber.TryNormalise(holder.Phone, out _) => new(holder.Id, holder.DisplayName, label, channel, holder.Phone, values, documentId, "failed", "No mobile number on record"),
            "sms" => new(holder.Id, holder.DisplayName, label, channel, holder.Phone, values, documentId),
            // The resident portal shows it as soon as it's issued.
            "portal" => new(holder.Id, holder.DisplayName, label, channel, "Resident portal", values, documentId, "delivered"),
            _ => new(holder.Id, holder.DisplayName, label, channel, "By post", values, documentId),
        };
    }

    /// <summary>Read receipts from the portal: the person opened it there. Only portal deliveries that arrived are marked; email and SMS can't tell us.</summary>
    public async Task MarkReadAsync(IEnumerable<Guid> sentMessageIds, Guid personId, CancellationToken ct)
    {
        var ids = sentMessageIds.Distinct().ToList();
        if (ids.Count == 0) return;
        var unread = await db.Deliveries.Where(d => ids.Contains(d.SentMessageId) && d.PersonId == personId && d.Channel == "portal" && d.Status == "delivered").ToListAsync(ct);
        foreach (var d in unread) Mark(d, "read", null);
        if (unread.Count > 0) await db.SaveChangesAsync(ct);
    }

    /// <summary>The agency's phone (Settings › Agency), or the documents contact phone when the agency details don't have one.</summary>
    public static async Task<string> AgencyPhoneAsync(HumoDbContext db, Guid orgId, CancellationToken ct)
    {
        var phone = await db.AgencySettings.Where(s => s.OrganisationId == orgId).Select(s => s.Phone).FirstOrDefaultAsync(ct);
        return string.IsNullOrWhiteSpace(phone) ? await db.DocumentSettings.Where(s => s.OrganisationId == orgId).Select(s => s.ContactPhone).FirstOrDefaultAsync(ct) ?? "" : phone;
    }

    /// <summary>The merge values a statement or letter delivery used, like the app's Compose fills them in.</summary>
    public static Dictionary<string, string> Values(Person p, Unit u, Scheme s, LevyAccount a, string agencyName, string agencyPhone) => new()
    {
        ["person.name"] = p.DisplayName,
        ["person.firstName"] = p.Kind == "individual" ? p.FirstName : p.DisplayName,
        ["unit.number"] = u.Number,
        ["scheme.name"] = s.Name,
        ["account.number"] = a.AccountNo,
        ["account.balance"] = BillingRules.Rand(Math.Max(0, a.Balance)),
        ["account.overdue"] = BillingRules.Rand(CreditControlRules.Overdue(CreditControl.Ageing(a))),
        ["agency.name"] = agencyName,
        ["agency.phone"] = agencyPhone,
    };

    // ---------------------------------------------------------------- Reads

    public async Task<List<SentViewDto>> ViewsAsync(List<SentMessageRow> messages, CancellationToken ct)
    {
        var ids = messages.Select(m => m.Id).ToList();
        var deliveries = (await db.Deliveries.Where(d => ids.Contains(d.SentMessageId)).ToListAsync(ct)).ToLookup(d => d.SentMessageId);
        var schemeIds = messages.Select(m => m.SchemeId).Distinct().ToList();
        var schemes = (await SchemeEndpoints.ToDtos(await db.Schemes.Where(s => schemeIds.Contains(s.Id)).ToListAsync(ct), db, ct)).ToDictionary(s => s.Id);
        return [.. messages.Select(m =>
        {
            var list = deliveries[m.Id].OrderBy(d => d.Name).ToList();
            var counts = Statuses.ToDictionary(s => s, s => list.Count(d => d.Status == s));
            var state = m.CancelledAt is not null ? "cancelled" : counts["scheduled"] > 0 ? "scheduled" : counts["queued"] > 0 ? "sending" : "sent";
            var dto = new SentMessageDto(m.Id.ToString(), m.Version, m.Ref, m.Kind, m.SchemeId.ToString(), m.Subject, m.Body, m.TemplateId?.ToString(),
                JsonSerializer.Deserialize<List<string>>(m.Channels, Json.Options) ?? [], m.AudienceLabel, m.CreatedAt.ToString("O"), m.SentBy, m.SendAt.ToString("O"),
                m.CancelledAt is { } c ? new { at = c.ToString("O"), by = m.CancelledBy } : null,
                [.. list.Select(d => new DeliveryDto(d.Id.ToString(), d.PersonId.ToString(), d.Name, d.UnitLabel, d.Channel, d.Address, d.Status, d.At.ToString("O"), d.Error,
                    JsonSerializer.Deserialize<Dictionary<string, string>>(d.Values, Json.Options) ?? []))],
                JsonSerializer.Deserialize<List<SkippedDto>>(m.Skipped, Json.Options) ?? [],
                m.SourceLabel is { } label ? new SentSourceDto(label, m.SourceRoute ?? "") : null);
            return new SentViewDto(dto, schemes[m.SchemeId.ToString()], counts, state);
        })];
    }
}

/// <summary>
/// Communications › Sent (Communications.View, within the person's schemes):
///   GET  /communications/sent?schemeIds=…   newest first
///   GET  /communications/sent/{id}          with each delivery
///   POST /communications/sent/{id}/retry    the failed deliveries again (Messages.Reply)
///   POST /communications/sent/{id}/cancel   a scheduled one (nothing is scheduled on the API yet)
/// </summary>
public static class SentEndpoints
{
    public static void MapSent(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/communications/sent").RequireAuthorization();
        g.MapGet("", List);
        g.MapGet("/{id:guid}", Get);
        g.MapPost("/{id:guid}/retry", Retry);
        g.MapPost("/{id:guid}/cancel", Cancel);
    }

    private static async Task<IQueryable<SentMessageRow>?> VisibleAsync(Actor actor, HumoDbContext db, CancellationToken ct)
    {
        if (actor.OrganisationId is not { } org || !actor.Can("Communications.View")) return null;
        var schemes = await SchemeEndpoints.Visible(actor, db).Select(s => s.Id).ToListAsync(ct);
        return db.SentMessages.Where(m => m.OrganisationId == org && schemes.Contains(m.SchemeId));
    }

    private static async Task<IResult> List(string[]? schemeIds, CurrentActor current, HumoDbContext db, SentRecords sent, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await VisibleAsync(actor, db, ct) is not { } visible) return Results.Ok(Array.Empty<SentViewDto>());
        var wanted = (schemeIds ?? []).Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).ToList();
        var messages = (await visible.Where(m => wanted.Contains(m.SchemeId)).ToListAsync(ct)).OrderByDescending(m => m.CreatedAt).ToList();
        return Results.Ok(await sent.ViewsAsync(messages, ct));
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, SentRecords sent, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await VisibleAsync(actor, db, ct) is not { } visible || await visible.FirstOrDefaultAsync(m => m.Id == id, ct) is not { } message) return Problems.NotFound();
        return Results.Ok((await sent.ViewsAsync([message], ct))[0]);
    }

    /// <summary>Statements and letters whose delivery failed go out again (in the background), from the same issued document.</summary>
    private static async Task<IResult> Retry(Guid id, CurrentActor current, CommandRunner commands, HumoDbContext db, SentRecords sent, DeliveryQueue queue, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await VisibleAsync(me, db, ct) is not { } visible || await visible.FirstOrDefaultAsync(m => m.Id == id, ct) is not { } message) return Problems.NotFound();
        // Statements and letters go again from their issued document; composed messages and notices from their text.
        var documents = message.Kind is "statement" or "letter" or "reminder";
        var failed = await db.Deliveries.Where(d => d.SentMessageId == id && (d.Status == "failed" || d.Status == "bounced") && (!documents || d.DocumentId != null))
            .ToListAsync(ct);
        return await commands.RunAsync(new CommandSpec($"Retried {failed.Count} failed deliver{(failed.Count == 1 ? "y" : "ies")} of {message.Ref}", "Messages.Reply")
        {
            Resource = "Sent message",
            ResourceId = message.Ref,
            SchemeId = message.SchemeId,
            Validate = () => failed.Count == 0 ? new() { ["deliveries"] = "Nothing failed: there’s nothing to retry." } : [],
        }, actor =>
        {
            foreach (var d in failed) sent.Mark(d, "queued", null);
            var ids = documents ? failed.Select(d => d.DocumentId!.Value).ToList() : failed.Select(d => d.Id).ToList();
            var kind = !documents ? DeliveryQueue.Messages : message.Kind == "statement" ? DeliveryQueue.Statements : DeliveryQueue.Letters;
            commands.AfterCommit(() =>
            {
                queue.Enqueue(kind, ids);
                return Task.CompletedTask;
            });
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>A scheduled message that hasn't gone out yet. Nothing is sent; it stays in Sent as cancelled.</summary>
    private static async Task<IResult> Cancel(Guid id, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await VisibleAsync(me, db, ct) is not { } visible || await visible.FirstOrDefaultAsync(m => m.Id == id, ct) is not { } message) return Problems.NotFound();
        var scheduled = await db.Deliveries.AnyAsync(d => d.SentMessageId == id && d.Status == "scheduled", ct);
        return await commands.RunAsync(new CommandSpec($"Cancelled scheduled message {message.Ref}", "Messages.Reply")
        {
            Resource = "Sent message",
            ResourceId = message.Ref,
            SchemeId = message.SchemeId,
            Validate = () => message.CancelledAt is not null ? new() { ["sendAt"] = "Already cancelled." }
                : !scheduled || message.SendAt <= clock.GetUtcNow() ? new() { ["sendAt"] = "This has already been sent: only a scheduled message can be cancelled." } : [],
        }, actor =>
        {
            message.CancelledAt = clock.GetUtcNow();
            message.CancelledBy = actor.Human.Name;
            message.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }
}
