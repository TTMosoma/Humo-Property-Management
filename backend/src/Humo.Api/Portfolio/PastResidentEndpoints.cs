using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Finance;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Portfolio;

public sealed record AgencyContactDto(string Name, string? Email, string? Phone);

public sealed record PastHomeDto(string Scheme, string? Unit, string Type, string Since, string? Until);

public sealed record PastStatementDto(string Id, string Period, string PeriodLabel, string AccountNo, string Scheme, string Unit, string IssuedOn);

public sealed record PastResidentDto(AgencyContactDto Agency, List<PastHomeDto> Homes, List<PastStatementDto> Statements);

/// <summary>
/// D33: someone with no property left at this agency. They see who to contact, what they used to hold, and the statements
/// addressed to them, read-only (Statements.ViewPast). A statement addressed to anyone else is "not found".
/// </summary>
public static class PastResidentEndpoints
{
    private const string Permission = "Statements.ViewPast";

    public static void MapPastResident(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/me/past-resident").RequireAuthorization();
        g.MapGet("", View);
        g.MapGet("/statements/{id:guid}/pdf", Pdf);
    }

    /// <summary>The person's record at this agency: a person belongs to one agency, and a sign-in can span several.</summary>
    private static async Task<(Guid Organisation, Guid Person)?> WhoAsync(Actor actor, HumoDbContext db, CancellationToken ct)
    {
        if (!actor.Can(Permission) || actor.OrganisationId is not { } org || !Guid.TryParse(actor.User.PersonId, out var person)) return null;
        return await db.People.AnyAsync(p => p.Id == person && p.OrganisationId == org, ct) ? (org, person) : null;
    }

    private static async Task<List<(IssuedStatement Issued, StatementSnapshot Snapshot)>> StatementsAsync(Guid organisation, Guid person, HumoDbContext db, CancellationToken ct)
    {
        var units = await db.Relationships.Where(r => r.PersonId == person && r.Type == "owner" && r.UnitId != null).Select(r => r.UnitId!.Value).ToListAsync(ct);
        var accounts = await db.LevyAccounts.Where(a => units.Contains(a.UnitId)).Select(a => a.Id).ToListAsync(ct);
        var issued = await db.IssuedStatements.AsNoTracking().Where(s => s.OrganisationId == organisation && accounts.Contains(s.AccountId)).ToListAsync(ct);
        return [.. issued
            .Select(s => (Issued: s, Snapshot: JsonSerializer.Deserialize<StatementSnapshot>(s.Snapshot, Json.Options)!))
            .Where(x => x.Snapshot.View.Holder.Id == person.ToString())
            .OrderByDescending(x => x.Issued.Period)];
    }

    private static async Task<IResult> View(CurrentActor current, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await WhoAsync(actor, db, ct) is not { } who) return Problems.Policy("forbidden", "Role does not have this permission");

        var organisation = await db.Organisations.FirstAsync(o => o.Id == who.Organisation, ct);
        var contact = await db.DocumentSettings.AsNoTracking().FirstOrDefaultAsync(s => s.OrganisationId == who.Organisation, ct);
        var ended = (await db.Relationships.AsNoTracking().Where(r => r.PersonId == who.Person).ToListAsync(ct)).Where(r => !reads.IsCurrent(r)).OrderByDescending(r => r.Until).ToList();
        var schemeIds = ended.Select(r => r.SchemeId).Distinct().ToList();
        var schemes = await db.Schemes.Where(s => schemeIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name, ct);
        var unitIds = ended.Where(r => r.UnitId != null).Select(r => r.UnitId!.Value).Distinct().ToList();
        var units = await db.Units.Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Number, ct);

        return Results.Ok(new PastResidentDto(
            new AgencyContactDto(organisation.Name, string.IsNullOrWhiteSpace(contact?.ContactEmail) ? null : contact.ContactEmail, string.IsNullOrWhiteSpace(contact?.ContactPhone) ? null : contact.ContactPhone),
            [.. ended.Select(r => new PastHomeDto(schemes.GetValueOrDefault(r.SchemeId, ""), r.UnitId is { } u ? units.GetValueOrDefault(u) : null, r.Type, r.Since.ToString("yyyy-MM-dd"), r.Until?.ToString("yyyy-MM-dd")))],
            [.. (await StatementsAsync(who.Organisation, who.Person, db, ct)).Select(x => new PastStatementDto(x.Issued.Id.ToString(), x.Issued.Period, x.Snapshot.View.Statement.PeriodLabel,
                x.Snapshot.View.Account.AccountNo, x.Snapshot.View.Scheme.Name, x.Snapshot.View.Unit.Number, x.Issued.IssuedAt.ToString("O")))]));
    }

    private static async Task<IResult> Pdf(Guid id, CurrentActor current, HumoDbContext db, StatementService statements, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await WhoAsync(actor, db, ct) is not { } who) return Problems.NotFound();
        var own = (await StatementsAsync(who.Organisation, who.Person, db, ct)).FirstOrDefault(x => x.Issued.Id == id);
        if (own.Issued is null) return Problems.NotFound();
        return Results.File(await statements.PdfAsync(own.Issued, ct), "application/pdf", $"{own.Snapshot.View.Account.AccountNo}-{own.Issued.Period}.pdf");
    }
}
