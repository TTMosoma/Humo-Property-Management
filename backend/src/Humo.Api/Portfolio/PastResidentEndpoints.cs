using System.Globalization;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Finance;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Portfolio;

public sealed record AgencyContactDto(string Name, string? Email, string? Phone);

public sealed record PastHomeDto(string Scheme, string? Unit, string Type, string Since, string? Until);

/// <summary>A month they owned. <c>Id</c> and <c>IssuedOn</c> are set when a statement was issued to them for it.</summary>
public sealed record PastStatementDto(string? Id, string AccountId, string Period, string PeriodLabel, string AccountNo, string Scheme, string Unit, string? IssuedOn);

public sealed record PastResidentDto(AgencyContactDto Agency, List<PastHomeDto> Homes, List<PastStatementDto> Statements);

/// <summary>
/// D33: someone with no property left at this agency. They see who to contact, what they used to hold, and their
/// statements, read-only (Statements.ViewPast). D35: every month they owned, issued or not; any other month is "not found".
/// </summary>
public static class PastResidentEndpoints
{
    private const string Permission = "Statements.ViewPast";

    public static void MapPastResident(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/me/past-resident").RequireAuthorization();
        g.MapGet("", View);
        g.MapGet("/statements/{id:guid}/pdf", Pdf);
        g.MapGet("/accounts/{accountId:guid}/statements/{period}/pdf", MonthPdf);
    }

    /// <summary>The person's record at this agency: a person belongs to one agency, and a sign-in can span several.</summary>
    private static async Task<(Guid Organisation, Guid Person)?> WhoAsync(Actor actor, HumoDbContext db, CancellationToken ct)
    {
        if (!actor.Can(Permission) || actor.OrganisationId is not { } org || !Guid.TryParse(actor.User.PersonId, out var person)) return null;
        return await db.People.AnyAsync(p => p.Id == person && p.OrganisationId == org, ct) ? (org, person) : null;
    }

    private sealed record Month(LevyAccount Account, string Period, IssuedStatement? Issued, string Scheme, string Unit);

    /// <summary>The months with activity on a unit they owned, whose statement belongs to them (D35), newest first.</summary>
    private static async Task<List<Month>> MonthsAsync(Guid organisation, Guid person, HumoDbContext db, PortfolioReads reads, StatementService statements, CancellationToken ct)
    {
        var owned = await db.Relationships.AsNoTracking().Where(r => r.PersonId == person && r.Type == "owner" && r.UnitId != null).ToListAsync(ct);
        var unitIds = owned.Select(r => r.UnitId!.Value).Distinct().ToList();
        var accounts = await db.LevyAccounts.Where(a => unitIds.Contains(a.UnitId)).ToListAsync(ct);
        var accountIds = accounts.Select(a => a.Id).ToList();
        var units = await db.Units.Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, ct);
        var schemeIds = units.Values.Select(u => u.SchemeId).Distinct().ToList();
        var schemes = await db.Schemes.Where(s => schemeIds.Contains(s.Id) && s.OrganisationId == organisation).ToDictionaryAsync(s => s.Id, s => s.Name, ct);
        var lines = await db.Ledger.AsNoTracking().Where(e => accountIds.Contains(e.AccountId)).Select(e => new { e.AccountId, e.Date }).ToListAsync(ct);
        var issued = (await db.IssuedStatements.AsNoTracking().Where(s => s.OrganisationId == organisation && accountIds.Contains(s.AccountId)).ToListAsync(ct))
            .Where(s => JsonSerializer.Deserialize<StatementSnapshot>(s.Snapshot, Json.Options)!.View.Holder.Id == person.ToString()).ToList();
        var months = new List<Month>();
        foreach (var account in accounts.Where(a => units.ContainsKey(a.UnitId) && schemes.ContainsKey(units[a.UnitId].SchemeId)))
        {
            var spans = owned.Where(r => r.UnitId == account.UnitId).ToList();
            var periods = lines.Where(l => l.AccountId == account.Id && spans.Any(r => l.Date >= r.Since && (r.Until is null || l.Date <= r.Until)))
                .Select(l => l.Date.ToString("yyyy-MM", CultureInfo.InvariantCulture))
                .Concat(issued.Where(s => s.AccountId == account.Id).Select(s => s.Period)).Distinct();
            foreach (var period in periods)
            {
                if (await statements.AddressedToAsync(account, period, ct) != person) continue;
                // What was sent to them: the current one, or the latest that a later one replaced.
                var sent = issued.Where(s => s.AccountId == account.Id && s.Period == period).OrderBy(s => s.ReplacedAt is null ? 0 : 1).ThenByDescending(s => s.IssuedAt).FirstOrDefault();
                var unit = units[account.UnitId];
                months.Add(new Month(account, period, sent, schemes[unit.SchemeId], unit.Number));
            }
        }
        return [.. months.OrderByDescending(m => m.Period).ThenBy(m => m.Unit)];
    }

    private static async Task<IResult> View(CurrentActor current, HumoDbContext db, PortfolioReads reads, StatementService statements, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await WhoAsync(actor, db, ct) is not { } who) return Problems.Policy("forbidden", "Role does not have this permission");

        var organisation = await db.Organisations.FirstAsync(o => o.Id == who.Organisation, ct);
        var contact = await db.DocumentSettings.AsNoTracking().FirstOrDefaultAsync(s => s.OrganisationId == who.Organisation, ct);
        var ended = (await db.Relationships.AsNoTracking().Where(r => r.PersonId == who.Person).ToListAsync(ct)).Where(r => !reads.IsCurrent(r) && r.Since <= reads.Today).OrderByDescending(r => r.Until).ToList();
        var schemeIds = ended.Select(r => r.SchemeId).Distinct().ToList();
        var schemes = await db.Schemes.Where(s => schemeIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name, ct);
        var unitIds = ended.Where(r => r.UnitId != null).Select(r => r.UnitId!.Value).Distinct().ToList();
        var units = await db.Units.Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Number, ct);

        return Results.Ok(new PastResidentDto(
            new AgencyContactDto(organisation.Name, string.IsNullOrWhiteSpace(contact?.ContactEmail) ? null : contact.ContactEmail, string.IsNullOrWhiteSpace(contact?.ContactPhone) ? null : contact.ContactPhone),
            [.. ended.Select(r => new PastHomeDto(schemes.GetValueOrDefault(r.SchemeId, ""), r.UnitId is { } u ? units.GetValueOrDefault(u) : null, r.Type, r.Since.ToString("yyyy-MM-dd"), r.Until?.ToString("yyyy-MM-dd")))],
            [.. (await MonthsAsync(who.Organisation, who.Person, db, reads, statements, ct)).Select(m => new PastStatementDto(m.Issued?.Id.ToString(), m.Account.Id.ToString(), m.Period,
                StatementService.PeriodLabel(m.Period), m.Account.AccountNo, m.Scheme, m.Unit, m.Issued?.IssuedAt.ToString("O")))]));
    }

    private static async Task<IResult> Pdf(Guid id, CurrentActor current, HumoDbContext db, PortfolioReads reads, StatementService statements, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await WhoAsync(actor, db, ct) is not { } who) return Problems.NotFound();
        var month = (await MonthsAsync(who.Organisation, who.Person, db, reads, statements, ct)).FirstOrDefault(m => m.Issued?.Id == id);
        if (month?.Issued is not { } issued) return Problems.NotFound();
        var tracked = await db.IssuedStatements.FirstAsync(s => s.Id == issued.Id, ct);
        return Results.File(await statements.PdfAsync(tracked, ct), "application/pdf", $"{month.Account.AccountNo}-{month.Period}.pdf");
    }

    /// <summary>
    /// A month of theirs that was never issued (e.g. the statement for it went to the buyer before D35): it's issued now,
    /// addressed to them, and kept like any issued statement (D7).
    /// </summary>
    private static async Task<IResult> MonthPdf(Guid accountId, string period, CurrentActor current, HumoDbContext db, PortfolioReads reads, StatementService statements, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await WhoAsync(actor, db, ct) is not { } who) return Problems.NotFound();
        var month = (await MonthsAsync(who.Organisation, who.Person, db, reads, statements, ct)).FirstOrDefault(m => m.Account.Id == accountId && m.Period == period);
        if (month is null) return Problems.NotFound();
        if (month.Issued is { ReplacedAt: null } sent) return Results.File(await statements.PdfAsync(await db.IssuedStatements.FirstAsync(s => s.Id == sent.Id, ct), ct), "application/pdf", $"{month.Account.AccountNo}-{period}.pdf");
        await statements.ReplaceForNewHolderAsync(month.Account, period, "Humo Property Management", ct);
        if (await statements.IssueAsync(month.Account, period, $"{actor.User.Name}, who owned the unit that month", null, ct) is not { } issued) return Problems.NotFound();
        await db.SaveChangesAsync(ct);
        return Results.File(await statements.PdfAsync(issued, ct), "application/pdf", $"{month.Account.AccountNo}-{period}.pdf");
    }
}
