using System.Text.RegularExpressions;
using Humo.Api.Commands;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Portfolio;

public sealed record SchemeDetailsRequest(string Name, string Code, string Type, string Suburb, string City, string Province, int? ExpectedVersion);

public sealed record StaffRefDto(string IdentityId, string? StaffId, string Name);

public sealed record SchemeDto(string Id, int Version, string OrganisationId, string Name, string Code, string Type, string Status,
    string Suburb, string City, string Province, int UnitCount, StaffRefDto? PortfolioManager);

/// <summary>
/// Vital signs per scheme. Until the billing, maintenance, compliance and governance slices
/// land there's nothing billed, owed, open or due, so a scheme reads as having none of those.
/// </summary>
public sealed record SchemeHealthDto(string SchemeId, double CollectionRate, decimal Arrears, int Accounts90Plus, decimal MonthlyLevyRoll,
    int OpenJobs, int OverdueJobs, string Compliance, int ComplianceOpenItems, string Rating);

/// <summary>Schemes (doc 24 §4). Reads are scoped by the caller's assignment (S4, D1); changes by C4.</summary>
public static partial class SchemeEndpoints
{
    public static void MapSchemes(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/schemes").RequireAuthorization();
        g.MapGet("", List);
        g.MapGet("/health", Health);
        g.MapGet("/changes", (CancellationToken _) => Results.Ok(Array.Empty<object>())); // from the event log, with later slices
        g.MapGet("/{id:guid}", Get);
        g.MapPost("", Create);
        g.MapPut("/{id:guid}", Update);
        g.MapPost("/{id:guid}/status", SetStatus);
    }

    private static async Task<IResult> List(CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        var actor = await current.GetAsync(ct);
        if (actor is null) return Results.Unauthorized();
        var schemes = await Visible(actor, db).OrderBy(s => s.Name).ToListAsync(ct);
        return Results.Ok(await ToDtos(schemes, db, ct));
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        var actor = await current.GetAsync(ct);
        if (actor is null) return Results.Unauthorized();
        var scheme = await Visible(actor, db).FirstOrDefaultAsync(s => s.Id == id, ct);
        return scheme is null ? Problems.NotFound() : Results.Ok((await ToDtos([scheme], db, ct))[0]);
    }

    private static async Task<IResult> Health(CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        var actor = await current.GetAsync(ct);
        if (actor is null) return Results.Unauthorized();
        var ids = await Visible(actor, db).Select(s => s.Id).ToListAsync(ct);
        var rolls = await db.Units.Where(u => ids.Contains(u.SchemeId)).GroupBy(u => u.SchemeId).Select(g => new { g.Key, Roll = g.Sum(u => u.MonthlyLevy) }).ToDictionaryAsync(x => x.Key, x => x.Roll, ct);
        return Results.Ok(ids.Select(id => new SchemeHealthDto(id.ToString(), 100, 0, 0, rolls.GetValueOrDefault(id), 0, 0, "not-applicable", 0, "good")));
    }

    private static async Task<IResult> Create(SchemeDetailsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var actor = await current.GetAsync(ct);
        if (actor is null) return Results.Unauthorized();
        var organisationId = actor.OrganisationId;
        var code = (body.Code ?? "").Trim().ToUpperInvariant();
        var taken = organisationId is { } org && await db.Schemes.AnyAsync(s => s.OrganisationId == org && s.Code == code, ct);
        var id = Guid.CreateVersion7();

        return await commands.RunAsync(new CommandSpec($"Added scheme {body.Name?.Trim()}", "Schemes.Manage")
        {
            Resource = "Scheme",
            ResourceId = id.ToString(),
            Validate = () => organisationId is null
                ? new() { ["name"] = "Schemes belong to a customer: work in their organisation to add one." }
                : Check(body, code, taken),
        }, _ =>
        {
            db.Schemes.Add(new Scheme
            {
                Id = id,
                OrganisationId = organisationId!.Value,
                Status = "onboarding",
                CreatedAt = clock.GetUtcNow(),
                Name = body.Name!.Trim(), Code = code, Type = body.Type, Suburb = body.Suburb.Trim(), City = body.City.Trim(), Province = body.Province,
            });
            return Task.FromResult(Results.Created($"/api/schemes/{id}", new { id = id.ToString() }));
        }, ct);
    }

    private static async Task<IResult> Update(Guid id, SchemeDetailsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        var actor = await current.GetAsync(ct);
        if (actor is null) return Results.Unauthorized();
        var scheme = await Visible(actor, db).FirstOrDefaultAsync(s => s.Id == id, ct);
        if (scheme is null) return Problems.NotFound();
        var code = (body.Code ?? "").Trim().ToUpperInvariant();
        var taken = await db.Schemes.AnyAsync(s => s.Id != id && s.OrganisationId == scheme.OrganisationId && s.Code == code, ct);

        return await commands.RunAsync(new CommandSpec($"Updated scheme details for {body.Name?.Trim()}", "Schemes.Manage")
        {
            Resource = "Scheme",
            ResourceId = id.ToString(),
            SchemeId = id,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = scheme.Version,
            Validate = () => Check(body, code, taken),
        }, _ =>
        {
            scheme.Name = body.Name!.Trim();
            scheme.Code = code;
            scheme.Type = body.Type;
            scheme.Suburb = body.Suburb.Trim();
            scheme.City = body.City.Trim();
            scheme.Province = body.Province;
            scheme.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> SetStatus(Guid id, StatusRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        var actor = await current.GetAsync(ct);
        if (actor is null) return Results.Unauthorized();
        var scheme = await Visible(actor, db).FirstOrDefaultAsync(s => s.Id == id, ct);
        if (scheme is null) return Problems.NotFound();
        var from = PortfolioRules.SchemeStatusLabels.GetValueOrDefault(scheme.Status, scheme.Status);
        var to = PortfolioRules.SchemeStatusLabels.GetValueOrDefault(body.Status ?? "", body.Status ?? "");

        return await commands.RunAsync(new CommandSpec($"{scheme.Name}: {from} → {to} — {body.Reason}", "Schemes.Manage")
        {
            Resource = "Scheme",
            ResourceId = id.ToString(),
            SchemeId = id,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = scheme.Version,
            Validate = () =>
            {
                if (!PortfolioRules.SchemeMoves.TryGetValue(scheme.Status, out var moves) || !moves.Contains(body.Status))
                    return new() { ["status"] = $"A {scheme.Status} scheme can’t be moved to {body.Status}." };
                // Archiving with money owed is refused once levy accounts exist (billing slice).
                return (body.Reason ?? "").Trim().Length < 5 ? new() { ["reason"] = PortfolioRules.ReasonMessage } : [];
            },
        }, _ =>
        {
            scheme.Status = body.Status!;
            scheme.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static Dictionary<string, string> Check(SchemeDetailsRequest d, string code, bool codeTaken)
    {
        var e = new Dictionary<string, string>();
        if ((d.Name ?? "").Trim().Length < 3) e["name"] = "Enter the scheme’s name.";
        if (!CodePattern().IsMatch(code)) e["code"] = "Use 2–4 letters, e.g. KC. It starts every account number.";
        else if (codeTaken) e["code"] = "Another scheme already uses this code.";
        if (!PortfolioRules.SchemeTypes.Contains(d.Type)) e["type"] = "Choose the type of scheme.";
        if ((d.Suburb ?? "").Trim().Length < 2) e["suburb"] = "Enter the suburb.";
        if ((d.City ?? "").Trim().Length < 2) e["city"] = "Enter the city.";
        if (!PortfolioRules.Provinces.Contains(d.Province)) e["province"] = "Choose the province.";
        return e;
    }

    [GeneratedRegex("^[A-Z]{2,4}$")]
    private static partial Regex CodePattern();

    /// <summary>
    /// The schemes a caller may read (S4, D1): the whole organisation for organisation-wide roles
    /// and Portfolio.BrowseAgency; otherwise the assignment's own schemes. Humo staff read
    /// customers' schemes through support view, which comes with impersonation (doc 24 §8).
    /// </summary>
    public static IQueryable<Scheme> Visible(Actor actor, HumoDbContext db)
    {
        if (actor.OrganisationId is not { } org) return db.Schemes.Where(_ => false);
        var inOrg = db.Schemes.Where(s => s.OrganisationId == org);
        if (actor.ReadsAllSchemesInOrganisation) return inOrg;
        var ids = actor.Assignment.SchemeIds.Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).ToList();
        return inOrg.Where(s => ids.Contains(s.Id));
    }

    /// <summary>Joins the portfolio manager: the longest-standing active portfolio-manager assignment covering the scheme (P0-5).</summary>
    public static async Task<List<SchemeDto>> ToDtos(List<Scheme> schemes, HumoDbContext db, CancellationToken ct)
    {
        var orgIds = schemes.Select(s => s.OrganisationId).Distinct().ToList();
        var managers = await db.RoleAssignments
            .Where(a => a.Role == Roles.PortfolioManager && a.Status == AssignmentStatuses.Active && a.OrganisationId != null && orgIds.Contains(a.OrganisationId.Value))
            .Join(db.Users.Where(u => u.Status == IdentityStatuses.Active), a => a.UserId, u => u.Id, (a, u) => new { a, u })
            .ToListAsync(ct);
        var schemeIds = schemes.Select(s => s.Id).ToList();
        var unitCounts = await db.Units.Where(u => schemeIds.Contains(u.SchemeId)).GroupBy(u => u.SchemeId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var members = await db.Memberships.Where(m => orgIds.Contains(m.OrganisationId) && m.Status == MembershipStatuses.Active).Select(m => new { m.UserId, m.OrganisationId }).ToListAsync(ct);

        return schemes.Select(s =>
        {
            var pm = managers
                .Where(x => x.a.OrganisationId == s.OrganisationId && members.Any(m => m.UserId == x.u.Id && m.OrganisationId == s.OrganisationId))
                .Where(x => x.a.ScopeType == ScopeTypes.Organisation || x.a.SchemeIds.Contains(s.Id.ToString()))
                .OrderBy(x => x.a.GrantedAt)
                .FirstOrDefault();
            return new SchemeDto(s.Id.ToString(), s.Version, s.OrganisationId.ToString(), s.Name, s.Code, s.Type, s.Status, s.Suburb, s.City, s.Province,
                UnitCount: unitCounts.GetValueOrDefault(s.Id), pm is null ? null : new StaffRefDto(pm.u.Id.ToString(), pm.u.Id.ToString(), pm.u.Name));
        }).ToList();
    }
}
