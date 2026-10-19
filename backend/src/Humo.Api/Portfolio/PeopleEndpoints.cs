using System.Text.RegularExpressions;
using Humo.Api.Commands;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Portfolio;

public sealed record PersonDetailsRequest(string FirstName, string LastName, string Kind, string? Email, string? Phone, string PreferredChannel, string? PostalAddress, int? ExpectedVersion);
public sealed record NewRelationshipRequest(string Type, string SchemeId, string? UnitId, string? Portfolio, string Since, string? Until);
public sealed record CreatePersonRequest(PersonDetailsRequest Details, NewRelationshipRequest? Link);
public sealed record EndRelationshipRequest(string Until);

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
        var emailTaken = await EmailTaken(db, actor.OrganisationId, d.Email, null, ct);
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
        }, _ =>
        {
            var person = new Person { Id = id, OrganisationId = actor.OrganisationId!.Value, CreatedAt = clock.GetUtcNow() };
            Apply(person, d);
            db.People.Add(person);
            if (link is not null) Link(db, person.Id, link);
            return Task.FromResult(Results.Created($"/api/people/{id}", new { id = id.ToString() }));
        }, ct);
    }

    private static async Task<IResult> Update(Guid id, PersonDetailsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var visible = await reads.People(await reads.ReadableSchemes(actor, null, ct), q => q.Where(p => p.Id == id), ct);
        var person = visible.Count == 0 ? null : await db.People.FirstAsync(p => p.Id == id, ct);
        if (person is null) return Problems.NotFound();
        var emailTaken = await EmailTaken(db, person.OrganisationId, body.Email, id, ct);

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
        }, _ =>
        {
            Link(db, id, link);
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> EndRelationship(Guid id, EndRelationshipRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var rel = await db.Relationships.FirstOrDefaultAsync(r => r.Id == id, ct);
        var scheme = rel is null ? null : await SchemeEndpoints.Visible(actor, db).FirstOrDefaultAsync(s => s.Id == rel.SchemeId, ct);
        if (rel is null || scheme is null) return Problems.NotFound();
        var person = await db.People.FirstAsync(p => p.Id == rel.PersonId, ct);
        var until = ParseDate(body.Until);

        return await commands.RunAsync(new CommandSpec($"Ended {rel.Type} of {person.DisplayName} ({body.Until?[..Math.Min(10, body.Until.Length)]})", "People.Manage")
        {
            Resource = "Relationship",
            ResourceId = id.ToString(),
            SchemeId = rel.SchemeId,
            Validate = () => until is null || until < rel.Since ? new() { ["until"] = "Choose a date on or after it started." } : [],
        }, _ =>
        {
            rel.Until = until;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    // ---- Rules ----

    private static Dictionary<string, string> CheckPerson(PersonDetailsRequest d, bool emailTaken)
    {
        var e = new Dictionary<string, string>();
        var email = (d.Email ?? "").Trim();
        var kind = d.Kind ?? "individual";
        if (!Kinds.Contains(kind)) e["kind"] = "Choose individual, company or trust.";
        if (kind == "individual" && (d.FirstName ?? "").Trim().Length < 1) e["firstName"] = "Enter their first name.";
        if ((d.LastName ?? "").Trim().Length < 2) e["lastName"] = kind == "individual" ? "Enter their surname." : "Enter the registered name.";
        if (email.Length > 0 && !EmailPattern().IsMatch(email)) e["email"] = "That doesn’t look like an email address.";
        else if (emailTaken) e["email"] = "Someone else in the directory already has this email.";
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
        }
        var since = ParseDate(l.Since);
        if (since is null) e["since"] = "Choose the date it started.";
        else if (ParseDate(l.Until) is { } until && until < since) e["until"] = "The lease can’t end before it starts.";
        return e;
    }

    private static async Task<bool> EmailTaken(HumoDbContext db, Guid? organisationId, string? email, Guid? except, CancellationToken ct)
    {
        var e = (email ?? "").Trim().ToLower();
        return e.Length > 0 && organisationId is { } org && await db.People.AnyAsync(p => p.OrganisationId == org && p.Id != except && p.Email.ToLower() == e, ct);
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

    /// <summary>Adds the relationship. A new owner becomes the levy account's holder when it has none (or the holder no longer owns it).</summary>
    private static void Link(HumoDbContext db, Guid personId, NewRelationshipRequest l)
    {
        var rel = new Relationship
        {
            Id = Guid.CreateVersion7(), PersonId = personId, Type = l.Type, SchemeId = Guid.Parse(l.SchemeId),
            UnitId = Guid.TryParse(l.UnitId, out var uid) ? uid : null, Portfolio = l.Portfolio, Since = ParseDate(l.Since)!.Value, Until = ParseDate(l.Until),
        };
        db.Relationships.Add(rel);
        if (rel.Type == "owner" && rel.UnitId is { } unitId)
        {
            var account = db.LevyAccounts.Local.FirstOrDefault(a => a.UnitId == unitId) ?? db.LevyAccounts.First(a => a.UnitId == unitId);
            if (account.HolderPersonId is null) account.HolderPersonId = personId;
        }
    }

    public static DateOnly? ParseDate(string? s) =>
        s is { Length: >= 10 } && DateOnly.TryParseExact(s[..10], "yyyy-MM-dd", out var d) ? d : null;

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailPattern();

    [GeneratedRegex(@"\D")]
    private static partial Regex NonDigits();
}
