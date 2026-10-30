using Humo.Api.Commands;
using Humo.Api.Finance;
using Humo.Api.Portfolio;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Settings;

public sealed record ComplianceProfileDto(string SchemeId, int FinancialYearEnd, bool HasLifts);
public sealed record ComplianceProfileRequest(int? FinancialYearEnd, bool? HasLifts);

/// <summary>
/// The scheme facts budgets and compliance follow (D28): the month its financial year ends, and whether it has lifts.
/// A scheme without a year end yet reads as February's, the most common.
/// </summary>
public static class ComplianceProfiles
{
    public static void MapComplianceProfiles(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/settings/compliance-profiles").RequireAuthorization();
        g.MapGet("", List);
        g.MapPut("/{schemeId:guid}", Update);
    }

    private static async Task<IResult> List(string[]? schemeIds, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var wanted = (schemeIds ?? []).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).ToHashSet();
        var schemes = (await SchemeEndpoints.Visible(actor, db).ToListAsync(ct)).Where(s => wanted.Contains(s.Id));
        return Results.Ok(schemes.Select(s => new ComplianceProfileDto(s.Id.ToString(), s.FinancialYearEnd ?? Budgets.DefaultYearEnd, s.HasLifts)));
    }

    private static async Task<IResult> Update(Guid schemeId, ComplianceProfileRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(s => s.Id == schemeId, ct) is not { } scheme) return Problems.NotFound();
        var month = body.FinancialYearEnd is >= 1 and <= 12 ? Budgets.Months[body.FinancialYearEnd.Value - 1] : "?";
        // Budgets already made follow the year they were made for; the next ones follow the new year end.
        return await commands.RunAsync(new CommandSpec($"Set {scheme.Name}’s financial year-end to {month}{(body.HasLifts == true ? ", with lifts" : "")}", "Compliance.Manage")
        {
            Resource = "Scheme",
            ResourceId = schemeId.ToString(),
            SchemeId = schemeId,
            Validate = () => body.FinancialYearEnd is not (>= 1 and <= 12) ? new() { ["financialYearEnd"] = "Choose a month." } : [],
        }, _ =>
        {
            scheme.FinancialYearEnd = body.FinancialYearEnd;
            scheme.HasLifts = body.HasLifts ?? false;
            scheme.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }
}
