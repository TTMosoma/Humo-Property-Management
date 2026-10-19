using Humo.Api.Commands;
using Humo.Api.Session;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Portfolio;

public sealed record OrganisationDetailsRequest(string Name, string ShortName, string City, string Province, int? ExpectedVersion);
public sealed record StatusRequest(string Status, string Reason, int? ExpectedVersion);
public sealed record ApprovalPolicyRequest(decimal Amount, string Reason, int? ExpectedVersion);

/// <summary>
/// Customer organisations (doc 24 §3). Humo staff see every one; a customer's people see only
/// their own. Never deleted: suspended (everyone paused) or archived (closed, kept).
/// New organisations come from approved account requests (doc 21), not from here.
/// </summary>
public static class OrganisationEndpoints
{
    public static void MapOrganisations(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/organisations").RequireAuthorization();
        g.MapGet("", List);
        g.MapGet("/{id:guid}", Get);
        g.MapPut("/{id:guid}", Update);
        g.MapPost("/{id:guid}/status", SetStatus);
        g.MapPut("/{id:guid}/approval-policy", SetApprovalPolicy);
    }

    private static async Task<IResult> List(CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        var actor = await current.GetAsync(ct);
        if (actor is null) return Results.Unauthorized();
        return Results.Ok((await Visible(actor, db).OrderBy(o => o.ShortName).ToListAsync(ct)).Select(o => ToDto(o)));
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        var actor = await current.GetAsync(ct);
        if (actor is null) return Results.Unauthorized();
        var org = await Visible(actor, db).FirstOrDefaultAsync(o => o.Id == id, ct);
        // Unknown or someone else's: "not found", never "forbidden" (doc 24 S6).
        return org is null ? Problems.NotFound() : Results.Ok(ToDto(org));
    }

    private static async Task<IResult> Update(Guid id, OrganisationDetailsRequest body, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == id, ct);
        if (org is null) return Problems.NotFound();
        var shortName = (body.ShortName ?? "").Trim();
        var taken = await db.Organisations.AnyAsync(o => o.Id != id && o.ShortName.ToLower() == shortName.ToLower(), ct);

        return await commands.RunAsync(new CommandSpec($"Updated organisation details for {shortName}", "Platform.Customers.Manage")
        {
            Resource = "Organisation",
            ResourceId = id.ToString(),
            OrganisationId = id,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = org.Version,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if ((body.Name ?? "").Trim().Length < 3) e["name"] = "Enter the registered name.";
                if (shortName.Length < 2) e["shortName"] = "Enter the name people use day to day.";
                else if (taken) e["shortName"] = "Another customer already uses this name.";
                if ((body.City ?? "").Trim().Length < 2) e["city"] = "Enter the city.";
                if (!PortfolioRules.Provinces.Contains(body.Province)) e["province"] = "Choose the province.";
                return e;
            },
        }, _ =>
        {
            org.Name = body.Name!.Trim();
            org.ShortName = shortName;
            org.City = body.City!.Trim();
            org.Province = body.Province;
            org.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> SetStatus(Guid id, StatusRequest body, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == id, ct);
        if (org is null) return Problems.NotFound();
        var verb = PortfolioRules.OrganisationVerbs.GetValueOrDefault(body.Status ?? "", body.Status ?? "");

        return await commands.RunAsync(new CommandSpec($"{verb} {org.ShortName} — {body.Reason}", "Platform.Customers.Manage")
        {
            Resource = "Organisation",
            ResourceId = id.ToString(),
            OrganisationId = id,
            Category = "security",
            // Pausing or closing a whole customer is a big step: verify it's really you.
            StepUp = body.Status is "suspended" or "archived",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = org.Version,
            Validate = () =>
            {
                if (!PortfolioRules.OrganisationMoves.TryGetValue(org.Status, out var moves) || !moves.Contains(body.Status))
                    return new() { ["status"] = $"A {org.Status} organisation can’t be moved to {body.Status}." };
                return (body.Reason ?? "").Trim().Length < 5 ? new() { ["reason"] = PortfolioRules.ReasonMessage } : [];
            },
        }, _ =>
        {
            org.Status = body.Status!;
            org.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>Humo staff: every organisation. Everyone else: the one their active role is in.</summary>
    private static IQueryable<Organisation> Visible(Actor actor, HumoDbContext db) =>
        actor.IsHumo && actor.Can("Platform.Customers.View") ? db.Organisations : db.Organisations.Where(o => o.Id == actor.OrganisationId);

    public static OrganisationDto ToDto(Organisation o, int schemeCount = 0, int unitCount = 0) =>
        new(o.Id.ToString(), o.Version, o.Kind, o.Status, o.Name, o.ShortName, o.City, o.Province, schemeCount, unitCount, o.ApprovalStepUpAmount);

    /// <summary>
    /// The agency's own approval policy (doc 03): approving this amount or more needs a fresh passkey.
    /// Its administrators set it (Organisation.Manage, step-up); at least R1 000, so it can't be switched off.
    /// </summary>
    private static async Task<IResult> SetApprovalPolicy(Guid id, ApprovalPolicyRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == id, ct);
        if (org is null || actor.OrganisationId != id) return Problems.NotFound();
        return await commands.RunAsync(new CommandSpec($"Set the passkey approval threshold to {Commercial.CommercialEndpoints.Rand(body.Amount)} — {body.Reason?.Trim()}", "Organisation.Manage")
        {
            Resource = "Organisation",
            ResourceId = id.ToString(),
            OrganisationId = id,
            Category = "security",
            StepUp = true,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = org.Version,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (body.Amount is < 1_000 or > 10_000_000) e["amount"] = "Between R1 000 and R10 000 000.";
                if ((body.Reason ?? "").Trim().Length < 5) e["reason"] = PortfolioRules.ReasonMessage;
                return e;
            },
        }, _ =>
        {
            org.ApprovalStepUpAmount = body.Amount;
            org.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }
}
