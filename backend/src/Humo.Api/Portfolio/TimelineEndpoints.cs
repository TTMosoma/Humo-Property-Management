using System.Globalization;
using Humo.Api.Commands;
using Humo.Api.Finance;
using Humo.Api.Platform;
using Humo.Domain.Access;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Portfolio;

/// <summary>As the frontend's <c>TimelineEvent</c> (pattern P4).</summary>
public sealed record TimelineEventDto(string Id, string At, string Kind, string Title, string? Detail = null, string? Actor = null, decimal? Amount = null, string? Link = null);
public sealed record NewNoteRequest(string? UnitId, string? PersonId, string? Kind, string? Text);
public sealed record PaymentReportRequest(string? Text);

/// <summary>
/// Timelines and notes: everything that happened to a unit or a person, in one stream. Built from the records
/// themselves (the ledger, issued statements, maintenance jobs, who owned or rented it) plus the notes and calls staff
/// log. Owners tell the agency they've paid from My account; that lands on the unit as a note and staff are told.
/// </summary>
public static class TimelineEndpoints
{
    public const int MaxNote = 2000;

    public static void MapTimeline(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("").RequireAuthorization();
        g.MapGet("/units/{id:guid}/timeline", ForUnit);
        g.MapGet("/people/{id:guid}/timeline", ForPerson);
        g.MapPost("/notes", AddNote);
        g.MapPost("/accounts/{id:guid}/payment-report", ReportPayment);
    }

    private static string Month(string period) =>
        new DateTime(int.Parse(period[..4], CultureInfo.InvariantCulture), int.Parse(period[5..7], CultureInfo.InvariantCulture), 1).ToString("MMMM yyyy", CultureInfo.InvariantCulture);

    /// <summary>A calendar date as a moment: 08:00 South African time, so it sorts sensibly against timestamps.</summary>
    private static string At(DateOnly d) => new DateTimeOffset(d.ToDateTime(new TimeOnly(8, 0)), TimeSpan.FromHours(2)).ToString("O");

    private static TimelineEventDto FromNote(NoteRow n, string? prefix = null) =>
        new(n.Id.ToString(), n.At.ToString("O"), n.Kind, prefix + (n.Kind == "call" ? "Call logged" : "Note"), n.Text, n.Author);

    private static async Task<List<TimelineEventDto>> UnitEventsAsync(HumoDbContext db, Unit unit, string prefix, CancellationToken ct)
    {
        var events = new List<TimelineEventDto>();
        var unitLink = $"/schemes/{unit.SchemeId}/units/{unit.Number}";
        if (await db.LevyAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.UnitId == unit.Id, ct) is { } account)
        {
            var accountLink = $"{unitLink}/account";
            var lines = await db.Ledger.AsNoTracking().Where(e => e.AccountId == account.Id).ToListAsync(ct);
            foreach (var e in lines.Where(e => e.Type is TransactionTypes.Payment or TransactionTypes.Adjustment or TransactionTypes.Reversal))
                events.Add(new($"ev-{e.Id}", At(e.Date), "payment", prefix + (e.Type switch { TransactionTypes.Payment => "Payment received", TransactionTypes.Reversal => "Payment reversed", _ => "Adjustment" }),
                    e.Reference is { Length: > 0 } r ? $"Reference “{r}”" : e.Description, null, -e.Amount, accountLink));
            foreach (var month in lines.Where(e => e.Type is not (TransactionTypes.Payment or TransactionTypes.Adjustment or TransactionTypes.Reversal)).GroupBy(e => e.Date.ToString("yyyy-MM", CultureInfo.InvariantCulture)))
            {
                var first = month.OrderBy(e => e.Date).First();
                events.Add(new($"ev-charges-{account.Id}-{month.Key}", At(first.Date), "charge", prefix + $"{Month(month.Key)} charges raised",
                    string.Join(" · ", month.Select(e => e.Description.Split(" — ")[0]).Distinct()), null, Ledger.Round2(month.Sum(e => e.Amount)), accountLink));
            }
            foreach (var s in await db.IssuedStatements.AsNoTracking().Where(s => s.AccountId == account.Id).ToListAsync(ct))
                events.Add(new($"ev-statement-{s.Id}", s.IssuedAt.ToString("O"), "statement", prefix + $"{Month(s.Period)} statement issued", null, s.IssuedBy, null,
                    $"{accountLink}/statements/{s.Period}"));
        }
        foreach (var j in await db.Jobs.AsNoTracking().Where(j => j.UnitId == unit.Id).ToListAsync(ct))
            events.Add(new($"ev-job-{j.Id}", j.ReportedAt.ToString("O"), "maintenance", prefix + $"{j.Ref} · {j.Title}", $"Now {j.Stage.Replace('-', ' ')}", null, null, $"/maintenance/{j.Ref}"));
        var rels = await db.Relationships.AsNoTracking().Where(r => r.UnitId == unit.Id && (r.Type == "owner" || r.Type == "tenant")).ToListAsync(ct);
        var names = await db.People.AsNoTracking().Where(p => rels.Select(r => r.PersonId).Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => p.DisplayName, ct);
        foreach (var r in rels)
        {
            var who = names.GetValueOrDefault(r.PersonId, "Someone");
            events.Add(new($"ev-rel-{r.Id}", At(r.Since), "status", prefix + $"{who} became the {r.Type}", null, null, null, $"/people/{r.PersonId}"));
            if (r.Until is { } until)
                events.Add(new($"ev-rel-end-{r.Id}", At(until.AddDays(1)), "status", prefix + $"{who} is no longer the {r.Type}", r.EndReason, null, null, $"/people/{r.PersonId}"));
        }
        events.AddRange((await db.Notes.AsNoTracking().Where(n => n.UnitId == unit.Id).ToListAsync(ct)).Select(n => FromNote(n, prefix)));
        return events;
    }

    private static List<TimelineEventDto> Newest(IEnumerable<TimelineEventDto> events) =>
        events.GroupBy(e => e.Id).Select(g => g.First()).OrderByDescending(e => DateTimeOffset.Parse(e.At, CultureInfo.InvariantCulture)).ToList();

    private static async Task<IResult> ForUnit(Guid id, CurrentActor current, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var unit = await db.Units.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct);
        if (unit is null || !(await reads.ReadableSchemes(actor, null, ct)).Any(s => s.Id == unit.SchemeId)) return Problems.NotFound();
        return Results.Ok(Newest(await UnitEventsAsync(db, unit, "", ct)));
    }

    /// <summary>Their units' timelines (as owner), each line marked with the unit, and the notes on the person.</summary>
    private static async Task<IResult> ForPerson(Guid id, CurrentActor current, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var schemes = await reads.ReadableSchemes(actor, null, ct);
        if ((await reads.People(schemes, q => q.Where(p => p.Id == id), ct)).Count == 0) return Problems.NotFound();
        var schemeIds = schemes.Select(s => s.Id).ToList();
        var codes = schemes.ToDictionary(s => s.Id, s => s.Code);
        var unitIds = await db.Relationships.AsNoTracking().Where(r => r.PersonId == id && r.Type == "owner" && r.UnitId != null && schemeIds.Contains(r.SchemeId))
            .Select(r => r.UnitId!.Value).Distinct().ToListAsync(ct);
        var events = new List<TimelineEventDto>();
        foreach (var unit in await db.Units.AsNoTracking().Where(u => unitIds.Contains(u.Id)).ToListAsync(ct))
            events.AddRange(await UnitEventsAsync(db, unit, $"{codes.GetValueOrDefault(unit.SchemeId)} {unit.Number} · ", ct));
        events.AddRange((await db.Notes.AsNoTracking().Where(n => n.PersonId == id && n.UnitId == null).ToListAsync(ct)).Select(n => FromNote(n)));
        return Results.Ok(Newest(events));
    }

    /// <summary>Staff log a note or a call on a unit or a person (Notes.Add, within their schemes).</summary>
    private static async Task<IResult> AddNote(NewNoteRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, PortfolioReads reads, TimeProvider clock,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var schemes = await reads.ReadableSchemes(me, null, ct);
        var unit = Guid.TryParse(body.UnitId, out var u) ? await db.Units.AsNoTracking().FirstOrDefaultAsync(x => x.Id == u, ct) : null;
        if (unit is not null && !schemes.Any(s => s.Id == unit.SchemeId)) unit = null;
        var personId = Guid.TryParse(body.PersonId, out var p) && (await reads.People(schemes, q => q.Where(x => x.Id == p), ct)).Count > 0 ? p : (Guid?)null;
        if (unit is null && personId is null) return Problems.NotFound();
        var text = (body.Text ?? "").Trim();
        var kind = body.Kind == "call" ? "call" : "note";
        var id = Guid.CreateVersion7();
        return await commands.RunAsync(new CommandSpec(kind == "call" ? "Logged a call" : "Logged a note", "Notes.Add")
        {
            Resource = "Note",
            ResourceId = id.ToString(),
            SchemeId = unit?.SchemeId,
            Validate = () => text.Length == 0 ? new() { ["text"] = "Write the note." } : text.Length > MaxNote ? new() { ["text"] = $"At most {MaxNote} characters." } : [],
        }, actor =>
        {
            db.Notes.Add(new NoteRow
            {
                Id = id, OrganisationId = actor.OrganisationId ?? Guid.Empty, UnitId = unit?.Id, PersonId = personId, Kind = kind, Text = text, Author = actor.Human.Name,
                AuthorId = actor.Human.Id, At = clock.GetUtcNow(),
            });
            return Task.FromResult(Results.Created($"/api/notes/{id}", new { id = id.ToString() }));
        }, ct);
    }

    /// <summary>"I've already paid": the account holder tells the agency. It lands on the unit as a note; finance and the administrators are told.</summary>
    private static async Task<IResult> ReportPayment(Guid id, PaymentReportRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Notices notices,
        TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await AccountEndpoints.Readable(me, db, id, ct) is not { } account || me.User.PersonId != account.HolderPersonId?.ToString()) return Problems.NotFound();
        var unit = await db.Units.AsNoTracking().FirstAsync(u => u.Id == account.UnitId, ct);
        var scheme = await db.Schemes.AsNoTracking().FirstAsync(s => s.Id == account.SchemeId, ct);
        var text = (body.Text ?? "").Trim();
        return await commands.RunAsync(new CommandSpec($"Reported a payment on {account.AccountNo}", "Account.ViewOwn")
        {
            Resource = "Account",
            ResourceId = id.ToString(),
            SchemeId = account.SchemeId,
            Validate = () => text.Length < 5 ? new() { ["text"] = "Say when, how much and from which account you paid." } : text.Length > MaxNote ? new() { ["text"] = $"At most {MaxNote} characters." } : [],
        }, actor =>
        {
            db.Notes.Add(new NoteRow
            {
                Id = Guid.CreateVersion7(), OrganisationId = scheme.OrganisationId, UnitId = unit.Id, PersonId = account.HolderPersonId, Kind = "note",
                Text = $"Owner reports payment: {text}", Author = actor.Human.Name, AuthorId = actor.Human.Id, At = clock.GetUtcNow(),
            });
            var link = $"/schemes/{scheme.Id}/units/{unit.Number}";
            foreach (var role in new[] { Roles.Finance, Roles.AgencyAdmin })
                notices.ToRole(role, actor.Human.Id, $"{account.AccountNo}: owner says they’ve paid", text, link, scheme.OrganisationId, "finance");
            return Task.FromResult(Results.NoContent());
        }, ct);
    }
}
