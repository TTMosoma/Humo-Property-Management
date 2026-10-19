using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Platform;

public sealed record NewAccountDetailsRequest(string Name, string ShortName, string City, string Province, string PackageId, string AccountManagerId, string? Notes);
public sealed record AccountDecisionRequest(string Type, string? Reason, int? ExpectedVersion);
public sealed record PolicyRequest(string Policy, string Reason, int? ExpectedVersion);

public sealed record NewAccountDetailsDto(string Name, string ShortName, string City, string Province, string PackageId, string AccountManagerId, string? Notes);
public sealed record AccountRequestDto(string Id, string Ref, int Version, NewAccountDetailsDto Details, string AccountManager, string Status, string Route, string Policy,
    string RequestedById, string RequestedBy, string RequestedAt, string? DecidedById, string? DecidedBy, string? DecidedAt, string? Reason, string? OrganisationId);
public sealed record AccountRequestViewDto(AccountRequestDto Request, string? OrganisationStatus);
public sealed record AccountSubmissionDto(string RequestId, string Ref, string Outcome, string? OrganisationId);
public sealed record AccountPolicyDto(string Policy, int Version, string? UpdatedBy, string? UpdatedAt);

/// <summary>
/// New customer accounts (doc 21). A request waits for a System Administrator, or is activated
/// at once under delegated authority: the server decides, from the submitter's own grant and the
/// policy in force. The organisation exists only after approval, starting in onboarding, with no users.
/// </summary>
public static class AccountRequestEndpoints
{
    public const string DelegatedPermission = "Platform.Customers.ActivateWithoutApproval";
    public const string PolicyKey = "account-policy";
    private static readonly string[] Packages = ["essentials", "professional", "enterprise"];
    private static readonly Dictionary<string, string> PolicyLabels = new()
    {
        ["delegation-allowed"] = "Approval required, except for Account Managers with delegated activation",
        ["approval-for-all"] = "Approval required for every new account (delegated activation paused)",
    };

    public static void MapAccountRequests(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/platform").RequireAuthorization();
        g.MapGet("/account-requests", List);
        g.MapGet("/account-requests/{id:guid}", Get);
        g.MapPost("/account-requests", Submit);
        g.MapPost("/account-requests/{id:guid}/decision", Decide);
        g.MapGet("/account-policy", GetPolicy);
        g.MapPut("/account-policy", SetPolicy);
    }

    private static async Task<IResult> List(CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Platform.Customers.View")) return Results.Ok(Array.Empty<AccountRequestViewDto>());
        var requests = (await db.AccountRequests.ToListAsync(ct)).OrderByDescending(r => r.RequestedAt).ToList();
        return Results.Ok(await Views(requests, db, ct));
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var r = actor.Can("Platform.Customers.View") ? await db.AccountRequests.FirstOrDefaultAsync(x => x.Id == id, ct) : null;
        return r is null ? Problems.NotFound() : Results.Ok((await Views([r], db, ct))[0]);
    }

    private static async Task<IResult> Submit(NewAccountDetailsRequest d, CurrentActor current, CommandRunner commands, HumoDbContext db, Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var policy = await Policy(db, ct);
        // The server's decision: the submitter's own grant, and a policy that honours it.
        var delegated = actor.Can(DelegatedPermission) && policy.Value == "delegation-allowed";
        var errors = await Validate(db, d, null, ct);
        var reference = await NextRef(db, ct);
        var id = Guid.CreateVersion7();
        var name = (d.ShortName ?? "").Trim();

        return await commands.RunAsync(new CommandSpec(delegated
            ? $"Activated new customer account {reference} ({name}) under delegated authority — {DelegatedPermission}; policy: {PolicyLabels[policy.Value]}"
            : $"Submitted new customer account {reference} ({name}) for approval", "Platform.Customers.Manage")
        {
            Resource = "Account request",
            ResourceId = id.ToString(),
            Category = "security",
            Validate = () => errors,
        }, async actor =>
        {
            var now = clock.GetUtcNow();
            var manager = await db.Users.FirstAsync(u => u.Id == Guid.Parse(d.AccountManagerId), ct);
            var request = new AccountRequest
            {
                Id = id, Ref = reference, Name = d.Name.Trim(), ShortName = name, City = d.City.Trim(), Province = d.Province, PackageId = d.PackageId,
                AccountManagerId = manager.Id, AccountManager = manager.Name, Notes = string.IsNullOrWhiteSpace(d.Notes) ? null : d.Notes.Trim(),
                Policy = policy.Value, Status = delegated ? "approved" : "pending", Route = delegated ? "delegated" : "approval",
                RequestedById = actor.User.Id, RequestedBy = actor.User.Name, RequestedAt = now,
            };
            if (delegated)
            {
                request.OrganisationId = CreateOrganisation(db, request, now);
                request.DecidedById = actor.User.Id;
                request.DecidedBy = actor.User.Name;
                request.DecidedAt = now;
                notices.ToRole(Roles.SystemAdmin, actor.User.Id, $"Activated with delegated authority: {name}", $"{actor.User.Name} activated {reference} without separate approval. It’s onboarding now.", $"/platform/account-requests/{id}");
            }
            else
            {
                notices.ToRole(Roles.SystemAdmin, actor.User.Id, $"New account waiting for approval: {name}", $"{actor.User.Name} submitted {reference}.", $"/platform/account-requests/{id}");
            }
            db.AccountRequests.Add(request);
            return Results.Created($"/api/platform/account-requests/{id}", new AccountSubmissionDto(id.ToString(), reference, delegated ? "activated" : "pending", request.OrganisationId?.ToString()));
        }, ct);
    }

    private static async Task<IResult> Decide(Guid id, AccountDecisionRequest d, CurrentActor current, CommandRunner commands, HumoDbContext db, Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var r = await db.AccountRequests.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return Problems.NotFound();
        var own = r.RequestedById == actor.User.Id;
        var sole = await HumoTeamRules.IsSoleSystemAdmin(db, actor.User.Id, ct);
        var recheck = d.Type == "approve" && r.Status == "pending"
            ? await Validate(db, new NewAccountDetailsRequest(r.Name, r.ShortName, r.City, r.Province, r.PackageId, r.AccountManagerId.ToString(), r.Notes), r.Id, ct)
            : [];
        var what = d.Type == "approve" ? $"Approved new customer account {r.Ref} ({r.ShortName})" : $"Rejected new customer account {r.Ref} ({r.ShortName}) — {d.Reason?.Trim()}";

        return await commands.RunAsync(new CommandSpec(what + (own ? " — own request, decided by the sole System Administrator" : ""), "Platform.Customers.Approve")
        {
            Resource = "Account request",
            ResourceId = id.ToString(),
            Category = "security",
            ExpectedVersion = d.ExpectedVersion,
            CurrentVersion = r.Version,
            Validate = () =>
            {
                if (r.Status != "pending") return new() { ["status"] = $"It’s already {r.Status}." };
                // Sole-administrator safeguard (doc 16): with one System Administrator, nobody else could ever decide.
                if (own && !sole) return new() { ["status"] = "Another System Administrator decides on a request you submitted." };
                if (d.Type == "reject") return (d.Reason ?? "").Trim().Length < 5 ? new() { ["reason"] = "Say why, in a few words. The submitter sees it, and it goes in the audit log." } : [];
                if (d.Type != "approve") return new() { ["type"] = "Approve or reject." };
                // Approving re-checks: the customer may have been added since, or the account manager may have left.
                return recheck;
            },
        }, actor =>
        {
            var now = clock.GetUtcNow();
            r.Status = d.Type == "approve" ? "approved" : "rejected";
            r.DecidedById = actor.User.Id;
            r.DecidedBy = actor.User.Name;
            r.DecidedAt = now;
            r.Version++;
            if (d.Type == "approve") r.OrganisationId = CreateOrganisation(db, r, now);
            else r.Reason = d.Reason!.Trim();
            notices.ToPerson(r.RequestedById, actor.User.Id, d.Type == "approve" ? $"Approved: {r.ShortName}" : $"Rejected: {r.ShortName}",
                d.Type == "approve" ? $"{actor.User.Name} approved {r.Ref}. It’s onboarding: invite their first administrator next." : $"{actor.User.Name} rejected {r.Ref}: {r.Reason}",
                $"/platform/account-requests/{id}");
            notices.ToRole(Roles.SystemAdmin, actor.User.Id, $"{(d.Type == "approve" ? "Approved" : "Rejected")}: {r.ShortName}", $"{actor.User.Name} decided {r.Ref}.", $"/platform/account-requests/{id}");
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> GetPolicy(CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var p = await Policy(db, ct);
        return Results.Ok(new AccountPolicyDto(p.Value, p.Version, p.UpdatedBy, p.UpdatedAt?.ToString("O")));
    }

    private static async Task<IResult> SetPolicy(PolicyRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var p = await Policy(db, ct);
        var label = PolicyLabels.GetValueOrDefault(body.Policy ?? "", body.Policy ?? "");

        return await commands.RunAsync(new CommandSpec($"Changed the account-creation policy to “{label}” — {body.Reason?.Trim()}", "Platform.Config.Manage")
        {
            Resource = "Account policy",
            Category = "security",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = p.Version,
            Validate = () =>
            {
                if (!PolicyLabels.ContainsKey(body.Policy ?? "")) return new() { ["policy"] = "Choose a policy." };
                if (body.Policy == p.Value) return new() { ["policy"] = "That’s already the policy." };
                return (body.Reason ?? "").Trim().Length < 5 ? new() { ["reason"] = PortfolioRules.ReasonMessage } : [];
            },
        }, actor =>
        {
            // New requests only: anything waiting stays waiting.
            p.Value = body.Policy!;
            p.Version++;
            p.UpdatedBy = actor.User.Name;
            p.UpdatedAt = clock.GetUtcNow();
            notices.ToRole(Roles.SystemAdmin, actor.User.Id, "Account-creation policy changed", $"{actor.User.Name}: {label}.", "/platform/account-requests");
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    // ---- Rules ----

    /// <summary>Required fields, an active account manager, and no duplicate of a customer or of a request still waiting.</summary>
    private static async Task<Dictionary<string, string>> Validate(HumoDbContext db, NewAccountDetailsRequest d, Guid? ignoreRequest, CancellationToken ct)
    {
        var e = new Dictionary<string, string>();
        var shortName = (d.ShortName ?? "").Trim().ToLower();
        var name = (d.Name ?? "").Trim().ToLower();
        if (name.Length < 3) e["name"] = "Enter the registered name.";
        if (shortName.Length < 2) e["shortName"] = "Enter the name people use day to day.";
        if ((d.City ?? "").Trim().Length < 2) e["city"] = "Enter the city.";
        if (!PortfolioRules.Provinces.Contains(d.Province)) e["province"] = "Choose the province.";
        if (!Packages.Contains(d.PackageId)) e["packageId"] = "Choose the package for the trial.";
        if (!Guid.TryParse(d.AccountManagerId, out var manager) || !await HumoTeamRules.IsActiveAccountManager(db, manager, ct)) e["accountManagerId"] = "Choose an active account manager.";
        if (!e.ContainsKey("shortName"))
        {
            if (await db.Organisations.AnyAsync(o => o.ShortName.ToLower() == shortName || o.Name.ToLower() == name, ct)) e["shortName"] = "This customer already has an account.";
            else if (await db.AccountRequests.AnyAsync(r => r.Id != ignoreRequest && r.Status == "pending" && (r.ShortName.ToLower() == shortName || r.Name.ToLower() == name), ct))
                e["shortName"] = "A request for this customer is already waiting for approval.";
        }
        return e;
    }

    /// <summary>The organisation starts onboarding, with its account manager and trial package. No users are created.</summary>
    private static Guid CreateOrganisation(HumoDbContext db, AccountRequest r, DateTimeOffset now)
    {
        var org = new Organisation
        {
            Id = Guid.CreateVersion7(), Status = OrganisationStatuses.Onboarding, Name = r.Name, ShortName = r.ShortName, City = r.City, Province = r.Province,
            AccountManagerId = r.AccountManagerId, TrialPackageId = r.PackageId, CreatedAt = now,
        };
        db.Organisations.Add(org);
        return org.Id;
    }

    private static async Task<PlatformSetting> Policy(HumoDbContext db, CancellationToken ct)
    {
        var p = await db.PlatformSettings.FirstOrDefaultAsync(s => s.Key == PolicyKey, ct);
        if (p is not null) return p;
        p = new PlatformSetting { Key = PolicyKey, Value = "delegation-allowed" };
        db.PlatformSettings.Add(p);
        return p;
    }

    private static async Task<string> NextRef(HumoDbContext db, CancellationToken ct)
    {
        var refs = await db.AccountRequests.Select(r => r.Ref).ToListAsync(ct);
        var max = refs.Select(r => int.TryParse(r.Replace("AR-", ""), out var n) ? n : 1000).DefaultIfEmpty(1000).Max();
        return $"AR-{max + 1}";
    }

    private static async Task<List<AccountRequestViewDto>> Views(List<AccountRequest> requests, HumoDbContext db, CancellationToken ct)
    {
        var orgIds = requests.Where(r => r.OrganisationId != null).Select(r => r.OrganisationId!.Value).ToList();
        var statuses = await db.Organisations.Where(o => orgIds.Contains(o.Id)).ToDictionaryAsync(o => o.Id, o => o.Status, ct);
        return requests.Select(r => new AccountRequestViewDto(
            new AccountRequestDto(r.Id.ToString(), r.Ref, r.Version, new NewAccountDetailsDto(r.Name, r.ShortName, r.City, r.Province, r.PackageId, r.AccountManagerId.ToString(), r.Notes),
                r.AccountManager, r.Status, r.Route, r.Policy, r.RequestedById.ToString(), r.RequestedBy, r.RequestedAt.ToString("O"), r.DecidedById?.ToString(), r.DecidedBy,
                r.DecidedAt?.ToString("O"), r.Reason, r.OrganisationId?.ToString()),
            r.OrganisationId is { } o ? statuses.GetValueOrDefault(o) : null)).ToList();
    }
}
