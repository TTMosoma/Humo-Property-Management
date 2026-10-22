using System.Globalization;
using System.Text.Json;
using Humo.Api.Audit;
using Humo.Api.Commands;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Commercial;

/// <summary>One limit: what's in use, what the package includes, and where that leaves the agency.</summary>
/// <param name="State">"ok", "warning" (at 80% or more) or "reached" (at the limit). Null Included: no limit.</param>
public sealed record LimitUsage(int Used, int? Included, string State);

/// <summary>
/// The Professional trial (D17): "available" once an Essentials agency is at 80% of a limit, "active" while it runs,
/// "used" once it has run (once per agency), and "not-applicable" otherwise.
/// </summary>
public sealed record ProfessionalTrialDto(string Status, string? EndsAt);

public sealed record PackageLimitsDto(string Package, LimitUsage Units, LimitUsage Users, ProfessionalTrialDto Trial);

/// <summary>
/// The limits a package sets (docs/18 D16, D17): units under management and people with a sign-in. Schemes are unlimited.
/// At 80% an agency is warned; at the limit, adding more is refused with what the next package includes. An Essentials
/// agency at 80% is offered the Professional trial, which it starts itself.
/// </summary>
public sealed class PackageLimits(HumoDbContext db, Commercial.CommercialRecords commercial, TimeProvider clock)
{
    /// <summary>The name a trial's override is recorded under, so the trial can be found again.</summary>
    public const string TrialReason = "Professional trial";
    public const int TrialDays = 30;

    /// <summary>The package's id and terms in force today, or null when the organisation has no agreement.</summary>
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
        var unitsMeasure = Measure(units, terms?.IncludedUnits);
        var usersMeasure = Measure(users, terms?.IncludedUsers);
        var trial = await TrialAsync(organisationId, package.PackageId, unitsMeasure, usersMeasure, ct);
        return new PackageLimitsDto(EntitlementCatalogue.Package(package.PackageId)?.Name ?? package.PackageId, unitsMeasure, usersMeasure, trial);
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

    /// <summary>
    /// Starts the Professional trial at the agency's request. Each Professional feature is granted for 30 days as an
    /// override on the subscription, which ends by itself. Refused unless the agency is on Essentials, is at 80% of a
    /// limit, and hasn't had the trial before.
    /// </summary>
    public async Task<string?> StartTrialAsync(Guid organisationId, Guid? requestedBy, string actorName, CancellationToken ct)
    {
        var usage = await UsageAsync(organisationId, ct);
        if (usage is null) return "There’s no agreement to start a trial on.";
        if (usage.Trial.Status != "available")
            return usage.Trial.Status switch
            {
                "used" => "The Professional trial has already been used on this account.",
                "active" => "The Professional trial is already running.",
                _ => "The Professional trial is offered once an Essentials account reaches 80% of a limit.",
            };
        var subscription = await db.Subscriptions.FirstOrDefaultAsync(s => s.OrganisationId == organisationId, ct);
        if (subscription is null) return "There’s no subscription to start a trial on.";

        var now = clock.GetUtcNow();
        var ends = (now + TimeSpan.FromDays(TrialDays)).ToString("O", CultureInfo.InvariantCulture);
        var overrides = JsonSerializer.Deserialize<List<FeatureOverride>>(subscription.Overrides, Json.Options) ?? [];
        foreach (var feature in EntitlementCatalogue.Package("professional")?.Features ?? [])
        {
            overrides.RemoveAll(o => o.Feature == feature);
            overrides.Add(new FeatureOverride(feature, true, TrialReason, actorName, now.ToString("O", CultureInfo.InvariantCulture), ends));
        }
        subscription.Overrides = CommercialRecords.Serialise(overrides);
        subscription.Version++;
        return null;
    }

    /// <summary>Whether the trial is available, running, or already used, and when a running one ends.</summary>
    private async Task<ProfessionalTrialDto> TrialAsync(Guid organisationId, string packageId, LimitUsage units, LimitUsage users, CancellationToken ct)
    {
        var subscription = await db.Subscriptions.AsNoTracking().FirstOrDefaultAsync(s => s.OrganisationId == organisationId, ct);
        var overrides = subscription is null ? [] : JsonSerializer.Deserialize<List<FeatureOverride>>(subscription.Overrides, Json.Options) ?? [];
        var trial = overrides.Where(o => o.Reason == TrialReason).ToList();
        var now = clock.GetUtcNow();
        var running = trial.Select(o => o.ExpiresAt is null ? (DateTimeOffset?)null : DateTimeOffset.Parse(o.ExpiresAt, CultureInfo.InvariantCulture))
            .FirstOrDefault(end => end is { } e && e > now);
        if (running is { } endsAt) return new ProfessionalTrialDto("active", endsAt.ToString("O", CultureInfo.InvariantCulture));
        if (trial.Count > 0) return new ProfessionalTrialDto("used", null);
        var atEighty = units.State != "ok" || users.State != "ok";
        return packageId == "essentials" && atEighty ? new ProfessionalTrialDto("available", null) : new ProfessionalTrialDto("not-applicable", null);
    }

    private static LimitUsage Measure(int used, int? included) =>
        included is not { } limit ? new LimitUsage(used, null, "ok")
        : new LimitUsage(used, limit, used >= limit ? "reached" : used >= limit * 0.8m ? "warning" : "ok");
}

/// <summary>The agency's own limits, for the staff app's warning (D16, D17): GET /api/me/limits, and the trial's start.</summary>
public static class PackageLimitsEndpoints
{
    public static void MapPackageLimits(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/me/limits").RequireAuthorization();
        g.MapGet("", Usage);
        g.MapPost("/professional-trial", StartTrial);
    }

    private static async Task<IResult> Usage(CurrentActor current, PackageLimits limits, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Subscription.View")) return Problems.Policy("forbidden", "Role does not have this permission");
        if (actor.OrganisationId is not { } organisationId) return Problems.NotFound();
        return await limits.UsageAsync(organisationId, ct) is { } usage ? Results.Ok(usage) : Problems.NotFound();
    }

    /// <summary>The agency's administrator starts the trial; it's recorded in the audit log.</summary>
    private static async Task<IResult> StartTrial(CurrentActor current, PackageLimits limits, HumoDbContext db, AuditLog audit, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Subscription.Request")) return Problems.Policy("forbidden", "Role does not have this permission");
        if (actor.OrganisationId is not { } organisationId) return Problems.NotFound();
        if (await limits.StartTrialAsync(organisationId, actor.Human.Id, actor.Human.Name, ct) is { } refusal)
            return Problems.Policy("not-available", refusal);
        audit.Record("Started the Professional trial (30 days)", "success", actor.Human, category: "subscription", organisationId: organisationId);
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }
}
