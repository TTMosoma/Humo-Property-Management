using Humo.Api.Commands;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Portfolio;

/// <summary>One board action (the frontend's BoardAction, by <c>type</c>).</summary>
public sealed record BoardActionRequest(string Type, string? PersonId, string? Portfolio, string? How, string? Since, string? ResolutionId,
    string? RelationshipId, string? On, string? Reason, int? Minimum);

public sealed record TrusteeViewDto(RelationshipDto Relationship, PersonDto Person, IReadOnlyList<string> Units, bool HasSignIn, bool Invited);

public sealed record BoardViewDto(SchemeDto Scheme, IReadOnlyList<TrusteeViewDto> Trustees, IReadOnlyList<TrusteeViewDto> Former, int Minimum, int CoOpted, object? NextAgm);

public sealed record BoardSummaryDto(SchemeDto Scheme, int Size, int Minimum, string? Chairperson, int CoOpted, int WithoutSignIn);

public sealed record BoardCandidateDto(string PersonId, string Name, IReadOnlyList<string> Units);

/// <summary>
/// The trustee board, the source of truth for trustee access (D2, doc 24 §6). Appointing a
/// trustee who has a Humo sign-in gives them trustee access to the scheme; ending their term takes it away.
/// </summary>
public static class BoardEndpoints
{
    private static readonly string[] Portfolios = ["Chairperson", "Treasurer", "Secretary", "Trustee"];

    public static void MapBoards(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/boards").RequireAuthorization();
        g.MapGet("", List);
        g.MapGet("/{schemeId:guid}", Get);
        g.MapGet("/{schemeId:guid}/candidates", Candidates);
        g.MapPost("/{schemeId:guid}/actions", Act);
    }

    private static async Task<IResult> List(string[]? schemeIds, CurrentActor current, PortfolioReads reads, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var schemes = (await reads.ReadableSchemes(actor, schemeIds, ct)).Where(s => s.Status is not ("archived" or "prospect")).ToList();
        var result = new List<BoardSummaryDto>();
        foreach (var s in schemes)
        {
            var b = await Board(s, reads, db, ct);
            result.Add(new BoardSummaryDto(b.Scheme, b.Trustees.Count, b.Minimum, b.Trustees.FirstOrDefault(t => t.Relationship.Portfolio == "Chairperson")?.Person.DisplayName,
                b.CoOpted, b.Trustees.Count(t => !t.HasSignIn)));
        }
        return Results.Ok(result);
    }

    private static async Task<IResult> Get(Guid schemeId, CurrentActor current, PortfolioReads reads, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var scheme = (await reads.ReadableSchemes(actor, [schemeId.ToString()], ct)).FirstOrDefault();
        return scheme is null ? Problems.NotFound() : Results.Ok(await Board(scheme, reads, db, ct));
    }

    private static async Task<IResult> Candidates(Guid schemeId, CurrentActor current, PortfolioReads reads, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var scheme = (await reads.ReadableSchemes(actor, [schemeId.ToString()], ct)).FirstOrDefault();
        return scheme is null ? Problems.NotFound() : Results.Ok(await CandidatesOf(scheme.Id, reads, db, ct));
    }

    private static async Task<IResult> Act(Guid schemeId, BoardActionRequest a, CurrentActor current, CommandRunner commands, PortfolioReads reads, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var scheme = (await reads.ReadableSchemes(actor, [schemeId.ToString()], ct)).FirstOrDefault();
        if (scheme is null) return Problems.NotFound();
        var trustees = (await db.Relationships.Where(r => r.SchemeId == schemeId && r.Type == "trustee").ToListAsync(ct)).Where(reads.IsCurrent).ToList();
        var candidates = await CandidatesOf(schemeId, reads, db, ct);
        var target = Guid.TryParse(a.RelationshipId, out var rid) ? trustees.FirstOrDefault(r => r.Id == rid) : null;
        var name = async (Guid? personId) => personId is { } p ? await db.People.Where(x => x.Id == p).Select(x => x.DisplayName).FirstOrDefaultAsync(ct) : null;
        var what = a.Type switch
        {
            "appoint" => $"{(a.How == "elected" ? "Elected" : "Co-opted")} {await name(Guid.TryParse(a.PersonId, out var pid) ? pid : null)} as {a.Portfolio}",
            "end" => $"Ended {await name(target?.PersonId)}’s term as trustee ({a.Reason?.Trim()})",
            "set-portfolio" => $"Made {await name(target?.PersonId)} {a.Portfolio}",
            _ => $"Set the board’s minimum to {a.Minimum}",
        };

        return await commands.RunAsync(new CommandSpec($"{what} · {scheme.Name}", "Meetings.Manage")
        {
            Resource = "Trustee board",
            ResourceId = schemeId.ToString(),
            SchemeId = schemeId,
            Validate = () => Check(a, trustees, target, candidates, reads.Today),
        }, async actor =>
        {
            switch (a.Type)
            {
                case "appoint":
                    var personId = Guid.Parse(a.PersonId!);
                    db.Relationships.Add(new Relationship
                    {
                        Id = Guid.CreateVersion7(), PersonId = personId, Type = "trustee", SchemeId = schemeId, Portfolio = a.Portfolio,
                        Since = PeopleEndpoints.ParseDate(a.Since)!.Value, AppointmentHow = a.How,
                        // Until the governance slice, an election cites its resolution by reference.
                        ResolutionRef = a.How == "elected" ? a.ResolutionId?.Trim() : null,
                    });
                    await GrantAccess(db, scheme, personId, a.Portfolio!, actor.User.Name, ct);
                    break;
                case "end":
                    // The last day in office is the day before `on`.
                    target!.Until = PeopleEndpoints.ParseDate(a.On)!.Value.AddDays(-1);
                    target.EndReason = a.Reason!.Trim();
                    await EndAccess(db, schemeId, target.PersonId, actor.User.Name, ct);
                    break;
                case "set-portfolio":
                    target!.Portfolio = a.Portfolio;
                    break;
                case "set-minimum":
                    var s = await db.Schemes.FirstAsync(x => x.Id == schemeId, ct);
                    s.TrusteeMinimum = a.Minimum!.Value;
                    break;
            }
            return Results.NoContent();
        }, ct);
    }

    private static Dictionary<string, string> Check(BoardActionRequest a, List<Relationship> current, Relationship? target, List<BoardCandidateDto> candidates, DateOnly today)
    {
        var e = new Dictionary<string, string>();
        switch (a.Type)
        {
            case "appoint":
                if (!candidates.Any(c => c.PersonId == a.PersonId)) e["personId"] = "Choose an owner in this scheme who isn’t already a trustee.";
                if (string.IsNullOrWhiteSpace(a.Portfolio) || !Portfolios.Contains(a.Portfolio)) e["portfolio"] = "Choose a portfolio.";
                else if (a.Portfolio == "Chairperson" && current.Any(r => r.Portfolio == "Chairperson")) e["portfolio"] = "The board already has a chairperson: change their portfolio first.";
                if (PeopleEndpoints.ParseDate(a.Since) is not { } since) e["since"] = "When did their term start?";
                else if (since > today) e["since"] = "Record the appointment once it has happened.";
                if (a.How is not ("elected" or "co-opted")) e["how"] = "Elected or co-opted?";
                else if (a.How == "elected" && string.IsNullOrWhiteSpace(a.ResolutionId)) e["resolutionId"] = "Elections are by resolution of the owners: give the resolution.";
                break;
            case "end":
                if (target is null) return new() { ["relationshipId"] = "They’re not on the board." };
                if (string.IsNullOrWhiteSpace(a.Reason)) return new() { ["reason"] = "Say why: resigned, sold their unit, removed at a general meeting…" };
                if (PeopleEndpoints.ParseDate(a.On) is not { } on || on < target.Since) return new() { ["on"] = "A date on or after their term started." };
                break;
            case "set-portfolio":
                if (target is null) return new() { ["relationshipId"] = "They’re not on the board." };
                if (string.IsNullOrWhiteSpace(a.Portfolio) || !Portfolios.Contains(a.Portfolio)) return new() { ["portfolio"] = "Choose a portfolio." };
                if (a.Portfolio == "Chairperson" && current.Any(r => r.Id != target.Id && r.Portfolio == "Chairperson")) return new() { ["portfolio"] = "The board already has a chairperson: change their portfolio first." };
                break;
            case "set-minimum":
                if (a.Minimum is not (>= 1 and <= 12)) return new() { ["minimum"] = "A whole number from 1 to 12." };
                break;
            default:
                return new() { ["type"] = "Unknown board action." };
        }
        return e;
    }

    /// <summary>D2: an appointed trustee with a Humo sign-in gets trustee access to the scheme.</summary>
    private static async Task GrantAccess(HumoDbContext db, Scheme scheme, Guid personId, string portfolio, string by, CancellationToken ct)
    {
        var key = personId.ToString();
        var people = await db.Users.Include(u => u.Assignments).Include(u => u.Memberships)
            .Where(u => u.PersonId == key && u.Kind == IdentityKinds.Customer && u.Status != IdentityStatuses.Deactivated).ToListAsync(ct);
        foreach (var u in people)
        {
            if (u.Assignments.Any(x => x.Role == Roles.Trustee && x.Status == AssignmentStatuses.Active && x.SchemeIds.Contains(scheme.Id.ToString()))) continue;
            if (!u.Memberships.Any(m => m.OrganisationId == scheme.OrganisationId && m.Status != MembershipStatuses.Ended))
                db.Memberships.Add(new Membership { Id = Guid.CreateVersion7(), UserId = u.Id, OrganisationId = scheme.OrganisationId, Since = DateTimeOffset.UtcNow });
            db.RoleAssignments.Add(new RoleAssignment
            {
                Id = Guid.CreateVersion7(), UserId = u.Id, Role = Roles.Trustee, ScopeType = ScopeTypes.Schemes, OrganisationId = scheme.OrganisationId,
                SchemeIds = [scheme.Id.ToString()], Label = $"{scheme.Name} · {portfolio}", GrantedBy = $"{by} (board appointment)", GrantedAt = DateTimeOffset.UtcNow,
            });
        }
    }

    /// <summary>Leaving the board ends trustee access to that scheme.</summary>
    private static async Task EndAccess(HumoDbContext db, Guid schemeId, Guid personId, string by, CancellationToken ct)
    {
        var key = personId.ToString();
        var userIds = await db.Users.Where(u => u.PersonId == key).Select(u => u.Id).ToListAsync(ct);
        var assignments = await db.RoleAssignments.Where(a => userIds.Contains(a.UserId) && a.Role == Roles.Trustee && a.Status == AssignmentStatuses.Active).ToListAsync(ct);
        foreach (var a in assignments.Where(a => a.SchemeIds.Count == 1 && a.SchemeIds[0] == schemeId.ToString()))
        {
            a.Status = AssignmentStatuses.Ended;
            a.EndedBy = $"{by} (left the board)";
            a.EndedAt = DateTimeOffset.UtcNow;
            a.Version++;
        }
    }

    private static async Task<BoardViewDto> Board(Scheme scheme, PortfolioReads reads, HumoDbContext db, CancellationToken ct)
    {
        var rels = await db.Relationships.Where(r => r.SchemeId == scheme.Id && (r.Type == "trustee" || r.Type == "owner")).ToListAsync(ct);
        var personIds = rels.Select(r => r.PersonId).Distinct().ToList();
        var people = await db.People.Where(p => personIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        var keys = personIds.Select(p => p.ToString()).ToList();
        var signIns = await db.Users.Where(u => u.PersonId != null && keys.Contains(u.PersonId)).Select(u => new { u.PersonId, u.Status, u.Id }).ToListAsync(ct);
        var unitIds = rels.Where(r => r.UnitId != null).Select(r => r.UnitId!.Value).ToList();
        var accountNos = await db.Units.Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.AccountNo, ct);

        TrusteeViewDto View(Relationship r)
        {
            var units = rels.Where(o => o.Type == "owner" && o.PersonId == r.PersonId && o.UnitId != null && reads.IsCurrent(o)).Select(o => accountNos[o.UnitId!.Value]).ToList();
            var mine = signIns.Where(s => s.PersonId == r.PersonId.ToString()).ToList();
            var active = mine.Any(s => s.Status == IdentityStatuses.Active);
            return new TrusteeViewDto(PortfolioReads.ToDto(r), PortfolioReads.ToDto(people[r.PersonId], mine.FirstOrDefault()?.Id.ToString()), units, active, !active && mine.Any(s => s.Status == IdentityStatuses.Invited));
        }

        static int Order(string? p) => Array.IndexOf(Portfolios, p ?? "Trustee") is var i and >= 0 ? i : 9;
        var trusteeRels = rels.Where(r => r.Type == "trustee").ToList();
        var trustees = trusteeRels.Where(reads.IsCurrent).OrderBy(r => Order(r.Portfolio)).ThenBy(r => r.Since).Select(View).ToList();
        var former = trusteeRels.Where(r => !reads.IsCurrent(r)).OrderByDescending(r => r.Until).Select(View).ToList();
        var dto = (await SchemeEndpoints.ToDtos([scheme], db, ct))[0];
        // The next AGM comes from meetings (governance slice).
        return new BoardViewDto(dto, trustees, former, scheme.TrusteeMinimum, trustees.Count(t => t.Relationship.Appointment?.How == "co-opted"), null);
    }

    /// <summary>Owners (individuals) of units in the scheme who aren't on the board.</summary>
    private static async Task<List<BoardCandidateDto>> CandidatesOf(Guid schemeId, PortfolioReads reads, HumoDbContext db, CancellationToken ct)
    {
        var rels = (await db.Relationships.Where(r => r.SchemeId == schemeId && (r.Type == "trustee" || r.Type == "owner")).ToListAsync(ct)).Where(reads.IsCurrent).ToList();
        var onBoard = rels.Where(r => r.Type == "trustee").Select(r => r.PersonId).ToHashSet();
        var owners = rels.Where(r => r.Type == "owner" && !onBoard.Contains(r.PersonId)).ToList();
        var ids = owners.Select(r => r.PersonId).Distinct().ToList();
        var people = await db.People.Where(p => ids.Contains(p.Id) && p.Kind == "individual").ToListAsync(ct);
        var unitIds = owners.Where(r => r.UnitId != null).Select(r => r.UnitId!.Value).ToList();
        var accountNos = await db.Units.Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.AccountNo, ct);
        return people.OrderBy(p => p.DisplayName)
            .Select(p => new BoardCandidateDto(p.Id.ToString(), p.DisplayName, owners.Where(r => r.PersonId == p.Id && r.UnitId != null).Select(r => accountNos[r.UnitId!.Value]).ToList()))
            .ToList();
    }
}
