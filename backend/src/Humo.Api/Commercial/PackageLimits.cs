using Humo.Api.Commands;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Commercial;

/// <summary>One limit: what's in use, what the package includes, and where that leaves the customer.</summary>
/// <param name="State">"ok", "warning" (at 80% or more) or "reached" (at the limit). Null Included: no limit.</param>
public sealed record LimitUsage(int Used, int? Included, string State);

public sealed record PackageLimitsDto(string Package, LimitUsage Units, LimitUsage Users, LimitUsage? Sms);

/// <summary>
/// The limits a customer's package sets (docs/18 D16): units under management, people with a sign-in, and SMS a month.
/// Schemes are unlimited. A customer at 80% of a limit is warned; at the limit, adding more is refused with the
/// package's name and what the next package includes. Nothing that already exists is removed.
/// </summary>
public sealed class PackageLimits(HumoDbContext db, Commercial.CommercialRecords commercial, TimeProvider clock)
{
    /// <summary>The package's terms in force today, or null when the organisation has no agreement.</summary>
    public async Task<(string PackageId, PackageTerms? Terms)?> PackageAsync(Guid organisationId, CancellationToken ct)
    {
        if (await commercial.AgreementAsync(organisationId, ct) is not { } record) return null;
        var today = CommercialRules.Day(clock.GetUtcNow());
        var packageId = CommercialRules.PackageOn(record.Agreement, today)?.PackageId ?? "essentials";
        var catalogue = await commercial.CatalogueAsync(ct);
        return (packageId, CommercialRules.TermsOn(CommercialRules.PackageDef(catalogue, packageId)?.Terms ?? [], today));
    }

    public async Task<PackageLimitsDto?> UsageAsync(Guid organisationId, CancellationToken ct)
    {
        if (await PackageAsync(organisationId, ct) is not { } package) return null;
        var terms = package.Terms;
        var schemeIds = await db.Schemes.AsNoTracking().Where(s => s.OrganisationId == organisationId).Select(s => s.Id).ToListAsync(ct);
        var units = await db.Units.AsNoTracking().CountAsync(u => schemeIds.Contains(u.SchemeId), ct);
        var users = await db.Memberships.AsNoTracking().CountAsync(m => m.OrganisationId == organisationId && m.Status == MembershipStatuses.Active, ct);
        return new PackageLimitsDto(EntitlementCatalogue.Package(package.PackageId)?.Name ?? package.PackageId,
            Measure(units, terms?.IncludedUnits), Measure(users, terms?.IncludedUsers), null);
    }

    /// <summary>Why one more unit can't be added to this organisation, or null when it can.</summary>
    public async Task<string?> RefuseNewUnitAsync(Guid organisationId, CancellationToken ct)
    {
        var usage = await UsageAsync(organisationId, ct);
        if (usage is null || usage.Units.Included is not { } limit || usage.Units.Used < limit) return null;
        return $"The {usage.Package} package includes {limit:N0} units, and you have {usage.Units.Used:N0}. Upgrade to add more.";
    }

    /// <summary>Why one more person can't be given a sign-in to this organisation, or null when they can.</summary>
    public async Task<string?> RefuseNewUserAsync(Guid organisationId, CancellationToken ct)
    {
        var usage = await UsageAsync(organisationId, ct);
        if (usage is null || usage.Users.Included is not { } limit || usage.Users.Used < limit) return null;
        return $"The {usage.Package} package includes {limit:N0} users, and you have {usage.Users.Used:N0}. Upgrade to add more.";
    }

    private static LimitUsage Measure(int used, int? included) =>
        included is not { } limit ? new LimitUsage(used, null, "ok")
        : new LimitUsage(used, limit, used >= limit ? "reached" : used >= limit * 0.8m ? "warning" : "ok");
}

/// <summary>The customer's own limits, for the warning on their screens (D16): GET /api/me/limits.</summary>
public static class PackageLimitsEndpoints
{
    public static void MapPackageLimits(this IEndpointRouteBuilder api) => api.MapGet("/me/limits", Usage).RequireAuthorization();

    private static async Task<IResult> Usage(CurrentActor current, PackageLimits limits, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Subscription.View")) return Problems.Policy("forbidden", "Role does not have this permission");
        if (actor.OrganisationId is not { } organisationId) return Problems.NotFound();
        return await limits.UsageAsync(organisationId, ct) is { } usage ? Results.Ok(usage) : Problems.NotFound();
    }
}
