using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Commercial;

public sealed record SubscriptionChangeRequest(string Type, string? PackageId, string? AddOnId, string? Feature, bool? Enabled, int? Days, string Reason);
public sealed record ChangeSubscriptionRequest(SubscriptionChangeRequest Change, int? ExpectedVersion);
public sealed record UpgradeRequestStatusRequest(string Status);
public sealed record NewUpgradeRequest(string? AddOn, string? Package, string? Feature, string? Note, string Source);

public sealed record CatalogueDto(IReadOnlyList<FeatureDef> Features, IReadOnlyList<PackageDef> Packages, IReadOnlyList<AddOnSummaryDto> AddOns);
public sealed record AddOnSummaryDto(string Id, string Name, string Description, IReadOnlyList<string> Features);

public sealed record UpgradeRequestDto(string Id, string OrganisationId, string? AddOn, string? Package, string RequestedBy, string At, string? Note, string Source, string Status);

public sealed record UsageSnapshotDto(string OrganisationId, string At, int Seats, int ActiveUsers30d, decimal LoginsPerUserWeek, Dictionary<string, object> ModuleUsage,
    int WorkflowsStarted30d, int WorkflowsCompleted30d, int OpenTickets, int CriticalTickets, string PaymentStatus, int Schemes, int Units, int Trustees, int MeetingsPerYear,
    int ReportExports30d, int MaintenanceRequests30d, int ReceiptsAllocated30d, int PortalUsers30d, IReadOnlyList<int> ScoreHistory);

/// <summary>A health signal. <c>Measured</c> false: Humo can't measure it yet, so it isn't in the score (docs/04 §3).</summary>
public sealed record HealthSignalDto(string Key, string Label, int Score, decimal Weight, string Detail, bool Measured);
public sealed record ModuleAdoptionDto(string Module, bool Enabled, int Adoption, bool Measured);
public sealed record AccountHealthDto(string OrganisationId, int Score, string Band, IReadOnlyList<HealthSignalDto> Signals, IReadOnlyList<ModuleAdoptionDto> Modules,
    IReadOnlyList<int> History, string ComputedAt, bool Partial);

public sealed record PlatformCustomerDto(string OrganisationId, string Name, string City, string Province, string CustomerSince, string AccountManagerId, string AccountManager,
    string Status, SubscriptionView Subscription, IReadOnlyList<Entitlement> Entitlements, UsageSnapshotDto Snapshot, AccountHealthDto Health,
    IReadOnlyList<object> Opportunities, IReadOnlyList<UpgradeRequestDto> Requests, IReadOnlyList<object> Tickets);

public sealed record CustomerPlanDto(string OrganisationId, string PackageId, string Status, string RenewsAt, IReadOnlyList<SubscriptionAddOn> AddOns, IReadOnlyList<Entitlement> Entitlements,
    string AccountManager, IReadOnlyList<UpgradeRequestDto> Requests, StorageSummary Storage, CustomerBillingDto Billing, IReadOnlyList<MessageAllowance> Messages);
public sealed record CustomerBillingDto(string Preference, string NextBillingDate, RenewalDto Renewal);
public sealed record RenewalDto(string On, decimal? Fee);

public sealed record MonthPointDto(string Month, decimal Mrr, int Customers, int NewCustomers, int Churned, decimal ExpansionMrr, decimal ChurnedMrr, int ActiveUsers);
public sealed record BusinessOverviewDto(decimal Mrr, decimal Arr, int Customers, int Schemes, int Units, int ActiveUsers, decimal Retention, decimal Nrr, IReadOnlyList<MonthPointDto> History,
    IReadOnlyList<object> ByPackage, object Health, IReadOnlyList<object> ModuleUsage, object Expansion);

/// <summary>
/// Humo's customers and their subscriptions (docs/04): the customers list, Customer 360, Manage features,
/// upgrade requests, the customer's own Plan &amp; features, and the published catalogue.
/// Health uses only what Humo can measure today (sign-ins, users, payment); the rest says "Not measured yet".
/// </summary>
public static class CustomerEndpoints
{
    private static readonly string[] Modules = ["portfolio", "finance", "maintenance", "communications", "documents", "governance", "compliance", "reporting"];
    private static readonly Dictionary<string, string> ModuleKeyFeature = new()
    {
        ["portfolio"] = "schemes", ["finance"] = "finance-basic", ["maintenance"] = "maintenance-basic", ["communications"] = "communications",
        ["documents"] = "documents", ["governance"] = "governance", ["compliance"] = "compliance", ["reporting"] = "reporting-advanced",
    };

    public static void MapCustomers(this IEndpointRouteBuilder api)
    {
        api.MapGet("/catalogue", Catalogue).RequireAuthorization();
        var g = api.MapGroup("/platform").RequireAuthorization();
        g.MapGet("/customers", List);
        g.MapGet("/customers/{id:guid}", Get);
        g.MapGet("/overview", Overview);
        g.MapPost("/customers/{id:guid}/subscription", ChangeSubscription);
        g.MapPost("/upgrade-requests/{id:guid}/status", SetRequestStatus);
        var o = api.MapGroup("/organisations/{id:guid}").RequireAuthorization();
        o.MapGet("/plan", Plan);
        o.MapPost("/upgrade-requests", RequestUpgrade);
    }

    /// <summary>Features, packages and the add-ons on sale (retired ones last: existing lines still name them).</summary>
    private static async Task<IResult> Catalogue(CommercialRecords commercial, CancellationToken ct)
    {
        var cat = await commercial.CatalogueAsync(ct);
        var addOns = cat.AddOns.OrderBy(a => a.Status == CatalogueStatuses.Retired ? 1 : 0).Select(a => new AddOnSummaryDto(a.Id, a.Name, a.Description, a.Features)).ToList();
        return Results.Ok(new CatalogueDto(EntitlementCatalogue.Features, EntitlementCatalogue.Packages, addOns));
    }

    private static async Task<IResult> List(int? page, int? pageSize, CurrentActor current, HumoDbContext db, CommercialRecords commercial, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Platform.Customers.View")) return Results.Ok(PortfolioReads.Page(new List<PlatformCustomerDto>(), page, pageSize));
        var customers = await Customers(db, commercial, clock, actor, null, ct);
        return Results.Ok(PortfolioReads.Page(customers, page, pageSize));
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, CommercialRecords commercial, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var c = actor.Can("Platform.Customers.View") ? (await Customers(db, commercial, clock, actor, id, ct)).FirstOrDefault() : null;
        return c is null ? Problems.NotFound() : Results.Ok(c);
    }

    /// <summary>
    /// The business at a glance, from today's records. Monthly snapshots aren't recorded yet (slice C4),
    /// so the history is the current month only and the trailing figures can't show churn.
    /// </summary>
    private static async Task<IResult> Overview(CurrentActor current, HumoDbContext db, CommercialRecords commercial, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Platform.Insights.View")) return Problems.Policy("forbidden", "Not permitted to see the business overview");
        var all = await Customers(db, commercial, clock, actor, null, ct);
        var live = all.Where(c => c.Subscription.Status != SubscriptionStatuses.Cancelled).ToList();
        var mrr = live.Sum(c => c.Subscription.Mrr);
        var month = CommercialRules.Day(clock.GetUtcNow())[..7];
        var newThisMonth = live.Count(c => c.CustomerSince.StartsWith(month, StringComparison.Ordinal));
        var activeUsers = live.Sum(c => c.Snapshot.ActiveUsers30d);
        var band = (string b) => all.Where(c => c.Health.Band == b).ToList();
        var history = new List<MonthPointDto> { new(month, mrr, live.Count, newThisMonth, 0, 0, 0, activeUsers) };
        return Results.Ok(new BusinessOverviewDto(
            mrr, mrr * 12, live.Count, live.Sum(c => c.Snapshot.Schemes), live.Sum(c => c.Snapshot.Units), activeUsers, 100, 100, history,
            EntitlementCatalogue.Packages.Select(p => (object)new { packageId = p.Id, customers = live.Count(c => c.Subscription.PackageId == p.Id), mrr = live.Where(c => c.Subscription.PackageId == p.Id).Sum(c => c.Subscription.Mrr) }).ToList(),
            new { healthy = band("healthy").Count, atRisk = band("at-risk").Count, critical = band("critical").Count, atRiskMrr = band("at-risk").Concat(band("critical")).Sum(c => c.Subscription.Mrr) },
            // Module usage needs the usage pipeline (docs/04 §3): not measured yet.
            Modules.Select(m => (object)new { module = m, adoption = 0 }).ToList(),
            new { likelyToUpgrade = 0, potentialMrr = 0, underutilising = 0, demandWithoutFeature = 0, top = Array.Empty<object>() }));
    }

    // ---- Manage features (D11: Account Managers for their own customers, with step-up) ----

    private static async Task<IResult> ChangeSubscription(Guid id, ChangeSubscriptionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CommercialRecords commercial,
        TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == id, ct);
        var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.OrganisationId == id, ct);
        var stored = await commercial.AgreementAsync(id, ct);
        if (org is null || sub is null || stored is not { } rec) return Problems.NotFound();
        var cat = await commercial.CatalogueAsync(ct);
        var c = body.Change;
        var today = commercial.Today;
        var addOn = c.AddOnId is null ? null : CommercialRules.AddOnDef(cat, c.AddOnId);
        var what = c.Type switch
        {
            "package" => $"Changed package to {EntitlementCatalogue.Package(c.PackageId ?? "")?.Name ?? c.PackageId}",
            "add-on" => $"{(c.Enabled == true ? "Added" : "Removed")} the {addOn?.Name ?? c.AddOnId} add-on",
            "override" => c.Enabled is null ? $"Cleared the override on {FeatureLabel(c.Feature)}"
                : $"{(c.Enabled == true ? "Granted" : "Switched off")} {FeatureLabel(c.Feature)}{(c.Days is { } d ? $" for {d} days" : "")}",
            _ => "Changed the subscription",
        };

        return await commands.RunAsync(new CommandSpec($"{what} for {org.ShortName} — {c.Reason?.Trim()}", "Platform.Subscriptions.Manage")
        {
            Resource = "Subscription",
            ResourceId = id.ToString(),
            Category = "security",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = sub.Version,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                // D11: no approval, but every change is audited with its reason.
                if ((c.Reason ?? "").Trim().Length < 8) e["reason"] = "Say why, in a few words. It goes in the audit log.";
                switch (c.Type)
                {
                    case "package":
                        if (!EntitlementCatalogue.IsPackage(c.PackageId)) e["packageId"] = "Choose a package.";
                        else if (CommercialRules.PackageOn(rec.Agreement, today)?.PackageId == c.PackageId) e["packageId"] = "They’re already on this package.";
                        break;
                    case "add-on":
                        var has = CommercialRules.InForce(rec.Agreement.AddOns, today).Any(l => l.AddOnId == c.AddOnId);
                        if (addOn is null) e["addOnId"] = "Choose an add-on.";
                        else if (c.Enabled == true && (addOn.Status != CatalogueStatuses.Active || has)) e["addOnId"] = has ? "They already have this add-on." : "This add-on isn’t available.";
                        else if (c.Enabled != true && !has) e["addOnId"] = "They don’t have this add-on.";
                        break;
                    case "override":
                        if (c.Feature is null || !EntitlementCatalogue.FeatureKeys.Contains(c.Feature)) e["feature"] = "Choose a feature.";
                        if (c.Days is { } days && days is < 1 or > 365) e["days"] = "Between 1 and 365 days.";
                        break;
                    default:
                        e["type"] = "Change the package, an add-on or a feature.";
                        break;
                }
                return e;
            },
        }, actor =>
        {
            OwnAccountOnly(actor, org);
            var now = clock.GetUtcNow();
            if (c.Type == "override")
            {
                var overrides = (JsonSerializer.Deserialize<List<FeatureOverride>>(sub.Overrides, Json.Options) ?? []).Where(o => o.Feature != c.Feature).ToList();
                if (c.Enabled is { } on)
                    overrides.Add(new FeatureOverride(c.Feature!, on, c.Reason!.Trim(), actor.Human.Name, now.ToString("O"), c.Days is { } d ? (now + TimeSpan.FromDays(d)).ToString("O") : null));
                sub.Overrides = CommercialRecords.Serialise(overrides);
            }
            else
            {
                CommercialRecords.Write(rec.Row, ManageFeaturesChange(rec.Agreement, c, cat, today, Approval(actor), actor, now, what));
            }
            sub.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>
    /// A package or add-on change from Manage features, effective today. It doesn't change what the customer
    /// pays: a new package keeps the agreed price and an add-on is included in it, unless the catalogue has a
    /// price. Priced and scheduled changes are made in Billing &amp; agreement (docs/23 §4).
    /// </summary>
    private static CommercialAgreement ManageFeaturesChange(CommercialAgreement a, SubscriptionChangeRequest c, CommercialCatalogue cat, string today, string approval, Actor actor, DateTimeOffset now, string describe)
    {
        var by = new ChangeActor(actor.Human.Id.ToString(), actor.Human.Name, approval);
        if (c.Type == "package")
        {
            var listed = CommercialRules.TermsOn(CommercialRules.PackageDef(cat, c.PackageId!)?.Terms ?? [], today)?.MonthlyPrice;
            var change = new AgreementChange { Type = "package", PackageId = c.PackageId, EffectiveFrom = today, Reason = c.Reason ?? "" };
            if (listed is null) { change.MonthlyPrice = CommercialRules.PackageOn(a, today)?.MonthlyPrice; change.MonthlyPriceGiven = true; }
            return CommercialRules.ApplyChange(a, change, cat, by, now, describe, CommercialRecords.NewLineId);
        }
        if (c.Enabled == true)
        {
            var listed = CommercialRules.TermsOn(CommercialRules.AddOnDef(cat, c.AddOnId!)?.Terms ?? [], today)?.Price;
            var change = new AgreementChange { Type = "add-on", AddOnId = c.AddOnId, Quantity = 1, EffectiveFrom = today, Reason = c.Reason ?? "", UnitPriceGiven = listed is null };
            var next = CommercialRules.ApplyChange(a, change, cat, by, now, describe, CommercialRecords.NewLineId);
            if (listed is null) next.AddOns[^1].PriceSource = PriceSources.Included;
            return next;
        }
        return CommercialRules.ApplyChange(a, new AgreementChange { Type = "remove-add-on", AddOnId = c.AddOnId, EffectiveFrom = today, Reason = c.Reason ?? "" }, cat, by, now, describe, CommercialRecords.NewLineId);
    }

    private static async Task<IResult> SetRequestStatus(Guid id, UpgradeRequestStatusRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var r = await db.UpgradeRequests.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return Problems.NotFound();
        return await commands.RunAsync(new CommandSpec($"Marked upgrade request {body.Status}", "Platform.Opportunities.Manage")
        {
            Resource = "Upgrade request",
            ResourceId = id.ToString(),
            OrganisationId = r.OrganisationId,
            Validate = () => body.Status is "new" or "in-progress" or "done" or "declined" ? [] : new() { ["status"] = "New, in progress, done or declined." },
        }, _ =>
        {
            r.Status = body.Status;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    // ---- The customer's own plan (Agency Administrators: they can ask, not enable) ----

    /// <summary>Only what the customer should see: no health, opportunities or other customers' prices.</summary>
    private static async Task<IResult> Plan(Guid id, CurrentActor current, HumoDbContext db, CommercialRecords commercial, Messaging.MessageUsage usage, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.OrganisationId != id || !actor.Can("Subscription.View")) return Problems.NotFound();
        if (await commercial.PlanAsync(id, ct) is not { } plan || await commercial.AgreementAsync(id, ct) is not { } rec) return Problems.NotFound();
        var org = await db.Organisations.FirstAsync(o => o.Id == id, ct);
        var manager = org.AccountManagerId is { } m ? await db.Users.Where(u => u.Id == m).Select(u => u.Name).FirstOrDefaultAsync(ct) : null;
        var cat = await commercial.CatalogueAsync(ct);
        var requests = await db.UpgradeRequests.Where(r => r.OrganisationId == id).ToListAsync(ct);
        var a = rec.Agreement;
        return Results.Ok(new CustomerPlanDto(id.ToString(), plan.Subscription.PackageId, plan.Subscription.Status, plan.Subscription.RenewsAt, plan.Subscription.AddOns, plan.Entitlements,
            manager ?? "Humo", requests.OrderByDescending(r => r.At).Select(ToDto).ToList(), CommercialRules.Storage(a, cat, await MeasuredAsync(db, id, clock, ct), commercial.Today),
            new CustomerBillingDto(a.Billing.Preference, a.Billing.NextBillingDate, new RenewalDto(a.Renewal.On, a.Renewal.Fee)),
            CommercialRules.Messages(a, cat, commercial.Today, await usage.ThisMonthAsync(id, ct))));
    }

    private static async Task<IResult> RequestUpgrade(Guid id, NewUpgradeRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CommercialRecords commercial,
        Platform.Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (me.OrganisationId != id) return Problems.NotFound();
        var cat = await commercial.CatalogueAsync(ct);
        var what = body.AddOn is { } x ? CommercialRules.AddOnDef(cat, x)?.Name ?? x
            : body.Package is { } p ? EntitlementCatalogue.Package(p)?.Name ?? p
            : body.Feature is { } f ? FeatureLabel(f) : "an upgrade";
        var org = await db.Organisations.FirstAsync(o => o.Id == id, ct);

        return await commands.RunAsync(new CommandSpec($"Asked Humo about {what}", "Subscription.Request")
        {
            Resource = "Upgrade request",
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (body.AddOn is not null && CommercialRules.AddOnDef(cat, body.AddOn) is null) e["addOn"] = "No such add-on.";
                if (body.Package is not null && !EntitlementCatalogue.IsPackage(body.Package)) e["package"] = "No such package.";
                if (body.Feature is not null && !EntitlementCatalogue.FeatureKeys.Contains(body.Feature)) e["feature"] = "No such feature.";
                if (body.Source is not ("nudge" or "plan-page")) e["source"] = "Where the request came from.";
                if ((body.Note ?? "").Length > 1000) e["note"] = "Keep it under 1 000 characters.";
                return e;
            },
        }, actor =>
        {
            var r = new UpgradeRequest
            {
                Id = Guid.CreateVersion7(), OrganisationId = id, AddOn = body.AddOn, Package = body.Package, Feature = body.Feature,
                Note = string.IsNullOrWhiteSpace(body.Note) ? null : body.Note.Trim(), Source = body.Source,
                RequestedBy = $"{actor.User.Name} ({Roles.Label(actor.Assignment.Role)})", RequestedById = actor.User.Id, At = clock.GetUtcNow(),
            };
            db.UpgradeRequests.Add(r);
            // Their account manager hears about it; without one, the System Administrators do.
            if (org.AccountManagerId is { } manager)
                notices.ToPerson(manager, actor.Human.Id, $"{org.ShortName} asked about {what}", $"{actor.User.Name} asked from {(body.Source == "nudge" ? "a suggestion in the app" : "Plan & features")}{(r.Note is null ? "." : $": “{r.Note}”")}", $"/platform/customers/{id}");
            else
                notices.ToRole(Roles.SystemAdmin, actor.Human.Id, $"{org.ShortName} asked about {what}", $"{actor.User.Name} asked. They have no account manager yet.", $"/platform/customers/{id}");
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    // ---- Read models ----

    /// <summary>Every customer (or one), with its subscription in force, entitlements, real usage and health.</summary>
    internal static async Task<List<PlatformCustomerDto>> Customers(HumoDbContext db, CommercialRecords commercial, TimeProvider clock, Actor actor, Guid? only, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var cat = await commercial.CatalogueAsync(ct);
        var orgs = await db.Organisations.Where(o => only == null || o.Id == only).ToListAsync(ct);
        var ids = orgs.Select(o => o.Id).ToList();
        var subs = await db.Subscriptions.Where(s => ids.Contains(s.OrganisationId)).ToDictionaryAsync(s => s.OrganisationId, ct);
        var agreements = await db.Agreements.Where(a => ids.Contains(a.OrganisationId)).ToDictionaryAsync(a => a.OrganisationId, ct);
        var schemes = await db.Schemes.Where(s => ids.Contains(s.OrganisationId) && s.Status != "archived").Select(s => new { s.Id, s.OrganisationId }).ToListAsync(ct);
        var schemeOrg = schemes.ToDictionary(s => s.Id, s => s.OrganisationId);
        var units = (await db.Units.Select(u => u.SchemeId).ToListAsync(ct)).Where(schemeOrg.ContainsKey).GroupBy(s => schemeOrg[s]).ToDictionary(g => g.Key, g => g.Count());
        var today = CommercialRules.ParseDay(CommercialRules.Day(now));
        var trustees = (await db.Relationships.Where(r => r.Type == "trustee").Select(r => new { r.SchemeId, r.Until }).ToListAsync(ct))
            .Where(r => schemeOrg.ContainsKey(r.SchemeId) && (r.Until is null || r.Until >= today)).GroupBy(r => schemeOrg[r.SchemeId]).ToDictionary(g => g.Key, g => g.Count());
        var members = (await db.Memberships.Where(m => ids.Contains(m.OrganisationId) && m.Status == MembershipStatuses.Active).Select(m => new { m.UserId, m.OrganisationId }).ToListAsync(ct));
        var memberIds = members.Select(m => m.UserId).Distinct().ToList();
        var since = now - TimeSpan.FromDays(30);
        var signIns = (await db.Audit.Where(e => e.ActorId != null && memberIds.Contains(e.ActorId.Value) && e.Result == "success" && e.Action.StartsWith("Signed in"))
            .Select(e => new { e.ActorId, e.At }).ToListAsync(ct)).Where(e => e.At >= since).ToList();
        var managers = await db.Users.Where(u => u.Kind == IdentityKinds.Humo).ToDictionaryAsync(u => u.Id, u => u.Name, ct);
        var requests = (await db.UpgradeRequests.Where(r => ids.Contains(r.OrganisationId)).ToListAsync(ct)).OrderByDescending(r => r.At).ToList();
        var revenue = actor.Can("Platform.Revenue.View");
        var todayText = CommercialRules.Day(now);
        var overdue = (await db.Invoices.Where(i => ids.Contains(i.OrganisationId) && i.Status == "issued").Select(i => new { i.OrganisationId, i.DueOn }).ToListAsync(ct))
            .Where(i => string.CompareOrdinal(i.DueOn, todayText) < 0).Select(i => i.OrganisationId).ToHashSet();

        var result = new List<PlatformCustomerDto>();
        foreach (var org in orgs.OrderBy(o => o.ShortName, StringComparer.OrdinalIgnoreCase))
        {
            if (!subs.TryGetValue(org.Id, out var sub) || !agreements.TryGetValue(org.Id, out var row)) continue;
            var schemeCount = schemes.Count(s => s.OrganisationId == org.Id);
            var view = commercial.View(sub, CommercialRecords.Read(row), cat, schemeCount);
            // Contract values are for Humo staff with Platform.Revenue.View (docs/23 §3).
            if (!revenue) view = view with { Mrr = 0 };
            var entitlements = EntitlementEngine.Resolve(view, now, CommercialRecords.AddOnFeatures(cat));
            var people = members.Where(m => m.OrganisationId == org.Id).Select(m => m.UserId).ToHashSet();
            var orgSignIns = signIns.Where(e => people.Contains(e.ActorId!.Value)).ToList();
            var active = orgSignIns.Select(e => e.ActorId).Distinct().Count();
            var seats = Math.Max(sub.Seats, people.Count);
            var snapshot = new UsageSnapshotDto(org.Id.ToString(), now.ToString("O"), seats, active, active == 0 ? 0 : Math.Round(orgSignIns.Count / (decimal)active / (30m / 7), 1),
                [], 0, 0, 0, 0, sub.Status == SubscriptionStatuses.Suspended ? "suspended" : overdue.Contains(org.Id) ? "overdue" : "current", schemeCount, units.GetValueOrDefault(org.Id), trustees.GetValueOrDefault(org.Id), 0, 0, 0, 0, 0, []);
            result.Add(new PlatformCustomerDto(org.Id.ToString(), org.ShortName, org.City, org.Province, org.CreatedAt.ToString("O"),
                org.AccountManagerId?.ToString() ?? "", org.AccountManagerId is { } m && managers.TryGetValue(m, out var name) ? name : "Unassigned",
                org.Status, view, entitlements, snapshot, Health(snapshot, entitlements, now), [], requests.Where(r => r.OrganisationId == org.Id).Select(ToDto).ToList(), []));
        }
        return result;
    }

    /// <summary>
    /// Account health from the signals Humo measures today: active users, sign-in activity and payment.
    /// Adoption, workflows, support and dormant areas need the usage pipeline: they're shown as
    /// "Not measured yet" and left out of the score, which is reweighted over what is measured.
    /// </summary>
    private static AccountHealthDto Health(UsageSnapshotDto s, IReadOnlyList<Entitlement> ent, DateTimeOffset now)
    {
        static int Clamp(decimal n) => (int)Math.Max(0, Math.Min(100, Math.Round(n, MidpointRounding.AwayFromZero)));
        const string NotYet = "Not measured yet";
        var signals = new List<HealthSignalDto>
        {
            new("active-users", "Active users", Clamp(s.ActiveUsers30d / (decimal)Math.Max(1, s.Seats) * 110), 0.18m, $"{s.ActiveUsers30d} of {s.Seats} users active in 30 days", true),
            new("logins", "Sign-in activity", Clamp(s.LoginsPerUserWeek / 5 * 100), 0.1m, $"{s.LoginsPerUserWeek:0.0} sign-ins per active user per week", true),
            new("adoption", "Feature adoption", 0, 0.2m, NotYet, false),
            new("workflows", "Workflow completion", 0, 0.14m, NotYet, false),
            new("support", "Support issues", 0, 0.1m, NotYet, false),
            new("utilisation", "Subscription utilisation", 0, 0.1m, NotYet, false),
            new("payment", "Payment status", s.PaymentStatus == "current" ? 100 : s.PaymentStatus == "overdue" ? 40 : 0, 0.1m,
                s.PaymentStatus == "current" ? "Paid up to date" : s.PaymentStatus == "overdue" ? "Invoice overdue" : "Account suspended", true),
            new("dormant", "Dormant areas", 0, 0.08m, NotYet, false),
        };
        var measured = signals.Where(x => x.Measured).ToList();
        var score = Clamp(measured.Sum(x => x.Score * x.Weight) / measured.Sum(x => x.Weight));
        var band = score >= 75 ? "healthy" : score >= 50 ? "at-risk" : "critical";
        var modules = Modules.Select(m => new ModuleAdoptionDto(m, ent.Any(e => e.Feature == ModuleKeyFeature[m] && e.Enabled), 0, false)).ToList();
        return new AccountHealthDto(s.OrganisationId, score, band, signals, modules, [score], now.ToString("O"), true);
    }

    /// <summary>Storage isn't measured until documents are stored by the API (docs/23 §5).</summary>
    /// <summary>
    /// What the agency stores now: every uploaded file, as the upload check counts it (D20). Generated files
    /// (statements, letters) aren't counted yet (docs/18 R-13).
    /// </summary>
    internal static async Task<StorageMeasurement> MeasuredAsync(HumoDbContext db, Guid organisationId, TimeProvider clock, CancellationToken ct)
    {
        var files = await db.UploadedFiles.AsNoTracking().Where(f => f.OrganisationId == organisationId).Select(f => new { f.ContentType, f.SizeBytes }).ToListAsync(ct);
        var images = files.Where(f => f.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)).Sum(f => f.SizeBytes);
        return new(organisationId.ToString(), clock.GetUtcNow().ToString("O"), "measured", files.Sum(f => f.SizeBytes) - images, images, 0);
    }

    internal static UpgradeRequestDto ToDto(UpgradeRequest r) =>
        new(r.Id.ToString(), r.OrganisationId.ToString(), r.AddOn, r.Package, r.RequestedBy, r.At.ToString("O"), r.Note, r.Source, r.Status);

    private static string FeatureLabel(string? key) => EntitlementCatalogue.Features.FirstOrDefault(f => f.Key == key)?.Label ?? key ?? "";

    /// <summary>"Where authorised": without Platform.Customers.AnyAccount, only the accounts you look after (D11).</summary>
    internal static void OwnAccountOnly(Actor actor, Organisation org)
    {
        if (!actor.Can("Platform.Customers.AnyAccount") && org.AccountManagerId != actor.Human.Id) throw new CommandRefused("forbidden", "Not one of your accounts");
    }

    internal static string Approval(Actor actor) =>
        actor.Can("Platform.Customers.AnyAccount") ? "System Administrator" : "Within the Account Manager’s authority for their own customer (D11)";
}
