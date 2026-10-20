using Humo.Api.Commands;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Portfolio;

public sealed record UnitDto(string Id, int Version, string SchemeId, string Number, string AccountNo, string? Block, int? Floor, string Description,
    decimal SizeM2, decimal ParticipationQuota, decimal MonthlyLevy, string Occupancy, IReadOnlyList<string> ParkingBays);

public sealed record AgeingDto(decimal Current, decimal D30, decimal D60, decimal D90, decimal D120);

public sealed record AccountDto(string Id, string AccountNo, string UnitId, string SchemeId, string HolderPersonId, decimal Balance, AgeingDto Ageing,
    string Status, bool DebitOrder, string StatementBy);

public sealed record PersonDto(string Id, int Version, string FirstName, string LastName, string Kind, string DisplayName, string Initials,
    string Email, string Phone, string PreferredChannel, string? PostalAddress, string? PersonaId);

public sealed record AppointmentDto(string How, string? ResolutionRef);

public sealed record RelationshipDto(string Id, string PersonId, string Type, string SchemeId, string? UnitId, string? Portfolio, string Since,
    string? Until, AppointmentDto? Appointment, string? EndReason);

public sealed record UnitSummaryDto(UnitDto Unit, SchemeDto Scheme, IReadOnlyList<PersonDto> Owners, PersonDto? Tenant, AccountDto Account);

public sealed record RelationshipViewDto(RelationshipDto Relationship, SchemeDto Scheme, UnitDto? Unit, AccountDto? Account);

public sealed record PersonSummaryDto(PersonDto Person, IReadOnlyList<RelationshipViewDto> Relationships, decimal Balance);

public sealed record PageDto<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

/// <summary>
/// The joined read models the screens use (docs/08 §1): a unit with its scheme, owners, tenant and
/// levy account; a person with their relationships. Always limited to schemes the caller may read.
/// </summary>
public sealed class PortfolioReads(HumoDbContext db, TimeProvider clock)
{
    /// <summary>South Africa has no daylight saving: the calendar date is UTC+2.</summary>
    public DateOnly Today => DateOnly.FromDateTime(clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).DateTime);

    public bool IsCurrent(Relationship r) => r.Until is null || r.Until >= Today;

    /// <summary>The requested schemes the caller may read (a client's list only narrows; S4).</summary>
    public async Task<List<Scheme>> ReadableSchemes(Actor actor, IEnumerable<string>? requested, CancellationToken ct)
    {
        var visible = await SchemeEndpoints.Visible(actor, db).ToListAsync(ct);
        var ask = requested?.Where(s => !string.IsNullOrWhiteSpace(s)).ToHashSet();
        return ask is { Count: > 0 } ? visible.Where(s => ask.Contains(s.Id.ToString())).ToList() : visible;
    }

    public async Task<List<UnitSummaryDto>> Units(List<Scheme> schemes, Func<IQueryable<Unit>, IQueryable<Unit>>? filter, CancellationToken ct)
    {
        var ids = schemes.Select(s => s.Id).ToList();
        var query = db.Units.Where(u => ids.Contains(u.SchemeId));
        var units = await (filter is null ? query : filter(query)).ToListAsync(ct);
        return await Summaries(units, schemes, ct);
    }

    public async Task<List<UnitSummaryDto>> Summaries(List<Unit> units, List<Scheme> schemes, CancellationToken ct)
    {
        var unitIds = units.Select(u => u.Id).ToList();
        var accounts = await db.LevyAccounts.Where(a => unitIds.Contains(a.UnitId)).ToDictionaryAsync(a => a.UnitId, ct);
        var rels = await db.Relationships.Where(r => r.UnitId != null && unitIds.Contains(r.UnitId.Value)).ToListAsync(ct);
        var people = await PeopleById(rels.Select(r => r.PersonId), ct);
        var schemeDtos = (await SchemeEndpoints.ToDtos(schemes, db, ct)).ToDictionary(s => s.Id);

        return units
            .OrderBy(u => schemes.FindIndex(s => s.Id == u.SchemeId)).ThenBy(u => NumberOrder(u.Number)).ThenBy(u => u.Number)
            .Select(u =>
            {
                var current = rels.Where(r => r.UnitId == u.Id && IsCurrent(r)).ToList();
                var owners = current.Where(r => r.Type == "owner").OrderBy(r => r.Since).Select(r => people[r.PersonId]).ToList();
                var tenant = current.Where(r => r.Type == "tenant").Select(r => people[r.PersonId]).FirstOrDefault();
                return new UnitSummaryDto(ToDto(u), schemeDtos[u.SchemeId.ToString()], owners, tenant, ToDto(accounts[u.Id]));
            }).ToList();
    }

    /// <summary>People with a relationship in these schemes, with only those relationships shown.</summary>
    public async Task<List<PersonSummaryDto>> People(List<Scheme> schemes, Func<IQueryable<Person>, IQueryable<Person>>? filter, CancellationToken ct)
    {
        var ids = schemes.Select(s => s.Id).ToList();
        var personIds = db.Relationships.Where(r => ids.Contains(r.SchemeId)).Select(r => r.PersonId).Distinct();
        var query = db.People.Where(p => personIds.Contains(p.Id));
        var list = await (filter is null ? query : filter(query)).OrderBy(p => p.LastName).ThenBy(p => p.FirstName).ToListAsync(ct);
        return await PersonSummaries(list, schemes, ct);
    }

    public async Task<List<PersonSummaryDto>> PersonSummaries(List<Person> list, List<Scheme> schemes, CancellationToken ct)
    {
        var schemeIds = schemes.Select(s => s.Id).ToHashSet();
        var personIds = list.Select(p => p.Id).ToList();
        var rels = (await db.Relationships.Where(r => personIds.Contains(r.PersonId)).ToListAsync(ct)).Where(r => schemeIds.Contains(r.SchemeId)).ToList();
        var unitIds = rels.Where(r => r.UnitId != null).Select(r => r.UnitId!.Value).Distinct().ToList();
        var units = await db.Units.Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, ct);
        var accounts = await db.LevyAccounts.Where(a => unitIds.Contains(a.UnitId)).ToDictionaryAsync(a => a.UnitId, ct);
        var schemeDtos = (await SchemeEndpoints.ToDtos(schemes, db, ct)).ToDictionary(s => s.Id);
        var personas = await Personas(personIds, ct);

        return list.Select(p =>
        {
            var views = rels.Where(r => r.PersonId == p.Id).OrderBy(r => r.Since).Select(r =>
            {
                var unit = r.UnitId is { } uid && units.TryGetValue(uid, out var x) ? x : null;
                var account = unit is not null && r.Type == "owner" && accounts.TryGetValue(unit.Id, out var a) ? a : null;
                return new RelationshipViewDto(ToDto(r), schemeDtos[r.SchemeId.ToString()], unit is null ? null : ToDto(unit), account is null ? null : ToDto(account));
            }).ToList();
            var balance = views.Where(v => v.Account is not null).Sum(v => v.Account!.Balance);
            return new PersonSummaryDto(ToDto(p, personas.GetValueOrDefault(p.Id)), views, balance);
        }).ToList();
    }

    private async Task<Dictionary<Guid, PersonDto>> PeopleById(IEnumerable<Guid> ids, CancellationToken ct)
    {
        var list = ids.Distinct().ToList();
        var personas = await Personas(list, ct);
        return (await db.People.Where(p => list.Contains(p.Id)).ToListAsync(ct)).ToDictionary(p => p.Id, p => ToDto(p, personas.GetValueOrDefault(p.Id)));
    }

    /// <summary>People who have a Humo sign-in (invited or active), by their People record.</summary>
    private async Task<Dictionary<Guid, string>> Personas(List<Guid> personIds, CancellationToken ct)
    {
        var keys = personIds.Select(id => id.ToString()).ToList();
        return (await db.Users.Where(u => u.PersonId != null && keys.Contains(u.PersonId)).Select(u => new { u.PersonId, u.Id }).ToListAsync(ct))
            .GroupBy(x => Guid.Parse(x.PersonId!)).ToDictionary(g => g.Key, g => g.First().Id.ToString());
    }

    public static PageDto<T> Page<T>(List<T> items, int? page, int? pageSize)
    {
        var p = Math.Max(1, page ?? 1);
        var size = pageSize is > 0 ? pageSize.Value : items.Count;
        return new PageDto<T>(pageSize is > 0 ? items.Skip((p - 1) * size).Take(size).ToList() : items, items.Count, p, size);
    }

    private static int NumberOrder(string number) => int.TryParse(new string(number.TakeWhile(char.IsDigit).ToArray()), out var n) ? n : int.MaxValue;

    public static UnitDto ToDto(Unit u) => new(u.Id.ToString(), u.Version, u.SchemeId.ToString(), u.Number, u.AccountNo, u.Block, u.Floor, u.Description,
        u.SizeM2, u.ParticipationQuota, u.MonthlyLevy, u.Occupancy, u.ParkingBays);

    public static AccountDto ToDto(LevyAccount a) => new(a.Id.ToString(), a.AccountNo, a.UnitId.ToString(), a.SchemeId.ToString(), a.HolderPersonId?.ToString() ?? "",
        a.Balance, new AgeingDto(a.AgeingCurrent, a.AgeingD30, a.AgeingD60, a.AgeingD90, a.AgeingD120), a.Status, a.DebitOrder, a.StatementBy);

    public static PersonDto ToDto(Person p, string? personaId = null) => new(p.Id.ToString(), p.Version, p.FirstName, p.LastName, p.Kind, p.DisplayName, p.Initials,
        p.Email, p.Phone, p.PreferredChannel, p.PostalAddress, personaId);

    public static RelationshipDto ToDto(Relationship r) => new(r.Id.ToString(), r.PersonId.ToString(), r.Type, r.SchemeId.ToString(), r.UnitId?.ToString(), r.Portfolio,
        r.Since.ToString("yyyy-MM-dd"), r.Until?.ToString("yyyy-MM-dd"), r.AppointmentHow is null ? null : new AppointmentDto(r.AppointmentHow, r.ResolutionRef), r.EndReason);
}
