using System.Text.RegularExpressions;
using Humo.Api.Commands;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Portfolio;

public sealed record UnitDetailsRequest(string Number, string? Block, string Description, decimal SizeM2, decimal ParticipationQuota, decimal MonthlyLevy, string Occupancy, int? ExpectedVersion);

/// <summary>Units and their levy accounts (doc 24 §5). Reads limited to schemes the caller may read; changes by C4.</summary>
public static partial class UnitEndpoints
{
    private static readonly string[] Occupancies = ["owner-occupied", "tenanted", "vacant"];

    public static void MapUnits(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("").RequireAuthorization();
        g.MapGet("/units", List);
        g.MapGet("/units/search", Search);
        g.MapGet("/units/{id:guid}", ById);
        g.MapGet("/schemes/{schemeId:guid}/units/{number}", ByNumber);
        g.MapPost("/schemes/{schemeId:guid}/units", Create);
        g.MapPut("/units/{id:guid}", Update);
    }

    private static async Task<IResult> List(string[]? schemeIds, int? page, int? pageSize, CurrentActor current, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var schemes = await reads.ReadableSchemes(actor, schemeIds, ct);
        return Results.Ok(PortfolioReads.Page(await reads.Units(schemes, null, ct), page, pageSize));
    }

    private static async Task<IResult> ById(Guid id, CurrentActor current, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var found = await reads.Units(await reads.ReadableSchemes(actor, null, ct), q => q.Where(u => u.Id == id), ct);
        return found.Count == 0 ? Problems.NotFound() : Results.Ok(found[0]);
    }

    private static async Task<IResult> ByNumber(Guid schemeId, string number, CurrentActor current, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var found = await reads.Units(await reads.ReadableSchemes(actor, [schemeId.ToString()], ct), q => q.Where(u => u.Number == number), ct);
        return found.Count == 0 ? Problems.NotFound() : Results.Ok(found[0]);
    }

    /// <summary>"KC 42", "kingfisher 42", "KC-042", "unit 42": a number, and optionally words from the scheme's code or name.</summary>
    private static async Task<IResult> Search(string? q, string[]? schemeIds, int? limit, CurrentActor current, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var query = (q ?? "").Trim().ToLowerInvariant();
        var num = NumberPart().Match(query);
        if (!num.Success) return Results.Ok(Array.Empty<UnitSummaryDto>());
        var n = int.Parse(num.Value).ToString();
        var words = NotWords().Replace(query, " ").Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(w => w is not ("unit" or "erf" or "flat")).ToList();
        var schemes = (await reads.ReadableSchemes(actor, schemeIds, ct))
            .Where(s => words.All(w => $"{s.Code} {s.Name}".Contains(w, StringComparison.OrdinalIgnoreCase))).ToList();
        var found = await reads.Units(schemes, u => u.Where(x => x.Number == n), ct);
        return Results.Ok(found.Take(limit ?? 8));
    }

    private static async Task<IResult> Create(Guid schemeId, UnitDetailsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var scheme = await SchemeEndpoints.Visible(actor, db).FirstOrDefaultAsync(s => s.Id == schemeId, ct);
        if (scheme is null) return Problems.NotFound();
        var number = (body.Number ?? "").Trim();
        var exists = await db.Units.AnyAsync(u => u.SchemeId == schemeId && u.Number == number, ct);
        var id = Guid.CreateVersion7();

        return await commands.RunAsync(new CommandSpec($"Added unit {number} to {scheme.Name}", "Units.Manage")
        {
            Resource = "Unit",
            ResourceId = id.ToString(),
            SchemeId = schemeId,
            Validate = () =>
            {
                var e = Check(scheme, body);
                if (!e.ContainsKey("number") && exists) e["number"] = $"There’s already a unit {number} in {scheme.Name}.";
                return e;
            },
        }, _ =>
        {
            var accountNo = AccountNumber(scheme.Code, number);
            db.Units.Add(new Unit
            {
                Id = id, SchemeId = schemeId, Number = number, AccountNo = accountNo, Block = Blank(body.Block), Description = body.Description.Trim(),
                SizeM2 = body.SizeM2, ParticipationQuota = body.ParticipationQuota, MonthlyLevy = Math.Round(body.MonthlyLevy, 2), Occupancy = body.Occupancy, CreatedAt = clock.GetUtcNow(),
            });
            // Every unit has its levy account from the start; the owner becomes its holder when linked.
            db.LevyAccounts.Add(new LevyAccount { Id = Guid.CreateVersion7(), UnitId = id, SchemeId = schemeId, AccountNo = accountNo });
            return Task.FromResult(Results.Created($"/api/units/{id}", new { id = id.ToString() }));
        }, ct);
    }

    private static async Task<IResult> Update(Guid id, UnitDetailsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var unit = await db.Units.FirstOrDefaultAsync(u => u.Id == id, ct);
        var scheme = unit is null ? null : await SchemeEndpoints.Visible(actor, db).FirstOrDefaultAsync(s => s.Id == unit.SchemeId, ct);
        if (unit is null || scheme is null) return Problems.NotFound();

        return await commands.RunAsync(new CommandSpec($"Updated unit {unit.Number} ({unit.AccountNo})", "Units.Manage")
        {
            Resource = "Unit",
            ResourceId = id.ToString(),
            SchemeId = unit.SchemeId,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = unit.Version,
            // The number is part of the account number: it's kept as it is.
            Validate = () => Check(scheme, body with { Number = unit.Number }),
        }, _ =>
        {
            unit.Block = Blank(body.Block);
            unit.Description = body.Description.Trim();
            unit.SizeM2 = body.SizeM2;
            unit.ParticipationQuota = body.ParticipationQuota;
            unit.MonthlyLevy = Math.Round(body.MonthlyLevy, 2);
            unit.Occupancy = body.Occupancy;
            unit.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static Dictionary<string, string> Check(Scheme scheme, UnitDetailsRequest d)
    {
        var e = new Dictionary<string, string>();
        if (scheme.Status is "archived" or "closed") e["number"] = $"{scheme.Name} is {scheme.Status}; reopen it to change its units.";
        if (!NumberPattern().IsMatch((d.Number ?? "").Trim())) e["number"] = "Use the unit number as people say it, e.g. 42 or 12B.";
        if ((d.Description ?? "").Trim().Length < 2) e["description"] = "Describe the unit, e.g. 2-bed apartment.";
        if (!(d.SizeM2 > 0)) e["sizeM2"] = "Enter the size in square metres.";
        if (!(d.ParticipationQuota > 0 && d.ParticipationQuota <= 100)) e["participationQuota"] = "Enter the participation quota as a percentage (0–100).";
        if (!(d.MonthlyLevy >= 0)) e["monthlyLevy"] = "Enter the monthly levy in rands.";
        if (!Occupancies.Contains(d.Occupancy)) e["occupancy"] = "Choose who lives there.";
        return e;
    }

    /// <summary>KC + 42 → KC-042; KC + 12B → KC-12B (so it can't collide with unit 12).</summary>
    public static string AccountNumber(string code, string number) =>
        $"{code}-{(number.All(char.IsDigit) ? number.PadLeft(3, '0') : number.ToUpperInvariant())}";

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    [GeneratedRegex("^[A-Za-z0-9-]{1,6}$")]
    private static partial Regex NumberPattern();

    [GeneratedRegex(@"\d+")]
    private static partial Regex NumberPart();

    [GeneratedRegex(@"[-\d]")]
    private static partial Regex NotWords();
}
