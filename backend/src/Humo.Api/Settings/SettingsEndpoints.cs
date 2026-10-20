using System.Text.Json;
using System.Text.RegularExpressions;
using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Settings;

public sealed record AgencyDetailsDto(string Name, string ShortName, string RegistrationNumber, string? VatNumber, string? FfcNumber, string Address, string City, string Province,
    string Email, string Phone);
public sealed record BillingSettingsDto(decimal InterestRate, int BillingDay, int DueDay, int StepDays, int AgmMonths);
public sealed record NotificationRuleDto(string Event, bool Enabled, List<string> Channels);
public sealed record AgencySettingsDto(string OrganisationId, int Version, AgencyDetailsDto Details, BillingSettingsDto Billing, List<NotificationRuleDto> Notifications);
public sealed record DetailsRequest(AgencyDetailsDto Details, int? ExpectedVersion);
public sealed record BillingRequest(BillingSettingsDto Billing, int? ExpectedVersion);
public sealed record NotificationsRequest(List<NotificationRuleDto> Rules, int? ExpectedVersion);
public sealed record TrustAccountDto(string Bank, string AccountName, string AccountNumber, string BranchCode);
public sealed record SchemeTrustAccountDto(SchemeDto Scheme, TrustAccountDto Account, bool Verified);
public sealed record PreferencesDto(string IdentityId, int Version, List<string> Work, string Digest, string? QuietFrom, string? QuietTo);
public sealed record PreferencesRequest(List<string> Work, string Digest, string? QuietFrom, string? QuietTo, int? ExpectedVersion);

/// <summary>
/// Settings (docs/18 §settings): the agency's details, billing configuration and notification rules,
/// each scheme's trust account, and each person's own preferences. The rules billing and statements
/// follow are read from here (interest from the organisation, the due day from the billing settings).
/// </summary>
public static partial class SettingsEndpoints
{
    /// <summary>
    /// The notification events and the channels each may use: the same table as NOTIFICATION_EVENTS in the app
    /// (settings.ts). Collection letters are required: they always go by the letter's own channel.
    /// </summary>
    internal static readonly IReadOnlyDictionary<string, (string Label, string[] Channels, bool Required)> Events = new Dictionary<string, (string, string[], bool)>
    {
        ["payment-received"] = ("Payment received", ["email", "sms", "portal"], false),
        ["statement-issued"] = ("Statement issued", ["email", "portal"], false),
        ["job-updated"] = ("Request updated", ["email", "sms", "whatsapp", "portal"], false),
        ["notice-published"] = ("New notice", ["email", "sms", "whatsapp", "portal"], false),
        ["document-published"] = ("New document", ["email", "portal"], false),
        ["collection-letter"] = ("Collection letters", ["email", "sms", "portal"], true),
        ["approval-waiting"] = ("Approval waiting", ["email", "push", "portal"], false),
        ["compliance-due"] = ("Compliance due", ["email", "push"], false),
    };

    private static readonly string[] Channels = ["email", "sms", "whatsapp", "portal", "push"];

    public static void MapSettings(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/settings").RequireAuthorization();
        g.MapGet("/agency", Agency);
        g.MapPut("/agency/details", UpdateDetails);
        g.MapPut("/agency/billing", UpdateBilling);
        g.MapPut("/agency/notifications", UpdateNotifications);
        g.MapGet("/trust-accounts", TrustAccounts);
        g.MapPut("/trust-accounts/{schemeId:guid}", UpdateTrustAccount);
        var me = api.MapGroup("/me").RequireAuthorization();
        me.MapGet("/preferences", Preferences);
        me.MapPut("/preferences", UpdatePreferences);
    }

    private static async Task<IResult> Agency(CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } orgId }) return Problems.NotFound();
        var org = await db.Organisations.FirstAsync(o => o.Id == orgId, ct);
        var row = await db.AgencySettings.FirstOrDefaultAsync(s => s.OrganisationId == orgId, ct);
        return Results.Ok(ToDto(org, row));
    }

    internal static AgencySettingsDto ToDto(Organisation org, AgencySetting? s) => new(
        org.Id.ToString(), s?.Version ?? 0,
        new AgencyDetailsDto(org.Name, org.ShortName, s?.RegistrationNumber ?? "", s?.VatNumber, s?.FfcNumber, s?.Address ?? "", org.City, org.Province, s?.Email ?? "", s?.Phone ?? ""),
        new BillingSettingsDto(org.InterestPercentPerMonth, s?.BillingDay ?? 25, s?.DueDay ?? 7, s?.StepDays ?? 14, s?.AgmMonths ?? 4),
        // No rules saved: the app fills in Humo's defaults from its event table.
        s?.NotificationsJson is { } json ? JsonSerializer.Deserialize<List<NotificationRuleDto>>(json, Json.Options) ?? [] : []);

    private static async Task<IResult> UpdateDetails(DetailsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } orgId }) return Problems.NotFound();
        var org = await db.Organisations.FirstAsync(o => o.Id == orgId, ct);
        var row = await db.AgencySettings.FirstOrDefaultAsync(s => s.OrganisationId == orgId, ct);
        var d = body.Details;
        return await commands.RunAsync(new CommandSpec("Updated the agency’s details", "Organisation.Manage")
        {
            Resource = "Organisation",
            ResourceId = orgId.ToString(),
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = row?.Version ?? 0,
            Validate = () => CheckDetails(d),
        }, actor =>
        {
            if (row is null) db.AgencySettings.Add(row = new AgencySetting { OrganisationId = orgId, Version = 0 });
            org.Name = d.Name.Trim();
            org.ShortName = d.ShortName.Trim();
            org.City = (d.City ?? "").Trim();
            org.Province = (d.Province ?? "").Trim();
            org.Version++;
            row.RegistrationNumber = d.RegistrationNumber.Trim();
            row.VatNumber = string.IsNullOrWhiteSpace(d.VatNumber) ? null : d.VatNumber.Trim();
            row.FfcNumber = string.IsNullOrWhiteSpace(d.FfcNumber) ? null : d.FfcNumber.Trim();
            row.Address = (d.Address ?? "").Trim();
            row.Email = d.Email.Trim();
            row.Phone = d.Phone.Trim();
            Touch(row, actor, clock);
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    internal static Dictionary<string, string> CheckDetails(AgencyDetailsDto? d)
    {
        var e = new Dictionary<string, string>();
        if (d is null) return new() { ["name"] = "The registered name." };
        if ((d.Name ?? "").Trim().Length < 3) e["name"] = "The registered name.";
        if ((d.ShortName ?? "").Trim().Length < 2) e["shortName"] = "The name people know you by.";
        if (!CipcNumber().IsMatch((d.RegistrationNumber ?? "").Trim())) e["registrationNumber"] = "A CIPC number like 2009/012345/07.";
        if (!string.IsNullOrWhiteSpace(d.VatNumber) && !VatNumber().IsMatch(d.VatNumber.Trim())) e["vatNumber"] = "A VAT number is 10 digits starting with 4.";
        if (!IsEmail(d.Email)) e["email"] = "An email address owners can reply to.";
        if (Digits(d.Phone) < 10) e["phone"] = "A phone number with area code.";
        return e;
    }

    private static async Task<IResult> UpdateBilling(BillingRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } orgId }) return Problems.NotFound();
        var org = await db.Organisations.FirstAsync(o => o.Id == orgId, ct);
        var row = await db.AgencySettings.FirstOrDefaultAsync(s => s.OrganisationId == orgId, ct);
        var b = body.Billing ?? new BillingSettingsDto(-1, 0, 0, 0, 0);
        var before = ToDto(org, row).Billing;
        var changes = new List<string>();
        void Diff<T>(string name, T was, T now) { if (!Equals(was, now)) changes.Add($"{name} {was} → {now}"); }
        Diff("interestRate", before.InterestRate, b.InterestRate);
        Diff("billingDay", before.BillingDay, b.BillingDay);
        Diff("dueDay", before.DueDay, b.DueDay);
        Diff("stepDays", before.StepDays, b.StepDays);
        Diff("agmMonths", before.AgmMonths, b.AgmMonths);
        return await commands.RunAsync(new CommandSpec($"Changed billing configuration{(changes.Count > 0 ? ": " + string.Join(", ", changes) : "")}", "Billing.Run")
        {
            Resource = "Organisation",
            ResourceId = orgId.ToString(),
            Feature = "billing",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = row?.Version ?? 0,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (!(b.InterestRate >= 0 && b.InterestRate <= 5)) e["interestRate"] = "Between 0% and 5% a month. Check the scheme rules and the law on interest.";
                if (b.BillingDay is < 1 or > 28) e["billingDay"] = "A day from 1 to 28.";
                if (b.DueDay is < 1 or > 28) e["dueDay"] = "A day from 1 to 28.";
                if (b.StepDays is < 7 or > 60) e["stepDays"] = "Between 7 and 60 days: owners need time to respond.";
                if (b.AgmMonths is < 1 or > 6) e["agmMonths"] = "Between 1 and 6 months.";
                return e;
            },
        }, actor =>
        {
            if (row is null) db.AgencySettings.Add(row = new AgencySetting { OrganisationId = orgId, Version = 0 });
            // Billing runs read the interest rate from the organisation (slice 2b).
            org.InterestPercentPerMonth = b.InterestRate;
            row.BillingDay = b.BillingDay;
            row.DueDay = b.DueDay;
            row.StepDays = b.StepDays;
            row.AgmMonths = b.AgmMonths;
            Touch(row, actor, clock);
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> UpdateNotifications(NotificationsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } orgId }) return Problems.NotFound();
        var row = await db.AgencySettings.FirstOrDefaultAsync(s => s.OrganisationId == orgId, ct);
        var rules = body.Rules ?? [];
        return await commands.RunAsync(new CommandSpec("Changed the agency’s notification rules", "Notifications.Configure")
        {
            Resource = "Organisation",
            ResourceId = orgId.ToString(),
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = row?.Version ?? 0,
            Validate = () => CheckRules(rules),
        }, actor =>
        {
            if (row is null) db.AgencySettings.Add(row = new AgencySetting { OrganisationId = orgId, Version = 0 });
            var saved = rules.Select(r => new NotificationRuleDto(r.Event, r.Enabled, r.Channels.Distinct().ToList())).ToList();
            row.NotificationsJson = JsonSerializer.Serialize(saved, Json.Options);
            Touch(row, actor, clock);
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    internal static Dictionary<string, string> CheckRules(List<NotificationRuleDto> rules)
    {
        if (rules.Select(r => r.Event).Distinct().Count() != rules.Count) return new() { ["rules"] = "Each notification appears once." };
        foreach (var r in rules)
        {
            if (!Events.TryGetValue(r.Event ?? "", out var def)) return new() { ["rules"] = "Unknown notification." };
            var channels = r.Channels ?? [];
            if (def.Required && !r.Enabled) return new() { [r.Event!] = $"{def.Label} can’t be switched off." };
            if (r.Enabled && channels.Count == 0) return new() { [r.Event!] = $"Choose at least one channel for {def.Label.ToLowerInvariant()}, or switch it off." };
            if (channels.Any(c => !def.Channels.Contains(c))) return new() { [r.Event!] = $"{def.Label} can’t go by that channel." };
        }
        return [];
    }

    private static async Task<IResult> TrustAccounts(string[]? schemeIds, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var ids = (schemeIds ?? []).Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToList();
        var schemes = await SchemeEndpoints.Visible(actor, db).Where(s => ids.Contains(s.Id)).ToListAsync(ct);
        var rows = await db.TrustAccounts.Where(t => ids.Contains(t.SchemeId)).ToDictionaryAsync(t => t.SchemeId, ct);
        var dtos = await SchemeEndpoints.ToDtos(schemes, db, ct);
        return Results.Ok(dtos.Select(s =>
        {
            var row = rows.GetValueOrDefault(Guid.Parse(s.Id));
            return new SchemeTrustAccountDto(s, ToDto(row), row?.Verified ?? false);
        }).ToList());
    }

    internal static TrustAccountDto ToDto(TrustAccountRow? t) => new(t?.Bank ?? "", t?.AccountName ?? "", t?.AccountNumber ?? "", t?.BranchCode ?? "");

    /// <summary>Bank details owners pay into: a fresh passkey, always, and the change is a security event. A changed account needs the bank's confirmation again.</summary>
    private static async Task<IResult> UpdateTrustAccount(Guid schemeId, TrustAccountDto body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(s => s.Id == schemeId, ct) is not { } scheme) return Problems.NotFound();
        var row = await db.TrustAccounts.FirstOrDefaultAsync(t => t.SchemeId == schemeId, ct);
        var number = (body.AccountNumber ?? "").Replace(" ", "");
        return await commands.RunAsync(new CommandSpec($"Changed the trust account for {scheme.Name} to {body.Bank?.Trim()} ····{(number.Length >= 4 ? number[^4..] : number)}", "Organisation.Manage")
        {
            Resource = "Scheme",
            ResourceId = schemeId.ToString(),
            SchemeId = schemeId,
            StepUp = true,
            Category = "security",
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if ((body.Bank ?? "").Trim().Length < 3) e["bank"] = "Which bank?";
                if ((body.AccountName ?? "").Trim().Length < 5) e["accountName"] = "The account name as the bank has it.";
                if (!AccountNumber().IsMatch(number)) e["accountNumber"] = "An account number of 7 to 12 digits.";
                if (!BranchCode().IsMatch((body.BranchCode ?? "").Replace(" ", ""))) e["branchCode"] = "A 6-digit branch code.";
                return e;
            },
        }, actor =>
        {
            if (row is null) db.TrustAccounts.Add(row = new TrustAccountRow { SchemeId = schemeId, Version = 0 });
            var changed = row.AccountNumber != number || row.BranchCode != (body.BranchCode ?? "").Replace(" ", "");
            row.Bank = (body.Bank ?? "").Trim();
            row.AccountName = (body.AccountName ?? "").Trim();
            row.AccountNumber = number;
            row.BranchCode = (body.BranchCode ?? "").Replace(" ", "");
            if (changed) row.Verified = false;
            row.Version++;
            row.UpdatedBy = actor.Human.Name;
            row.UpdatedAt = clock.GetUtcNow();
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> Preferences(CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var row = await db.PersonalPreferences.FirstOrDefaultAsync(p => p.UserId == actor.Human.Id, ct);
        return Results.Ok(ToDto(actor.Human.Id, row));
    }

    private static PreferencesDto ToDto(Guid userId, PersonalPreference? p) =>
        new(userId.ToString(), p?.Version ?? 0, (p?.Work ?? "email,portal").Split(',', StringSplitOptions.RemoveEmptyEntries).ToList(), p?.Digest ?? "daily", p?.QuietFrom, p?.QuietTo);

    private static async Task<IResult> UpdatePreferences(PreferencesRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var row = await db.PersonalPreferences.FirstOrDefaultAsync(p => p.UserId == me.Human.Id, ct);
        var work = body.Work ?? [];
        return await commands.RunAsync(new CommandSpec("Changed own notification preferences", "Security.ManageOwn")
        {
            Resource = "Identity",
            ResourceId = me.Human.Id.ToString(),
            StepUp = false,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = row?.Version ?? 0,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (body.QuietFrom is { } f && !Time().IsMatch(f)) e["quietFrom"] = "A time like 21:00.";
                if (body.QuietTo is { } t && !Time().IsMatch(t)) e["quietTo"] = "A time like 07:00.";
                if (work.Count == 0) e["work"] = "Choose at least one way to hear about your work.";
                else if (work.Any(c => !Channels.Contains(c))) e["work"] = "Choose from the channels listed.";
                if (body.Digest is not ("none" or "daily" or "weekly")) e["digest"] = "None, daily or weekly.";
                return e;
            },
        }, actor =>
        {
            if (row is null) db.PersonalPreferences.Add(row = new PersonalPreference { UserId = actor.Human.Id, Version = 0 });
            row.Work = string.Join(',', work.Distinct());
            row.Digest = body.Digest;
            row.QuietFrom = string.IsNullOrWhiteSpace(body.QuietFrom) ? null : body.QuietFrom;
            row.QuietTo = string.IsNullOrWhiteSpace(body.QuietTo) ? null : body.QuietTo;
            row.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static void Touch(AgencySetting row, Actor actor, TimeProvider clock)
    {
        row.Version++;
        row.UpdatedBy = actor.Human.Name;
        row.UpdatedAt = clock.GetUtcNow();
    }

    internal static bool IsEmail(string? s) => s is not null && Email().IsMatch(s.Trim());

    internal static int Digits(string? s) => (s ?? "").Count(char.IsAsciiDigit);

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex Email();

    [GeneratedRegex(@"^\d{4}/\d{6}/\d{2}$")]
    private static partial Regex CipcNumber();

    [GeneratedRegex(@"^4\d{9}$")]
    private static partial Regex VatNumber();

    [GeneratedRegex(@"^\d{7,12}$")]
    private static partial Regex AccountNumber();

    [GeneratedRegex(@"^\d{6}$")]
    private static partial Regex BranchCode();

    [GeneratedRegex(@"^\d{2}:\d{2}$")]
    private static partial Regex Time();
}
