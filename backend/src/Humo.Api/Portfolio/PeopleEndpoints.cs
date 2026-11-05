using System.Text.RegularExpressions;
using Humo.Api.Commands;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Portfolio;

public sealed record PersonDetailsRequest(string FirstName, string LastName, string Kind, string? Email, string? Phone, string PreferredChannel, string? PostalAddress, int? ExpectedVersion);
/// <param name="Ownership">When the unit already has an owner: "joint" (they own it together) or "replaces" (sold or transferred:
/// the current owners' ownership ends the day before, and the new owner holds the account).</param>
public sealed record NewRelationshipRequest(string Type, string SchemeId, string? UnitId, string? Portfolio, string Since, string? Until, string? Ownership = null);
public sealed record CreatePersonRequest(PersonDetailsRequest Details, NewRelationshipRequest? Link);
/// <param name="EndedOn">The day it ended (the sale or move-out date): they're no longer on the unit from that day.
/// <paramref name="Until"/> is the last day instead, kept for callers that send it.</param>
public sealed record EndRelationshipRequest(string? Until, string? EndedOn = null);
/// <param name="Until">A tenant's lease end (their last day), or an ended role's last day.</param>
public sealed record UpdateRelationshipRequest(string Since, string? Until);
public sealed record RemoveRelationshipRequest(string? Reason);

/// <summary>
/// The people directory and their relationships (doc 24 §6). Owner and tenant only:
/// trustees come from the board (D2). Nothing is deleted: relationships end on a date.
/// </summary>
public static partial class PeopleEndpoints
{
    private static readonly string[] Kinds = ["individual", "company", "trust"];

    public static void MapPeople(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("").RequireAuthorization();
        g.MapGet("/people", List);
        g.MapGet("/people/search", Search);
        g.MapGet("/people/{id:guid}", Get);
        g.MapPost("/people", Create);
        g.MapPut("/people/{id:guid}", Update);
        g.MapPost("/people/{id:guid}/relationships", AddRelationship);
        g.MapPost("/relationships/{id:guid}/end", EndRelationship);
        g.MapPut("/relationships/{id:guid}", UpdateRelationship);
        g.MapPost("/relationships/{id:guid}/delete", RemoveRelationship);
    }

    private static async Task<IResult> List(string[]? schemeIds, int? page, int? pageSize, CurrentActor current, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        return Results.Ok(PortfolioReads.Page(await reads.People(await reads.ReadableSchemes(actor, schemeIds, ct), null, ct), page, pageSize));
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var found = await reads.People(await reads.ReadableSchemes(actor, null, ct), q => q.Where(p => p.Id == id), ct);
        return found.Count == 0 ? Problems.NotFound() : Results.Ok(found[0]);
    }

    /// <summary>By name or email (every word), or by at least 4 digits of the phone number.</summary>
    private static async Task<IResult> Search(string? q, string[]? schemeIds, int? limit, CurrentActor current, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var query = (q ?? "").Trim().ToLowerInvariant();
        if (query.Length < 2) return Results.Ok(Array.Empty<PersonSummaryDto>());
        var digits = NonDigits().Replace(query, "");
        var tokens = query.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var all = await reads.People(await reads.ReadableSchemes(actor, schemeIds, ct), null, ct);
        var hits = all.Where(s =>
        {
            var p = s.Person;
            var hay = $"{p.DisplayName} {p.FirstName} {p.LastName} {p.Email}".ToLowerInvariant();
            return tokens.All(hay.Contains) || (digits.Length >= 4 && NonDigits().Replace(p.Phone, "").Contains(digits));
        });
        return Results.Ok(hits.Take(limit ?? 8));
    }

    private static async Task<IResult> Create(CreatePersonRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, PortfolioReads reads, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var d = body.Details;
        var link = body.Link;
        var linkScheme = link is not null && Guid.TryParse(link.SchemeId, out var linkSchemeId) ? await SchemeEndpoints.Visible(actor, db).FirstOrDefaultAsync(s => s.Id == linkSchemeId, ct) : null;
        var emailTaken = await EmailOwner(db, actor.OrganisationId, d.Email, null, ct);
        var linkErrors = link is null ? [] : await CheckLink(db, reads, link, linkScheme, null, ct);
        var id = Guid.CreateVersion7();

        return await commands.RunAsync(new CommandSpec($"Added {d.FirstName?.Trim()} {d.LastName?.Trim()}{(link is null ? "" : $" as {link.Type}")}", "People.Manage")
        {
            Resource = "Person",
            ResourceId = id.ToString(),
            SchemeId = linkScheme?.Id,
            Validate = () => actor.OrganisationId is null
                ? new() { ["lastName"] = "People belong to a customer's directory: work in their organisation to add someone." }
                : new[] { CheckPerson(d, emailTaken), linkErrors }.SelectMany(x => x).GroupBy(x => x.Key).ToDictionary(g => g.Key, g => g.First().Value),
        }, async _ =>
        {
            var person = new Person { Id = id, OrganisationId = actor.OrganisationId!.Value, CreatedAt = clock.GetUtcNow() };
            Apply(person, d);
            db.People.Add(person);
            // Bought from someone: the seller's access ends now, not at the next minute's sweep.
            if (link is not null)
                foreach (var previous in Link(db, person.Id, link)) await SyncResidentAccessAsync(db, reads, previous, actor.Human.Name, ct);
            return Results.Created($"/api/people/{id}", new { id = id.ToString() });
        }, ct);
    }

    private static async Task<IResult> Update(Guid id, PersonDetailsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var visible = await reads.People(await reads.ReadableSchemes(actor, null, ct), q => q.Where(p => p.Id == id), ct);
        var person = visible.Count == 0 ? null : await db.People.FirstAsync(p => p.Id == id, ct);
        if (person is null) return Problems.NotFound();
        var emailTaken = await EmailOwner(db, person.OrganisationId, body.Email, id, ct);

        return await commands.RunAsync(new CommandSpec($"Updated contact details for {body.FirstName?.Trim()} {body.LastName?.Trim()}", "People.Manage")
        {
            Resource = "Person",
            ResourceId = id.ToString(),
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = person.Version,
            Validate = () => CheckPerson(body, emailTaken),
        }, _ =>
        {
            Apply(person, body);
            person.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> AddRelationship(Guid id, NewRelationshipRequest link, CurrentActor current, CommandRunner commands, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var person = await db.People.FirstOrDefaultAsync(p => p.Id == id && p.OrganisationId == actor.OrganisationId, ct);
        if (person is null) return Problems.NotFound();
        var scheme = Guid.TryParse(link.SchemeId, out var schemeId) ? await SchemeEndpoints.Visible(actor, db).FirstOrDefaultAsync(s => s.Id == schemeId, ct) : null;
        var errors = await CheckLink(db, reads, link, scheme, id, ct);
        var unitNo = Guid.TryParse(link.UnitId, out var uid) ? await db.Units.Where(u => u.Id == uid).Select(u => u.AccountNo).FirstOrDefaultAsync(ct) : null;

        return await commands.RunAsync(new CommandSpec($"Linked {person.DisplayName} as {link.Type}{(unitNo is null ? "" : $" of {unitNo}")}", "People.Manage")
        {
            Resource = "Relationship",
            ResourceId = id.ToString(),
            SchemeId = scheme?.Id,
            Validate = () => errors,
        }, async actor =>
        {
            var replaced = Link(db, id, link);
            await SyncResidentAccessAsync(db, reads, id, actor.Human.Name, ct);
            foreach (var previous in replaced) await SyncResidentAccessAsync(db, reads, previous, actor.Human.Name, ct);
            return Results.NoContent();
        }, ct);
    }

    private static async Task<IResult> EndRelationship(Guid id, EndRelationshipRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, PortfolioReads reads,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var rel = await db.Relationships.FirstOrDefaultAsync(r => r.Id == id, ct);
        var scheme = rel is null ? null : await SchemeEndpoints.Visible(actor, db).FirstOrDefaultAsync(s => s.Id == rel.SchemeId, ct);
        if (rel is null || scheme is null) return Problems.NotFound();
        var person = await db.People.FirstAsync(p => p.Id == rel.PersonId, ct);
        // "Ended on" is the first day they're no longer on the unit, so ending today takes effect today.
        var endedOn = ParseDate(body.EndedOn);
        var until = endedOn?.AddDays(-1) ?? ParseDate(body.Until);
        var ended = rel.Until is { } u && u < reads.Today;

        return await commands.RunAsync(new CommandSpec($"Ended {rel.Type} of {person.DisplayName}: last day {until:d MMMM yyyy}", "People.Manage")
        {
            Resource = "Relationship",
            ResourceId = id.ToString(),
            SchemeId = rel.SchemeId,
            Validate = () => ended ? new() { ["endedOn"] = "It has already ended." }
                : endedOn is { } e && e <= rel.Since ? new() { ["endedOn"] = $"It started on {rel.Since:d MMMM yyyy}: choose a later day. Added by mistake? Remove it instead." }
                : until is null || until < rel.Since ? new() { [body.EndedOn is null ? "until" : "endedOn"] = "Choose a date after it started." } : [],
        }, async _ =>
        {
            rel.Until = until;
            await HandOverAccountAsync(db, reads, rel, ct);
            await SyncResidentAccessAsync(db, reads, rel.PersonId, actor.Human.Name, ct);
            return Results.NoContent();
        }, ct);
    }

    /// <summary>Corrects an owner's or tenant's dates: when it started, and a tenant's lease end (or an ended role's last day).</summary>
    private static async Task<IResult> UpdateRelationship(Guid id, UpdateRelationshipRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var rel = await db.Relationships.FirstOrDefaultAsync(r => r.Id == id, ct);
        var scheme = rel is null ? null : await SchemeEndpoints.Visible(actor, db).FirstOrDefaultAsync(s => s.Id == rel.SchemeId, ct);
        if (rel is null || scheme is null) return Problems.NotFound();
        var person = await db.People.FirstAsync(p => p.Id == rel.PersonId, ct);
        var since = ParseDate(body.Since);
        var until = ParseDate(body.Until);

        return await commands.RunAsync(new CommandSpec($"Corrected the dates of {person.DisplayName} as {rel.Type}: from {since:d MMMM yyyy}{(until is null ? "" : $" to {until:d MMMM yyyy}")}", "People.Manage")
        {
            Resource = "Relationship",
            ResourceId = id.ToString(),
            SchemeId = rel.SchemeId,
            Validate = () => rel.Type is not ("owner" or "tenant") ? new() { ["type"] = "Trustees’ terms are kept on the scheme’s board." }
                : since is null ? new() { ["since"] = "Choose the date it started." }
                : until is { } x && x < since ? new() { ["until"] = "Choose a date on or after it started." }
                : rel.Type == "owner" && rel.Until is null && until is not null ? new() { ["until"] = "To end an ownership, use End (sold or transferred)." } : [],
        }, _ =>
        {
            rel.Since = since!.Value;
            rel.Until = until;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>
    /// Removes an owner or tenant added by mistake: never a role anything was sent under. Once a statement, letter or invoice
    /// has gone out for the unit while they were on it, or they sign in to its portal, it's ended instead, so the history stays.
    /// </summary>
    private static async Task<IResult> RemoveRelationship(Guid id, RemoveRelationshipRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db,
        PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var rel = await db.Relationships.FirstOrDefaultAsync(r => r.Id == id, ct);
        var scheme = rel is null ? null : await SchemeEndpoints.Visible(actor, db).FirstOrDefaultAsync(s => s.Id == rel.SchemeId, ct);
        if (rel is null || scheme is null) return Problems.NotFound();
        var person = await db.People.FirstAsync(p => p.Id == rel.PersonId, ct);
        var history = rel.UnitId is { } unitId ? await RoleHistoryAsync(db, rel, unitId, ct) : null;

        return await commands.RunAsync(new CommandSpec($"Removed {person.DisplayName} as {rel.Type}, added by mistake — {body.Reason?.Trim()}", "People.Manage")
        {
            Resource = "Relationship",
            ResourceId = id.ToString(),
            SchemeId = rel.SchemeId,
            Validate = () => rel.Type is not ("owner" or "tenant") ? new() { ["type"] = "Trustees are removed on the scheme’s board." }
                : history is not null ? new() { ["relationship"] = history }
                : (body.Reason ?? "").Trim().Length < 5 ? new() { ["reason"] = PortfolioRules.ReasonMessage } : [],
        }, async _ =>
        {
            db.Relationships.Remove(rel);
            rel.Until = DateOnly.MinValue;
            await HandOverAccountAsync(db, reads, rel, ct, removed: true);
            await SyncResidentAccessAsync(db, reads, rel.PersonId, actor.Human.Name, ct);
            return Results.NoContent();
        }, ct);
    }

    /// <summary>Why this role must be ended rather than removed, or null.</summary>
    private static async Task<string?> RoleHistoryAsync(HumoDbContext db, Relationship rel, Guid unitId, CancellationToken ct)
    {
        var account = await db.LevyAccounts.AsNoTracking().Where(a => a.UnitId == unitId).Select(a => (Guid?)a.Id).FirstOrDefaultAsync(ct) ?? Guid.Empty;
        var from = new DateTimeOffset(rel.Since.ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(2));
        var sent = (await db.IssuedStatements.Where(s => s.AccountId == account).Select(s => s.IssuedAt).ToListAsync(ct)).Any(t => t >= from)
            || (await db.IssuedLetters.Where(l => l.AccountId == account).Select(l => l.IssuedAt).ToListAsync(ct)).Any(t => t >= from)
            || (await db.OwnerInvoices.Where(i => i.AccountId == account).Select(i => i.Date).ToListAsync(ct)).Any(d => d >= rel.Since);
        if (sent) return "Statements, letters or invoices have gone out for this unit since they joined it, so the record stays. Use End instead (sold, transferred or moved out).";
        var signsIn = await db.Users.Where(u => u.PersonId == rel.PersonId.ToString()).Select(u => u.Id).ToListAsync(ct);
        if (signsIn.Count > 0 && await db.RoleAssignments.AnyAsync(a => signsIn.Contains(a.UserId) && a.UnitId == unitId.ToString() && a.Status == Humo.Domain.Access.AssignmentStatuses.Active, ct))
            return "They sign in to this unit’s portal. Use End instead, which also ends their access.";
        return null;
    }

    /// <summary>
    /// When the account holder stops owning the unit, another current owner holds the account. A link removed as a
    /// mistake was never true, so with no other owner the account has no holder (rather than the wrong one).
    /// </summary>
    private static async Task HandOverAccountAsync(HumoDbContext db, PortfolioReads reads, Relationship ended, CancellationToken ct, bool removed = false)
    {
        if (ended.Type != "owner" || ended.UnitId is not { } unitId || (ended.Until is { } u && u >= reads.Today)) return;
        var account = await db.LevyAccounts.FirstOrDefaultAsync(a => a.UnitId == unitId, ct);
        if (account is null || account.HolderPersonId != ended.PersonId) return;
        var next = (await db.Relationships.Where(r => r.UnitId == unitId && r.Type == "owner" && r.Id != ended.Id).ToListAsync(ct)).Where(reads.IsCurrent).OrderBy(r => r.Since).FirstOrDefault();
        if (next is not null) account.HolderPersonId = next.PersonId;
        else if (removed) account.HolderPersonId = null;
    }

    /// <summary>
    /// Portal access follows the record: someone who signs in gets access to each unit they own or rent now and each board
    /// they sit on (D2), whichever came first, and loses it once they're no longer on it. Only for people who already sign
    /// in; inviting someone new stays a separate step.
    /// </summary>
    public static async Task SyncResidentAccessAsync(HumoDbContext db, PortfolioReads reads, Guid personId, string by, CancellationToken ct)
    {
        var key = personId.ToString();
        var users = await db.Users.Include(u => u.Assignments).Include(u => u.Memberships)
            .Where(u => u.PersonId == key && u.Kind == IdentityKinds.Customer && u.Status != IdentityStatuses.Deactivated).ToListAsync(ct);
        if (users.Count == 0) return;
        // As this change leaves them: added and changed links count, removed ones don't.
        var current = (await db.Relationships.Where(r => r.PersonId == personId && (r.Type == "owner" || r.Type == "tenant" || r.Type == "trustee")).ToListAsync(ct))
            .Concat(db.Relationships.Local.Where(r => r.PersonId == personId && (r.Type == "owner" || r.Type == "tenant" || r.Type == "trustee")))
            .Distinct().Where(r => db.Entry(r).State != EntityState.Deleted).Where(reads.IsCurrent).ToList();
        var rels = current.Where(r => r.Type != "trustee" && r.UnitId != null).ToList();
        var seats = current.Where(r => r.Type == "trustee").ToList();
        var unitIds = rels.Select(r => r.UnitId!.Value).Distinct().ToList();
        var units = await db.Units.Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, ct);
        var schemeIds = units.Values.Select(u => u.SchemeId).Concat(seats.Select(r => r.SchemeId)).Distinct().ToList();
        var schemes = await db.Schemes.Where(s => schemeIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, ct);
        // Someone can work at another agency under the same sign-in: this record only speaks for its own.
        var organisation = await db.People.Where(p => p.Id == personId).Select(p => p.OrganisationId).FirstOrDefaultAsync(ct);
        var now = DateTimeOffset.UtcNow;
        foreach (var user in users)
        {
            foreach (var r in rels.Where(r => units.ContainsKey(r.UnitId!.Value)))
            {
                var unitId = r.UnitId!.Value.ToString();
                if (user.Assignments.Any(a => a.Role == r.Type && a.UnitId == unitId && a.Status == AssignmentStatuses.Active)) continue;
                var unit = units[r.UnitId!.Value];
                var scheme = schemes[unit.SchemeId];
                if (!user.Memberships.Any(m => m.OrganisationId == scheme.OrganisationId && m.Status != MembershipStatuses.Ended))
                    db.Memberships.Add(new Membership { Id = Guid.CreateVersion7(), UserId = user.Id, OrganisationId = scheme.OrganisationId, Since = now });
                db.RoleAssignments.Add(new RoleAssignment
                {
                    Id = Guid.CreateVersion7(), UserId = user.Id, Role = r.Type, ScopeType = ScopeTypes.Unit, OrganisationId = scheme.OrganisationId, SchemeIds = [scheme.Id.ToString()],
                    UnitId = unitId, Label = $"{scheme.Name} · Unit {unit.Number}", GrantedBy = $"{by} ({r.Type} of the unit)", GrantedAt = now,
                });
            }
            foreach (var a in user.Assignments.Where(a => a.Status == AssignmentStatuses.Active && a.ScopeType == ScopeTypes.Unit && a.Role is Roles.Owner or Roles.Tenant))
            {
                if (rels.Any(r => r.Type == a.Role && r.UnitId?.ToString() == a.UnitId)) continue;
                a.Status = AssignmentStatuses.Ended;
                a.EndedBy = $"{by} (no longer {(a.Role == Roles.Owner ? "an owner" : "a tenant")} of the unit)";
                a.EndedAt = now;
                a.Version++;
            }
            foreach (var seat in seats.Where(r => schemes.ContainsKey(r.SchemeId)))
            {
                var scheme = schemes[seat.SchemeId];
                if (user.Assignments.Any(a => a.Role == Roles.Trustee && a.Status == AssignmentStatuses.Active && a.SchemeIds.Contains(scheme.Id.ToString()))) continue;
                if (!user.Memberships.Any(m => m.OrganisationId == scheme.OrganisationId && m.Status != MembershipStatuses.Ended))
                    db.Memberships.Add(new Membership { Id = Guid.CreateVersion7(), UserId = user.Id, OrganisationId = scheme.OrganisationId, Since = now });
                db.RoleAssignments.Add(new RoleAssignment
                {
                    Id = Guid.CreateVersion7(), UserId = user.Id, Role = Roles.Trustee, ScopeType = ScopeTypes.Schemes, OrganisationId = scheme.OrganisationId, SchemeIds = [scheme.Id.ToString()],
                    Label = $"{scheme.Name} · {seat.Portfolio ?? "Trustee"}", GrantedBy = $"{by} (board appointment)", GrantedAt = now,
                });
            }
            foreach (var a in user.Assignments.Where(a => a.Status == AssignmentStatuses.Active && a.Role == Roles.Trustee && a.OrganisationId == organisation).ToList())
            {
                var kept = a.SchemeIds.Where(s => seats.Any(r => r.SchemeId.ToString() == s)).ToList();
                if (kept.Count == a.SchemeIds.Count) continue;
                a.Version++;
                if (kept.Count > 0)
                {
                    a.SchemeIds = kept;
                    continue;
                }
                a.Status = AssignmentStatuses.Ended;
                a.EndedBy = $"{by} (left the board)";
                a.EndedAt = now;
            }
            // D33: nothing left at this agency, so they keep a way in: who to contact and their past statements.
            // Once only: if an administrator ends it, it stays ended.
            var here = user.Assignments.Concat(db.RoleAssignments.Local.Where(a => a.UserId == user.Id)).Distinct().Where(a => a.OrganisationId == organisation).ToList();
            if (organisation != default && here.All(a => a.Role != Roles.PastResident && a.Status != AssignmentStatuses.Active) && here.Any(a => a.Role is Roles.Owner or Roles.Tenant or Roles.Trustee))
                db.RoleAssignments.Add(new RoleAssignment
                {
                    Id = Guid.CreateVersion7(), UserId = user.Id, Role = Roles.PastResident, ScopeType = ScopeTypes.Schemes, OrganisationId = organisation, SchemeIds = [],
                    Label = "No property at the moment", GrantedBy = $"{by} (no property left at the agency)", GrantedAt = now,
                });
        }
    }

    /// <summary>The minute loop: portal access catches up with ownerships and tenancies that started or ended by date.</summary>
    public static async Task SyncAllResidentAccessAsync(HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        var people = (await db.Users.Where(u => u.PersonId != null && u.Kind == IdentityKinds.Customer && u.Status != IdentityStatuses.Deactivated).Select(u => u.PersonId!).ToListAsync(ct))
            .Select(p => Guid.TryParse(p, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).Distinct().ToList();
        foreach (var person in people) await SyncResidentAccessAsync(db, reads, person, "Humo Property Management", ct);
        await db.SaveChangesAsync(ct);
    }

    // ---- Rules ----

    /// <param name="emailTaken">Who in the directory already has this email, if anyone.</param>
    private static Dictionary<string, string> CheckPerson(PersonDetailsRequest d, string? emailTaken)
    {
        var e = new Dictionary<string, string>();
        var email = (d.Email ?? "").Trim();
        var kind = d.Kind ?? "individual";
        if (!Kinds.Contains(kind)) e["kind"] = "Choose individual, company or trust.";
        if (kind == "individual" && (d.FirstName ?? "").Trim().Length < 1) e["firstName"] = "Enter their first name.";
        if ((d.LastName ?? "").Trim().Length < 2) e["lastName"] = kind == "individual" ? "Enter their surname." : "Enter the registered name.";
        if (email.Length > 0 && !EmailPattern().IsMatch(email)) e["email"] = "That doesn’t look like an email address.";
        // One record per person, however many units they own: point to the existing one rather than refuse.
        else if (emailTaken is not null) e["email"] = $"{emailTaken} is already in People with this email. To give them another unit, open {emailTaken} and use “Add a role”.";
        if (email.Length == 0 && (d.Phone ?? "").Trim().Length == 0) e["phone"] = "Give at least a phone number or an email address.";
        if (d.PreferredChannel == "email" && email.Length == 0) e["preferredChannel"] = "Email is preferred, but there’s no email address.";
        return e;
    }

    private static async Task<Dictionary<string, string>> CheckLink(HumoDbContext db, PortfolioReads reads, NewRelationshipRequest l, Scheme? scheme, Guid? personId, CancellationToken ct)
    {
        var e = new Dictionary<string, string>();
        if (scheme is null) return new() { ["schemeId"] = "Choose the scheme." };
        if (scheme.Status == "archived") e["schemeId"] = $"{scheme.Name} is archived.";
        if (l.Type == "trustee")
        {
            // D2: trustees are appointed on the board, never linked as a relationship here.
            e["type"] = "Trustees are appointed on the scheme’s board, from a resolution or by co-option.";
        }
        else if (l.Type is not ("owner" or "tenant"))
        {
            e["type"] = "Choose owner or tenant.";
        }
        else
        {
            var unit = Guid.TryParse(l.UnitId, out var uid) ? await db.Units.FirstOrDefaultAsync(u => u.Id == uid, ct) : null;
            var current = unit is null ? [] : (await db.Relationships.Where(r => r.UnitId == unit.Id && r.Type == l.Type).ToListAsync(ct)).Where(reads.IsCurrent).ToList();
            if (unit is null || unit.SchemeId != scheme.Id) e["unitId"] = "Choose the unit.";
            else if (l.Type == "tenant" && current.Count > 0) e["unitId"] = $"Unit {unit.Number} already has a tenant. End that lease first.";
            else if (l.Type == "owner" && personId is { } pid && current.Any(r => r.PersonId == pid)) e["unitId"] = "They already own this unit.";
            else if (l.Type == "owner" && current.Count > 0)
            {
                // Someone else owns it: ask, never assume. Partners own it together; a sale replaces the owner.
                var names = await db.People.Where(p => current.Select(r => r.PersonId).Contains(p.Id)).Select(p => p.DisplayName).ToListAsync(ct);
                var who = string.Join(" and ", names);
                var takesOver = ParseDate(l.Since);
                if (l.Ownership is not ("joint" or "replaces"))
                    e["ownership"] = $"Unit {unit.Number} is owned by {who}. Do they own it together (for example partners or spouses), or does the new owner replace {who} because it was sold or transferred?";
                else if (l.Ownership == "replaces" && takesOver is { } s && current.Any(r => r.Since >= s))
                    e["since"] = $"{who} became the owner on {current.Max(r => r.Since):d MMMM yyyy}: the new owner takes over after that.";
            }
        }
        var since = ParseDate(l.Since);
        if (since is null) e["since"] = "Choose the date it started.";
        else if (ParseDate(l.Until) is { } until && until < since) e["until"] = "The lease can’t end before it starts.";
        return e;
    }

    private static async Task<string?> EmailOwner(HumoDbContext db, Guid? organisationId, string? email, Guid? except, CancellationToken ct)
    {
        var e = (email ?? "").Trim().ToLower();
        return e.Length > 0 && organisationId is { } org
            ? await db.People.Where(p => p.OrganisationId == org && p.Id != except && p.Email.ToLower() == e).Select(p => p.DisplayName).FirstOrDefaultAsync(ct)
            : null;
    }

    private static void Apply(Person p, PersonDetailsRequest d)
    {
        var first = (d.FirstName ?? "").Trim();
        var last = (d.LastName ?? "").Trim();
        p.FirstName = first;
        p.LastName = last;
        p.Kind = d.Kind;
        p.DisplayName = d.Kind == "individual" ? $"{first} {last}" : last.Length > 0 ? last : first;
        p.Initials = d.Kind == "individual" ? $"{first.FirstOrDefault()}{last.FirstOrDefault()}".ToUpperInvariant().Trim('\0') : p.DisplayName[..Math.Min(2, p.DisplayName.Length)].ToUpperInvariant();
        p.Email = (d.Email ?? "").Trim();
        p.Phone = (d.Phone ?? "").Trim();
        p.PreferredChannel = d.PreferredChannel;
        p.PostalAddress = string.IsNullOrWhiteSpace(d.PostalAddress) ? null : d.PostalAddress.Trim();
    }

    /// <summary>
    /// Adds the relationship. A new owner becomes the levy account's holder when it has none (or the holder no longer owns it).
    /// Returns the owners it replaced, whose access has to follow.
    /// </summary>
    private static List<Guid> Link(HumoDbContext db, Guid personId, NewRelationshipRequest l)
    {
        var replaced = new List<Guid>();
        var rel = new Relationship
        {
            Id = Guid.CreateVersion7(), PersonId = personId, Type = l.Type, SchemeId = Guid.Parse(l.SchemeId),
            UnitId = Guid.TryParse(l.UnitId, out var uid) ? uid : null, Portfolio = l.Portfolio, Since = ParseDate(l.Since)!.Value, Until = ParseDate(l.Until),
        };
        db.Relationships.Add(rel);
        if (rel.Type == "owner" && rel.UnitId is { } unitId)
        {
            var account = db.LevyAccounts.Local.FirstOrDefault(a => a.UnitId == unitId) ?? db.LevyAccounts.First(a => a.UnitId == unitId);
            if (l.Ownership == "replaces")
            {
                // Sold or transferred: the previous owners' ownership ends the day before; the account and its history stay with the unit.
                foreach (var old in db.Relationships.Where(r => r.UnitId == unitId && r.Type == "owner" && r.PersonId != personId && (r.Until == null || r.Until >= rel.Since)).ToList())
                {
                    old.Until = rel.Since.AddDays(-1);
                    replaced.Add(old.PersonId);
                }
                account.HolderPersonId = personId;
            }
            // The holder's ownership had ended (sold, and the buyer added afterwards): the new owner holds it.
            else if (account.HolderPersonId is not { } holder || !StillOwns(db, holder, unitId, rel.Since)) account.HolderPersonId = personId;
        }
        return replaced;
    }

    /// <summary>Whether the person still owns the unit on that day (their ownership hasn't ended before it).</summary>
    private static bool StillOwns(HumoDbContext db, Guid personId, Guid unitId, DateOnly on) =>
        db.Relationships.Local.Concat(db.Relationships.Where(r => r.UnitId == unitId && r.PersonId == personId && r.Type == "owner").ToList())
            .Any(r => r.UnitId == unitId && r.PersonId == personId && r.Type == "owner" && (r.Until is null || r.Until >= on));

    /// <summary>
    /// The minute loop: an account whose holder's ownership has ended (ended for a date that has now passed, or ended
    /// before the next owner was added) goes to a current owner, so statements and letters reach whoever owns the unit.
    /// </summary>
    public static async Task HandOverEndedAsync(HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        var today = reads.Today;
        var ended = await db.Relationships.Where(r => r.Type == "owner" && r.UnitId != null && r.Until != null && r.Until < today).Select(r => new { r.PersonId, UnitId = r.UnitId!.Value }).Distinct().ToListAsync(ct);
        if (ended.Count == 0) return;
        var unitIds = ended.Select(e => e.UnitId).Distinct().ToList();
        var accounts = await db.LevyAccounts.Where(a => unitIds.Contains(a.UnitId) && a.HolderPersonId != null).ToListAsync(ct);
        var owners = (await db.Relationships.Where(r => r.Type == "owner" && r.UnitId != null && unitIds.Contains(r.UnitId.Value)).ToListAsync(ct)).Where(reads.IsCurrent).ToList();
        foreach (var account in accounts)
        {
            var current = owners.Where(r => r.UnitId == account.UnitId).OrderBy(r => r.Since).ToList();
            if (current.Count == 0 || current.Any(r => r.PersonId == account.HolderPersonId)) continue;
            account.HolderPersonId = current[0].PersonId;
        }
        await db.SaveChangesAsync(ct);
    }

    public static DateOnly? ParseDate(string? s) =>
        s is { Length: >= 10 } && DateOnly.TryParseExact(s[..10], "yyyy-MM-dd", out var d) ? d : null;

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailPattern();

    [GeneratedRegex(@"\D")]
    private static partial Regex NonDigits();
}
