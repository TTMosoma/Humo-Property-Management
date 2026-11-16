using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Access;

/// <summary>
/// D46: which sign-ins belong to an agency's person records. A sign-in links to one record at each agency, through its
/// membership there; a sign-in from before D46 also points at its first record directly. A record at one agency never
/// reaches a sign-in through another agency's record.
/// </summary>
public static class PersonSignIns
{
    /// <summary>Sign-in ids by person record. An invitation still waiting to be accepted links nobody, unless asked for.</summary>
    public static async Task<Dictionary<Guid, List<Guid>>> ForAsync(HumoDbContext db, IEnumerable<Guid> personIds, CancellationToken ct, bool includeInvited = false)
    {
        var ids = personIds.Distinct().ToList();
        if (ids.Count == 0) return [];
        var keys = ids.Select(i => i.ToString()).ToList();
        var viaMembership = await db.Memberships.AsNoTracking()
            .Where(m => m.PersonId != null && ids.Contains(m.PersonId.Value) && m.Status != MembershipStatuses.Ended && (includeInvited || m.Status != MembershipStatuses.Invited))
            .Select(m => new { Person = m.PersonId!.Value, m.UserId }).ToListAsync(ct);
        var direct = (await db.Users.AsNoTracking().Where(u => u.PersonId != null && keys.Contains(u.PersonId)).Select(u => new { u.PersonId, u.Id }).ToListAsync(ct))
            .Select(u => new { Person = Guid.Parse(u.PersonId!), UserId = u.Id });
        return viaMembership.Concat(direct).GroupBy(x => x.Person).ToDictionary(g => g.Key, g => g.Select(x => x.UserId).Distinct().ToList());
    }

    /// <summary>The sign-ins of one person record.</summary>
    public static async Task<List<Guid>> ForAsync(HumoDbContext db, Guid personId, CancellationToken ct, bool includeInvited = false) =>
        (await ForAsync(db, [personId], ct, includeInvited)).GetValueOrDefault(personId) ?? [];

    /// <summary>Every person record that has a sign-in (in force), e.g. to tell who can be reached in the portal.</summary>
    public static async Task<HashSet<string>> PeopleWithSignInsAsync(HumoDbContext db, CancellationToken ct, bool activeSignInsOnly = true)
    {
        var active = activeSignInsOnly ? db.Users.Where(u => u.Status == IdentityStatuses.Active) : db.Users.Where(u => u.Status != IdentityStatuses.Deactivated);
        var viaMembership = await db.Memberships.AsNoTracking()
            .Where(m => m.PersonId != null && m.Status == MembershipStatuses.Active && active.Any(u => u.Id == m.UserId)).Select(m => m.PersonId!.Value).ToListAsync(ct);
        var direct = await active.AsNoTracking().Where(u => u.PersonId != null).Select(u => u.PersonId!).ToListAsync(ct);
        return [.. viaMembership.Select(p => p.ToString()).Concat(direct)];
    }
}
