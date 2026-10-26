using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Humo.Api.Commands;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Commercial;

public sealed record PackageTermsRequest(string EffectiveFrom, decimal? MonthlyPrice, decimal? AnnualPrice, string PriceStatus, decimal? IncludedStorageGb, string StorageStatus,
    int? IncludedSchemes, decimal? ExtraSchemePrice, decimal? AnnualRenewalFee, string Reason, int? ExtraSchemeBlock = null, int? IncludedSms = null);
public sealed record AddOnRequest(string Id, string Name, string? Description, string Kind, List<string>? Features, decimal? StorageGb, bool AllowQuantity, string Status, string? RetiresOn,
    string EffectiveFrom, decimal? Price, string Frequency, string PriceStatus, UsageAllowance? UsageAllowance, string Reason, bool IsNew);
public sealed record SettingsRequest(CommercialSettings Settings, string Reason, int? ExpectedVersion);
public sealed record AgreementChangeRequest(JsonElement Change, int? ExpectedVersion);
public sealed record ApprovalDecisionRequest(string Decision, string? Reason);

public sealed record ScheduledItemDto(string LineId, string Kind, string Label, string From, decimal? MonthlyChange);
public sealed record AccountManagerRefDto(string Id, string Name);
public sealed record CustomerCommercialViewDto(string OrganisationId, string Name, int Schemes, AccountManagerRefDto? AccountManager, CommercialAgreement Agreement, string Today,
    ChargeSummary Current, IReadOnlyList<ScheduledItemDto> Scheduled, StorageSummary Storage, IReadOnlyList<object> Invoices);

/// <summary>
/// Humo's commercial management (docs/23 §2–§5): the priced catalogue, commercial settings, and each
/// customer's agreement with its live preview. Humo staff only; prices need Platform.Revenue.View.
/// Invoices and payments follow (register R-14).
/// </summary>
public static partial class CommercialEndpoints
{
    public static void MapCommercial(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/platform").RequireAuthorization();
        g.MapGet("/commercial/catalogue", Catalogue);
        g.MapPut("/commercial/packages/{packageId}/terms", SavePackageTerms);
        g.MapPut("/commercial/add-ons/{addOnId}", SaveAddOn);
        g.MapPut("/commercial/settings", SaveSettings);
        g.MapGet("/customers/{id:guid}/commercial", Customer);
        g.MapPost("/customers/{id:guid}/agreement/preview", Preview);
        g.MapPost("/customers/{id:guid}/agreement/changes", Change);
        g.MapPost("/customers/{id:guid}/agreement/approvals/{approvalId}", DecideApproval);
    }

    private static async Task<IResult> Catalogue(CurrentActor current, CommercialRecords commercial, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Platform.Revenue.View")) return Problems.Policy("forbidden", "Not permitted to see prices");
        return Results.Ok(await commercial.CatalogueAsync(ct));
    }

    // ---- Catalogue (System Administrators: Platform.Packages.Manage, step-up) ----

    private static async Task<IResult> SavePackageTerms(string packageId, PackageTermsRequest t, CurrentActor current, CommandRunner commands, CommercialRecords commercial, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var cat = await commercial.CatalogueAsync(ct);
        var pkg = CommercialRules.PackageDef(cat, packageId);
        if (pkg is null) return Problems.NotFound();
        var name = EntitlementCatalogue.Package(packageId)?.Name ?? packageId;
        var today = commercial.Today;

        return await commands.RunAsync(new CommandSpec($"Set {name} terms from {t.EffectiveFrom}: {Rand(t.MonthlyPrice)} a month ({t.PriceStatus}), {(t.IncludedStorageGb is { } gb ? $"{gb} GB" : "negotiated storage")} — {t.Reason?.Trim()}", "Platform.Packages.Manage")
        {
            Resource = "Package",
            ResourceId = packageId,
            Category = "security",
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (!CommercialRules.IsDay(t.EffectiveFrom)) e["effectiveFrom"] = "Choose the date these terms take effect.";
                else if (string.CompareOrdinal(t.EffectiveFrom, today) < 0) e["effectiveFrom"] = "Terms can’t start in the past: invoices already issued keep their prices.";
                foreach (var (key, value) in new (string, decimal?)[] { ("monthlyPrice", t.MonthlyPrice), ("annualPrice", t.AnnualPrice), ("includedStorageGb", t.IncludedStorageGb), ("includedSchemes", t.IncludedSchemes), ("extraSchemePrice", t.ExtraSchemePrice), ("annualRenewalFee", t.AnnualRenewalFee) })
                    if (value < 0) e[key] = "A number of zero or more, or leave it empty.";
                if (t.ExtraSchemeBlock is < 1 or > 100) e["extraSchemeBlock"] = "Between 1 and 100 schemes per block.";
                if (t.IncludedSms is < 0 or > 100_000) e["includedSms"] = "SMS a month: zero or more.";
                if (!PriceStatuses.All.Contains(t.PriceStatus)) e["priceStatus"] = "Awaiting, proposed or approved.";
                else if (t.PriceStatus != PriceStatuses.Awaiting && t.MonthlyPrice is null) e["monthlyPrice"] = "A proposed or approved price needs an amount.";
                if (!PriceStatuses.All.Contains(t.StorageStatus)) e["storageStatus"] = "Awaiting, proposed or approved.";
                if ((t.Reason ?? "").Trim().Length < 8) e["reason"] = "Say why, in a few words. It goes in the audit log.";
                return e;
            },
        }, async actor =>
        {
            var version = pkg.Terms.Select(x => x.Version).DefaultIfEmpty(0).Max() + 1;
            // Terms from the same date are replaced (a correction); otherwise they're a new version from that date.
            pkg.Terms = pkg.Terms.Where(x => x.EffectiveFrom != t.EffectiveFrom)
                .Append(new PackageTerms
                {
                    Version = version, EffectiveFrom = t.EffectiveFrom, MonthlyPrice = t.MonthlyPrice, AnnualPrice = t.AnnualPrice, PriceStatus = t.PriceStatus,
                    IncludedStorageGb = t.IncludedStorageGb, StorageStatus = t.StorageStatus, IncludedSchemes = t.IncludedSchemes, ExtraSchemePrice = t.ExtraSchemePrice, ExtraSchemeBlock = t.ExtraSchemeBlock,
                    AnnualRenewalFee = t.AnnualRenewalFee, IncludedSms = t.IncludedSms, ChangedBy = actor.Human.Name, ChangedAt = clock.GetUtcNow().ToString("O"), Reason = t.Reason!.Trim(),
                })
                .OrderByDescending(x => x.EffectiveFrom, StringComparer.Ordinal).ToList();
            await commercial.SaveCatalogueAsync(cat, ct);
            return Results.NoContent();
        }, ct);
    }

    private static async Task<IResult> SaveAddOn(string addOnId, AddOnRequest a, CurrentActor current, CommandRunner commands, CommercialRecords commercial, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var cat = await commercial.CatalogueAsync(ct);
        var existing = CommercialRules.AddOnDef(cat, a.Id);
        var today = commercial.Today;
        var features = a.Features ?? [];

        return await commands.RunAsync(new CommandSpec($"{(a.IsNew ? "Created the add-on" : "Updated the add-on")} {a.Name?.Trim()}: {Rand(a.Price)} {a.Frequency} from {a.EffectiveFrom} ({a.PriceStatus}) — {a.Reason?.Trim()}", "Platform.Packages.Manage")
        {
            Resource = "Add-on",
            ResourceId = a.Id,
            Category = "security",
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (a.Id != addOnId) e["id"] = "The add-on in the address and the form differ.";
                else if (a.IsNew && !AddOnId().IsMatch(a.Id ?? "")) e["id"] = "Lower-case letters, numbers and dashes, e.g. sms-bundle.";
                else if (a.IsNew && existing is not null) e["id"] = "An add-on with this id already exists.";
                else if (!a.IsNew && existing is null) e["id"] = "No such add-on.";
                if (string.IsNullOrWhiteSpace(a.Name)) e["name"] = "Give it a name customers will recognise.";
                if (a.Kind is not ("feature" or "storage" or "communication")) e["kind"] = "Feature, storage or communication.";
                if (features.Count == 0 && a.Kind != "storage") e["features"] = "Choose the features it switches on.";
                if (features.Any(f => !EntitlementCatalogue.FeatureKeys.Contains(f))) e["features"] = "Only features the app knows can be sold.";
                if (a.Kind == "storage" && !(a.StorageGb > 0)) e["storageGb"] = "How many GB does one pack add?";
                if (a.Status is not (CatalogueStatuses.Draft or CatalogueStatuses.Active or CatalogueStatuses.Retired)) e["status"] = "Draft, active or retired.";
                if (a.RetiresOn is { Length: > 0 } r && !CommercialRules.IsDay(r)) e["retiresOn"] = "A date, or leave it empty.";
                if (!CommercialRules.IsDay(a.EffectiveFrom) || (string.CompareOrdinal(a.EffectiveFrom, today) < 0 && !a.IsNew)) e["effectiveFrom"] = "Today or later: invoices already issued keep their prices.";
                if (a.Frequency is not ("monthly" or "annual" or "once-off")) e["frequency"] = "Monthly, annual or once-off.";
                if (a.Price < 0) e["price"] = "Zero or more, or leave it empty.";
                if (!PriceStatuses.All.Contains(a.PriceStatus)) e["priceStatus"] = "Awaiting, proposed or approved.";
                else if (a.PriceStatus != PriceStatuses.Awaiting && a.Price is null) e["price"] = "A proposed or approved price needs an amount.";
                if ((a.Reason ?? "").Trim().Length < 8) e["reason"] = "Say why, in a few words. It goes in the audit log.";
                return e;
            },
        }, async actor =>
        {
            var version = (existing?.Terms ?? []).Select(x => x.Version).DefaultIfEmpty(0).Max() + 1;
            var terms = new AddOnTerms
            {
                Version = version, EffectiveFrom = a.EffectiveFrom, Price = a.Price, Frequency = a.Frequency, PriceStatus = a.PriceStatus, UsageAllowance = a.UsageAllowance,
                ChangedBy = actor.Human.Name, ChangedAt = clock.GetUtcNow().ToString("O"), Reason = a.Reason!.Trim(),
            };
            var next = new CommercialAddOn
            {
                Id = a.Id, Name = a.Name!.Trim(), Description = (a.Description ?? "").Trim(), Kind = a.Kind, Features = features,
                StorageGb = a.Kind == "storage" ? a.StorageGb : null, AllowQuantity = a.AllowQuantity, Status = a.Status,
                RetiresOn = string.IsNullOrWhiteSpace(a.RetiresOn) ? null : a.RetiresOn,
                Terms = (existing?.Terms ?? []).Where(x => x.EffectiveFrom != a.EffectiveFrom).Append(terms).OrderByDescending(x => x.EffectiveFrom, StringComparer.Ordinal).ToList(),
            };
            cat.AddOns = existing is null ? [.. cat.AddOns, next] : cat.AddOns.Select(x => x.Id == a.Id ? next : x).ToList();
            await commercial.SaveCatalogueAsync(cat, ct);
            return Results.NoContent();
        }, ct);
    }

    private static async Task<IResult> SaveSettings(SettingsRequest body, CurrentActor current, CommandRunner commands, CommercialRecords commercial, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var cat = await commercial.CatalogueAsync(ct);
        var s = body.Settings ?? new CommercialSettings();
        var thresholds = s.StorageThresholds ?? [];
        var designated = Guid.TryParse(s.DesignatedAccountManagerId, out var am) && await Platform.HumoTeamRules.IsActiveAccountManager(db, am, ct);

        return await commands.RunAsync(new CommandSpec($"Changed commercial settings (warnings at {string.Join("% and ", thresholds)}%, {s.Proration} proration, VAT {(s.Tax?.VatRegistered == true ? $"registered at {s.Tax.RatePercent}%" : "not charged")}) — {body.Reason?.Trim()}", "Platform.Config.Manage")
        {
            Resource = "Commercial settings",
            Category = "security",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = cat.Settings.Version,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (thresholds.Length != 2 || !(thresholds[0] > 0 && thresholds[0] < thresholds[1] && thresholds[1] < 100)) e["storageThresholds"] = "The first warning must come before the second, both below 100%.";
                if (s.Proration is not (ProrationPolicies.NextCycle or ProrationPolicies.Daily)) e["proration"] = "Next billing cycle or daily pro-rata.";
                if (s.Tax is null || string.IsNullOrWhiteSpace(s.Tax.LegalName)) e["legalName"] = "Humo’s legal name, as it goes on invoices.";
                else
                {
                    if (s.Tax.VatRegistered && string.IsNullOrWhiteSpace(s.Tax.VatNumber)) e["vatNumber"] = "A VAT-registered Humo needs its VAT number on invoices.";
                    if (!(s.Tax.RatePercent >= 0 && s.Tax.RatePercent <= 100)) e["ratePercent"] = "A percentage between 0 and 100.";
                }
                if (!designated) e["designatedAccountManagerId"] = "Choose an active Humo Account Manager.";
                if (!(s.PaymentTermsDays >= 0 && s.PaymentTermsDays <= 60)) e["paymentTermsDays"] = "Between 0 and 60 days.";
                if ((body.Reason ?? "").Trim().Length < 8) e["reason"] = "Say why, in a few words. It goes in the audit log.";
                return e;
            },
        }, async _ =>
        {
            await commercial.SaveSettingsAsync(s, ct);
            return Results.NoContent();
        }, ct);
    }

    // ---- A customer's agreement (Account Managers for their own customers, or System Administrators; D11) ----

    private static async Task<IResult> Customer(Guid id, CurrentActor current, HumoDbContext db, CommercialRecords commercial, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        // Prices and contract values are for Humo staff with Platform.Revenue.View only.
        if (!actor.Can("Platform.Revenue.View")) return Problems.Policy("forbidden", "Not permitted to see commercial terms");
        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == id, ct);
        if (org is null || await commercial.AgreementAsync(id, ct) is not { } rec) return Problems.NotFound();
        var cat = await commercial.CatalogueAsync(ct);
        var schemes = await Schemes(db, id, ct);
        var a = rec.Agreement;
        var today = commercial.Today;
        var manager = org.AccountManagerId is { } m ? await db.Users.Where(u => u.Id == m).Select(u => new AccountManagerRefDto(u.Id.ToString(), u.Name)).FirstOrDefaultAsync(ct) : null;
        string DayBefore(string d) => CommercialRules.Day(CommercialRules.ParseDay(d).AddDays(-1));
        decimal Change(string d) => CommercialRules.ChargesOn(a, d, cat, schemes).RecurringMonthly - CommercialRules.ChargesOn(a, DayBefore(d), cat, schemes).RecurringMonthly;
        string Name(string addOn) => CommercialRules.AddOnDef(cat, addOn)?.Name ?? addOn;
        var scheduled = a.Packages.Where(l => string.CompareOrdinal(l.From, today) > 0)
                .Select(l => new ScheduledItemDto(l.Id, "package", $"Move to {EntitlementCatalogue.Package(l.PackageId)?.Name ?? l.PackageId} at {Rand(l.MonthlyPrice)} a month", l.From, Change(l.From)))
            .Concat(a.AddOns.Where(l => string.CompareOrdinal(l.From, today) > 0)
                .Select(l => new ScheduledItemDto(l.Id, "add-on", $"Add {Name(l.AddOnId)}{(l.Quantity > 1 ? $" × {l.Quantity}" : "")} at {Rand(l.UnitPrice)} {(l.Frequency == "annual" ? "a year" : "a month")}", l.From, Change(l.From))))
            .Concat(CommercialRules.InForce(a.AddOns, today).Where(l => l.Until is not null)
                .Select(l => new ScheduledItemDto(l.Id, "removal", $"Remove {Name(l.AddOnId)}", l.Until!, Change(l.Until!))))
            .OrderBy(x => x.From, StringComparer.Ordinal).ToList();
        var invoices = await db.Invoices.Where(i => i.OrganisationId == id).ToListAsync(ct);
        var payments = (await db.Payments.Where(p => p.OrganisationId == id).ToListAsync(ct)).ToLookup(p => p.InvoiceId);
        return Results.Ok(new CustomerCommercialViewDto(id.ToString(), org.ShortName, schemes, manager, a, today, CommercialRules.ChargesOn(a, today, cat, schemes), scheduled,
            CommercialRules.Storage(a, cat, await CustomerEndpoints.MeasuredAsync(db, id, clock, ct), today),
            invoices.OrderByDescending(i => i.PeriodStart, StringComparer.Ordinal).Select(i => (object)BillingEndpoints.ToCustomerInvoice(i, payments[i.Id], today)).ToList()));
    }

    /// <summary>The effect of a change, before and after. Nothing is saved.</summary>
    private static async Task<IResult> Preview(Guid id, AgreementChangeRequest body, CurrentActor current, HumoDbContext db, CommercialRecords commercial, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Platform.Revenue.View")) return Problems.Policy("forbidden", "Not permitted to see commercial terms");
        if (await commercial.AgreementAsync(id, ct) is not { } rec) return Problems.NotFound();
        var change = AgreementChange.Parse(body.Change);
        return Results.Ok(CommercialRules.Preview(rec.Agreement, change, await commercial.CatalogueAsync(ct), await Schemes(db, id, ct), clock.GetUtcNow()));
    }

    private static async Task<IResult> Change(Guid id, AgreementChangeRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CommercialRecords commercial, Platform.Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == id, ct);
        if (org is null || await commercial.AgreementAsync(id, ct) is not { } rec) return Problems.NotFound();
        var cat = await commercial.CatalogueAsync(ct);
        var schemes = await Schemes(db, id, ct);
        var change = AgreementChange.Parse(body.Change);
        var today = commercial.Today;
        var describe = Describe(change, rec.Agreement, cat, schemes, clock.GetUtcNow());

        return await commands.RunAsync(new CommandSpec($"{describe} for {org.ShortName} — {change.Reason?.Trim()}", "Platform.Subscriptions.Manage")
        {
            Resource = "Agreement",
            ResourceId = id.ToString(),
            Category = "security",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = rec.Agreement.Version,
            Validate = () => CommercialRules.CheckChange(rec.Agreement, change, cat, today),
        }, actor =>
        {
            CustomerEndpoints.OwnAccountOnly(actor, org);
            var by = new ChangeActor(actor.Human.Id.ToString(), actor.Human.Name, CustomerEndpoints.Approval(actor));
            if (CommercialRules.ApprovalNeeded(rec.Agreement, change, cat, schemes) is { } why)
            {
                // A large discount waits for a second approver (doc 17, D15): recorded, not in force.
                var next = rec.Agreement.Clone();
                var at = clock.GetUtcNow().ToString("O");
                next.PendingApprovals.Add(new PendingApproval { Id = CommercialRecords.NewLineId("apv"), Change = change, Describe = describe, RequestedById = by.Id, RequestedBy = by.Name, At = at, Why = why });
                next.History.Insert(0, new AgreementEvent { At = at, ById = by.Id, By = by.Name, Action = $"Asked for approval: {describe}", Reason = (change.Reason ?? "").Trim(), Approval = $"Waiting for a second approver: {why}" });
                next.Version++;
                CommercialRecords.Write(rec.Row, next);
                notices.ToRole(Roles.HumoFinance, actor.Human.Id, $"Discount waiting for approval: {org.ShortName}", $"{by.Name} asked for {describe.ToLowerInvariant()} ({why}).", $"/platform/customers/{id}?view=commercial");
                return Task.FromResult(Results.Accepted($"/api/platform/customers/{id}/commercial", new { status = "waiting-for-approval" }));
            }
            CommercialRecords.Write(rec.Row, CommercialRules.ApplyChange(rec.Agreement, change, cat, by, clock.GetUtcNow(), describe, CommercialRecords.NewLineId));
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>
    /// The second approver (Platform.Discounts.Approve, step-up), never the person who asked. Approving
    /// re-checks the change against the agreement as it is now and applies it; declining needs a reason.
    /// </summary>
    private static async Task<IResult> DecideApproval(Guid id, string approvalId, ApprovalDecisionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db,
        CommercialRecords commercial, Platform.Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == id, ct);
        if (org is null || await commercial.AgreementAsync(id, ct) is not { } rec) return Problems.NotFound();
        var p = rec.Agreement.PendingApprovals.FirstOrDefault(x => x.Id == approvalId);
        if (p is null) return Problems.NotFound();
        var cat = await commercial.CatalogueAsync(ct);
        var approve = body.Decision == "approve";
        var reason = (body.Reason ?? "").Trim();

        return await commands.RunAsync(new CommandSpec($"{(approve ? "Approved" : "Declined")}: {p.Describe} for {org.ShortName}{(reason.Length > 0 ? $" — {reason}" : "")}", "Platform.Discounts.Approve")
        {
            Resource = "Agreement",
            ResourceId = id.ToString(),
            OrganisationId = id,
            Category = "security",
            Validate = () =>
            {
                if (body.Decision is not ("approve" or "decline")) return new() { ["decision"] = "Approve or decline." };
                if (!approve && reason.Length < 5) return new() { ["reason"] = "Say why, in a few words. The person who asked sees it." };
                return approve ? CommercialRules.CheckChange(rec.Agreement, p.Change, cat, commercial.Today) : [];
            },
        }, actor =>
        {
            if (p.RequestedById == actor.Human.Id.ToString()) throw new CommandRefused("forbidden", "Someone else approves a change you asked for");
            var rest = rec.Agreement.Clone();
            rest.PendingApprovals.RemoveAll(x => x.Id == approvalId);
            var now = clock.GetUtcNow();
            CommercialAgreement next;
            if (approve)
                next = CommercialRules.ApplyChange(rest, p.Change, cat, new ChangeActor(actor.Human.Id.ToString(), actor.Human.Name, $"Approved by {actor.Human.Name} (second approver: {p.Why})"), now, p.Describe, CommercialRecords.NewLineId);
            else
            {
                next = rest;
                next.Version++;
                next.History.Insert(0, new AgreementEvent { At = now.ToString("O"), ById = actor.Human.Id.ToString(), By = actor.Human.Name, Action = $"Declined: {p.Describe}", Reason = reason, Approval = "Second approver" });
            }
            CommercialRecords.Write(rec.Row, next);
            if (Guid.TryParse(p.RequestedById, out var asker))
                notices.ToPerson(asker, actor.Human.Id, $"{(approve ? "Approved" : "Declined")}: {p.Describe}", approve ? $"{actor.Human.Name} approved it for {org.ShortName}." : $"{actor.Human.Name} declined it for {org.ShortName}: {reason}", $"/platform/customers/{id}?view=commercial");
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    // ---- Helpers ----

    private static Task<int> Schemes(HumoDbContext db, Guid organisationId, CancellationToken ct) =>
        db.Schemes.CountAsync(s => s.OrganisationId == organisationId && s.Status != "archived", ct);

    /// <summary>The audit line and the agreement history's description of a change.</summary>
    private static string Describe(AgreementChange c, CommercialAgreement a, CommercialCatalogue cat, int schemes, DateTimeOffset now)
    {
        var today = CommercialRules.Day(now);
        string Name(string? id) => CommercialRules.AddOnDef(cat, id ?? "")?.Name ?? id ?? "";
        string When(string? d) => string.CompareOrdinal(d, today) > 0 ? $" from {d}" : "";
        switch (c.Type)
        {
            case "package":
            {
                var p = CommercialRules.Preview(a, c, cat, schemes, now).After.Recurring.FirstOrDefault(l => l.Kind == "package");
                return $"Changed package to {EntitlementCatalogue.Package(c.PackageId ?? "")?.Name ?? c.PackageId} at {Rand(p?.Amount)} a month{When(c.EffectiveFrom)}";
            }
            case "add-on":
            {
                var price = c.UnitPriceGiven ? c.UnitPrice : CommercialRules.Preview(a, c, cat, schemes, now).After.Recurring.LastOrDefault(l => l.Kind == "add-on")?.UnitPrice;
                return $"{(string.CompareOrdinal(c.EffectiveFrom, today) > 0 ? "Scheduled" : "Added")} the {Name(c.AddOnId)} add-on{(c.Quantity > 1 ? $" × {c.Quantity}" : "")} at {Rand(price)} a month{When(c.EffectiveFrom)}{(c.UnitPriceGiven ? " (agreed price)" : "")}";
            }
            case "remove-add-on": return $"Removed the {Name(c.AddOnId)} add-on{When(c.EffectiveFrom)}";
            case "cancel-scheduled": return "Cancelled a scheduled change";
            case "adjustment":
                var kind = c.Kind switch { "discount" => "recurring discount", "credit" => "credit", _ => "once-off fee" };
                return $"Added a {kind} “{c.Label?.Trim()}” of {(c.Percent is { } pct ? $"{pct.ToString("0.##", CultureInfo.InvariantCulture)}%" : Rand(c.Amount))}";
            case "billing-preference":
                var label = c.Preference switch { BillingPreferences.CardRecurring => "Recurring card payment", BillingPreferences.InstantEft => "Online bank payment (Instant EFT)", _ => "Manual EFT" };
                return $"Set the billing preference to {label} (invoices to {c.BillingEmail?.Trim()})";
            case "storage-exception": return $"Granted {c.ExtraGb} GB of extra storage until {c.Until} (exception)";
            case "renewal": return c.Fee is > 0 ? $"Set the annual renewal fee to {Rand(c.Fee)}, next renewal {c.On}" : $"Removed the annual renewal fee; next renewal {c.On}";
            default: return "Changed the agreement";
        }
    }

    /// <summary>"R1 850" for the audit log; "a price to be agreed" when there's none.</summary>
    internal static string Rand(decimal? n) =>
        n is not { } v ? "a price to be agreed" : "R" + v.ToString(v == Math.Floor(v) ? "#,0" : "#,0.00", new NumberFormatInfo { NumberGroupSeparator = " ", NumberDecimalSeparator = "," });

    [GeneratedRegex(@"^[a-z0-9]+(-[a-z0-9]+)*$")]
    private static partial Regex AddOnId();
}
