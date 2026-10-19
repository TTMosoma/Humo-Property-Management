using System.Text.RegularExpressions;
using Humo.Api.Access;
using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Api.Session;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Platform;

public sealed record NewHumoMemberRequest(string Name, string Email, string? Title, string Role, string Label, string Reason);
public sealed record HumoTeamActionRequest(string Type, string? Role, string? Label, string? Reason, string? AssignmentId, bool? Allowed,
    List<string>? OrganisationIds, string? ReassignTo, string? GrantId, int? ExpectedVersion);

public sealed record HumoCustomerRefDto(string OrganisationId, string Name);
public sealed record PendingHumoGrantDto(string Id, string IdentityId, string IdentityName, string Role, string Label, string Reason, string RequestedById, string RequestedBy, string RequestedAt);
public sealed record HumoTeamMemberDto(IdentityDto Identity, IReadOnlyList<RoleAssignmentDto> Roles, IReadOnlyList<RoleAssignmentDto> FormerRoles, bool CanImpersonate,
    bool CanActivateWithoutApproval, IReadOnlyList<HumoCustomerRefDto> Customers, PendingHumoGrantDto? Pending, string? LastActiveAt);

/// <summary>
/// Humo's own team (doc 16). Only System Administrators change it (Platform.ManageHumoRoles), each
/// change with step-up and a reason. Nobody changes their own access; the last System Administrator
/// can't be removed; a new System Administrator needs a second one's approval, except under the
/// sole-administrator safeguard (confirm your own request after a 24-hour cooling-off period).
/// </summary>
public static partial class HumoTeamEndpoints
{
    private const string Impersonate = "System.Impersonate";
    private const string Delegated = AccountRequestEndpoints.DelegatedPermission;

    public static void MapHumoTeam(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/platform/team").RequireAuthorization();
        g.MapGet("", List);
        g.MapGet("/pending-grants", Pending);
        g.MapGet("/{id:guid}", Get);
        g.MapPost("", Invite);
        g.MapPut("/{id:guid}", Update);
        g.MapPost("/{id:guid}/actions", Act);
    }

    // ---- Reads ----

    private static async Task<IResult> List(CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Platform.View")) return Problems.Policy("forbidden", "Role does not have this permission");
        var team = await Team(db, null, ct);
        return Results.Ok(await Members(db, team, ct));
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Platform.View")) return Problems.NotFound();
        var team = await Team(db, id, ct);
        return team.Count == 0 ? Problems.NotFound() : Results.Ok((await Members(db, team, ct))[0]);
    }

    private static async Task<IResult> Pending(CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Platform.View")) return Results.Ok(Array.Empty<PendingHumoGrantDto>());
        return Results.Ok((await db.PendingHumoGrants.ToListAsync(ct)).OrderBy(g => g.RequestedAt).Select(ToDto));
    }

    // ---- Commands ----

    private static async Task<IResult> Invite(NewHumoMemberRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, UserManager<HumoUser> users,
        Notices notices, IEmailSender email, IOptions<AppOptions> app, TimeProvider clock, ILoggerFactory logs, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var address = (body.Email ?? "").Trim().ToLowerInvariant();
        var name = Regex.Replace((body.Name ?? "").Trim(), @"\s+", " ");
        var taken = await db.Users.AnyAsync(u => u.NormalizedEmail == address.ToUpperInvariant(), ct);
        var needsSecond = body.Role == Roles.SystemAdmin;
        var id = Guid.CreateVersion7();

        return await commands.RunAsync(new CommandSpec($"Invited {name} ({address}) to the Humo team as {Roles.Label(body.Role ?? "")}{(needsSecond ? " (waiting for a second System Administrator)" : "")} — {body.Reason?.Trim()}", "Platform.ManageHumoRoles")
        {
            Resource = "Humo team",
            ResourceId = id.ToString(),
            Category = "security",
            StepUp = true,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (name.Split(' ').Length < 2) e["name"] = "Enter their first name and surname.";
                if (!Email().IsMatch(address)) e["email"] = "Enter their Humo work email.";
                else if (!HumoEmail.IsHumoAddress(address)) e["email"] = $"Humo staff sign in with their @{HumoEmail.Domain} address.";
                else if (taken) e["email"] = "Someone already signs in with this email.";
                if (!Roles.IsHumo(body.Role ?? "")) e["role"] = "Choose a Humo role.";
                if ((body.Label ?? "").Trim().Length < 3) e["label"] = "Describe what they do, e.g. “Customer support”.";
                if ((body.Reason ?? "").Trim().Length < 5) e["reason"] = PortfolioRules.ReasonMessage;
                return e;
            },
        }, async actor =>
        {
            var user = new HumoUser
            {
                Id = id, UserName = address, Email = address, Name = name, Kind = IdentityKinds.Humo, Status = IdentityStatuses.Invited,
                Title = string.IsNullOrWhiteSpace(body.Title) ? null : body.Title.Trim(), CreatedAt = clock.GetUtcNow(),
            };
            var created = await users.CreateAsync(user);
            if (!created.Succeeded) throw new CommandRefused("forbidden", string.Join("; ", created.Errors.Select(x => x.Description)));
            if (needsSecond) await RequestSystemAdmin(db, notices, actor, user, body.Label!.Trim(), body.Reason!.Trim(), clock, ct);
            else GrantRole(db, user.Id, body.Role!, body.Label!.Trim(), actor.User.Name, clock.GetUtcNow());
            await AccessEndpoints.SendInvitation(db, email, app.Value, clock, user, "the Humo team", logs, ct);
            return Results.Created($"/api/platform/team/{id}", new { id = id.ToString() });
        }, ct);
    }

    private static async Task<IResult> Update(Guid id, IdentityDetailsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var target = await db.Users.FirstOrDefaultAsync(u => u.Id == id && u.Kind == IdentityKinds.Humo, ct);
        if (target is null) return Problems.NotFound();
        var address = (body.Email ?? "").Trim().ToLowerInvariant();
        var name = Regex.Replace((body.Name ?? "").Trim(), @"\s+", " ");
        var taken = await db.Users.AnyAsync(u => u.Id != id && u.NormalizedEmail == address.ToUpperInvariant(), ct);

        return await commands.RunAsync(new CommandSpec($"Updated {name}’s details", "Platform.ManageHumoRoles")
        {
            Resource = "Humo team",
            ResourceId = id.ToString(),
            Category = "security",
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = target.Version,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (name.Split(' ').Length < 2) e["name"] = "Enter their first name and surname.";
                if (!Email().IsMatch(address) || !HumoEmail.IsHumoAddress(address)) e["email"] = $"Their @{HumoEmail.Domain} address.";
                else if (taken) e["email"] = "Someone else already signs in with this email.";
                return e;
            },
        }, _ =>
        {
            target.Name = name;
            target.Email = target.UserName = address;
            target.NormalizedEmail = target.NormalizedUserName = address.ToUpperInvariant();
            target.Title = string.IsNullOrWhiteSpace(body.Title) ? null : body.Title.Trim();
            target.Version++;
            target.SecurityStamp = Guid.NewGuid().ToString();
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> Act(Guid id, HumoTeamActionRequest a, CurrentActor current, CommandRunner commands, HumoDbContext db, Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var target = await db.Users.Include(u => u.Assignments).AsSplitQuery().FirstOrDefaultAsync(u => u.Id == id && u.Kind == IdentityKinds.Humo, ct);
        if (target is null) return Problems.NotFound();
        var roles = target.Assignments.Where(x => x.Status == AssignmentStatuses.Active && Roles.IsHumo(x.Role)).ToList();
        var grant = Guid.TryParse(a.GrantId, out var gid) ? await db.PendingHumoGrants.FirstOrDefaultAsync(g => g.Id == gid, ct) : null;
        var admins = await HumoTeamRules.SystemAdmins(db, ct);
        var sole = admins.Count == 1 && admins[0] == me.User.Id;
        var lastAdmin = admins.Count == 1 && admins[0] == id;
        var customers = await db.Organisations.Where(o => o.AccountManagerId == id).Select(o => new { o.Id, o.ShortName }).ToListAsync(ct);
        var pendingForTarget = await db.PendingHumoGrants.AnyAsync(g => g.IdentityId == id, ct);
        Guid? reassign = Guid.TryParse(a.ReassignTo, out var r) ? r : null;
        var reassignOk = reassign is { } to && to != id && await HumoTeamRules.IsActiveAccountManager(db, to, ct);
        var ended = Guid.TryParse(a.AssignmentId, out var aid) ? roles.FirstOrDefault(x => x.Id == aid) : null;
        var now = clock.GetUtcNow();
        var confirmableFrom = grant?.RequestedAt.AddHours(HumoTeamRules.SoleAdminCoolingOffHours);
        var reasonText = a.Reason is { Length: > 0 } ? $" — {a.Reason.Trim()}" : "";

        var what = a.Type switch
        {
            "grant-role" => $"{(a.Role == Roles.SystemAdmin ? "Asked to make" : "Made")} {target.Name} {Roles.Label(a.Role ?? "")}{(a.Role == Roles.SystemAdmin ? " (needs a second System Administrator)" : "")}",
            "end-role" => $"Ended {(ended is null ? "a role" : Roles.Label(ended.Role))} for {target.Name}",
            "set-impersonation" => $"{(a.Allowed == true ? "Allowed" : "Withdrew")} impersonation for {target.Name}",
            "set-delegated-activation" => $"{(a.Allowed == true ? "Granted" : "Revoked")} delegated account activation ({Delegated}) for {target.Name}",
            "set-customers" => $"Changed the customers {target.Name} looks after",
            "suspend" => $"Suspended {target.Name}’s Humo access",
            "restore" => $"Restored {target.Name}’s Humo access",
            "offboard" => $"Offboarded {target.Name} from the Humo team",
            "approve-grant" => $"Approved {(grant is null ? "a grant" : $"{grant.IdentityName} as {Roles.Label(grant.Role)} (requested by {grant.RequestedBy})")}"
                + (grant?.RequestedById == me.User.Id ? $" — confirmed by the sole System Administrator after the {HumoTeamRules.SoleAdminCoolingOffHours}-hour cooling-off period" : ""),
            "decline-grant" => $"Declined {(grant is null ? "a grant" : $"{grant.IdentityName} as {Roles.Label(grant.Role)}")}",
            _ => "Unknown Humo team action",
        };

        return await commands.RunAsync(new CommandSpec(what + reasonText, "Platform.ManageHumoRoles")
        {
            Resource = "Humo team",
            ResourceId = id.ToString(),
            Category = "security",
            StepUp = true,
            ExpectedVersion = a.ExpectedVersion,
            CurrentVersion = target.Version,
            Validate = () =>
            {
                if (a.Type is not ("approve-grant" or "decline-grant" or "restore") && a.Reason is not null && a.Reason.Trim().Length < 5) return new() { ["reason"] = PortfolioRules.ReasonMessage };
                if (a.Type is "approve-grant" or "decline-grant")
                {
                    if (grant is null || grant.IdentityId != id) return new() { ["grantId"] = "That request is no longer waiting." };
                    if (grant.IdentityId == me.User.Id) return new() { ["grantId"] = "You can’t decide on your own access." };
                    if (a.Type == "approve-grant" && grant.RequestedById == me.User.Id)
                    {
                        // Sole-administrator safeguard: otherwise nobody could ever approve a second System Administrator.
                        if (!sole) return new() { ["grantId"] = "A second System Administrator approves it: not the person who asked." };
                        if (now < confirmableFrom) return new() { ["grantId"] = $"You’re the only System Administrator, so you can confirm your own request after a {HumoTeamRules.SoleAdminCoolingOffHours}-hour cooling-off period: from {confirmableFrom.Value.ToOffset(TimeSpan.FromHours(2)):d MMM yyyy HH:mm}." };
                    }
                    if (a.Type == "decline-grant" && (a.Reason ?? "").Trim().Length < 5) return new() { ["reason"] = PortfolioRules.ReasonMessage };
                    return [];
                }
                if (id == me.User.Id) return new() { ["id"] = "You can’t change your own access. Ask another System Administrator." };
                if (a.Type != "restore" && (a.Reason ?? "").Trim().Length < 5) return new() { ["reason"] = PortfolioRules.ReasonMessage };
                return a.Type switch
                {
                    "grant-role" when target.Status == IdentityStatuses.Deactivated => new() { ["role"] = "They’ve left the Humo team." },
                    "grant-role" when !Roles.IsHumo(a.Role ?? "") => new() { ["role"] = "Choose a Humo role." },
                    "grant-role" when roles.Any(x => x.Role == a.Role) => new() { ["role"] = $"They’re already {Roles.Label(a.Role!)}." },
                    "grant-role" when a.Role == Roles.SystemAdmin && pendingForTarget => new() { ["role"] = "A request is already waiting for approval." },
                    "grant-role" when (a.Label ?? "").Trim().Length < 3 => new() { ["label"] = "Describe what they do in this role." },
                    "end-role" when ended is null => new() { ["assignmentId"] = "That role isn’t active." },
                    "end-role" when ended!.Role == Roles.SystemAdmin && lastAdmin => new() { ["assignmentId"] = "They’re the last active System Administrator. Make someone else one first." },
                    "end-role" when ended!.Role == Roles.AccountManager && customers.Count > 0 => new() { ["assignmentId"] = $"Hand over their {customers.Count} customers to another account manager first." },
                    "set-impersonation" when !roles.Any(x => x.Role == Roles.SystemAdmin) => new() { ["allowed"] = "Only System Administrators can be allowed to impersonate." },
                    "set-delegated-activation" when roles.FirstOrDefault(x => x.Role == Roles.AccountManager) is not { } am => new() { ["allowed"] = "Only Account Managers can be given delegated account activation." },
                    "set-delegated-activation" when target.Status != IdentityStatuses.Active => new() { ["allowed"] = "Their Humo access isn’t active." },
                    "set-delegated-activation" when a.Allowed == roles.First(x => x.Role == Roles.AccountManager).Grants.Contains(Delegated) => new() { ["allowed"] = a.Allowed == true ? "They already have it." : "They don’t have it." },
                    "set-customers" when !roles.Any(x => x.Role == Roles.AccountManager) => new() { ["organisationIds"] = "They aren’t an account manager." },
                    "set-customers" when customers.Any(c => !(a.OrganisationIds ?? []).Contains(c.Id.ToString())) =>
                        new() { ["organisationIds"] = $"Every customer needs an account manager: move {string.Join(", ", customers.Where(c => !(a.OrganisationIds ?? []).Contains(c.Id.ToString())).Select(c => c.ShortName))} by giving them to someone else from that person’s page." },
                    "suspend" when target.Status is not (IdentityStatuses.Active or IdentityStatuses.Invited) => new() { ["status"] = "Their access isn’t active." },
                    "suspend" when lastAdmin => new() { ["status"] = "They’re the last active System Administrator." },
                    "restore" when target.Status != IdentityStatuses.Suspended => new() { ["status"] = "They aren’t suspended." },
                    "offboard" when target.Status == IdentityStatuses.Deactivated => new() { ["status"] = "They’ve already left." },
                    "offboard" when lastAdmin => new() { ["status"] = "They’re the last active System Administrator. Make someone else one first." },
                    "offboard" when customers.Count > 0 && reassign is null => new() { ["reassignTo"] = $"Choose who looks after their {customers.Count} customers." },
                    "offboard" when customers.Count > 0 && !reassignOk => new() { ["reassignTo"] = "Choose an active account manager." },
                    "grant-role" or "end-role" or "set-impersonation" or "set-delegated-activation" or "set-customers" or "suspend" or "restore" or "offboard" => [],
                    _ => new() { ["type"] = "Unknown Humo team action." },
                };
            },
        }, async actor =>
        {
            var by = actor.User.Name;
            switch (a.Type)
            {
                case "grant-role":
                    if (a.Role == Roles.SystemAdmin) await RequestSystemAdmin(db, notices, actor, target, a.Label!.Trim(), a.Reason!.Trim(), clock, ct);
                    else GrantRole(db, id, a.Role!, a.Label!.Trim(), by, now);
                    break;
                case "end-role":
                    // Impersonation is a grant on the System Administrator role: it ends with it.
                    End(ended!, by, now);
                    target.SecurityStamp = Guid.NewGuid().ToString();
                    break;
                case "set-impersonation":
                    SetGrant(roles.Where(x => x.Role == Roles.SystemAdmin), Impersonate, a.Allowed == true);
                    break;
                case "set-delegated-activation":
                    SetGrant(roles.Where(x => x.Role == Roles.AccountManager), Delegated, a.Allowed == true);
                    notices.ToRole(Roles.SystemAdmin, actor.User.Id, $"Delegated account activation {(a.Allowed == true ? "granted" : "revoked")}: {target.Name}",
                        a.Allowed == true ? $"{target.Name} can now activate new customer accounts without a separate approval." : $"{target.Name}’s new accounts need approval again.", $"/platform/team/{id}");
                    break;
                case "set-customers":
                    var ids = (a.OrganisationIds ?? []).Select(x => Guid.TryParse(x, out var g) ? g : Guid.Empty).ToList();
                    foreach (var org in await db.Organisations.Where(o => ids.Contains(o.Id)).ToListAsync(ct)) org.AccountManagerId = id;
                    break;
                case "suspend":
                    target.SuspendedFrom = target.Status == IdentityStatuses.Invited ? IdentityStatuses.Invited : IdentityStatuses.Active;
                    target.Status = IdentityStatuses.Suspended;
                    target.SecurityStamp = Guid.NewGuid().ToString();
                    break;
                case "restore":
                    // Back to where they were: an invitee who never accepted is still invited.
                    target.Status = target.SuspendedFrom ?? IdentityStatuses.Active;
                    target.SuspendedFrom = null;
                    break;
                case "offboard":
                    if (customers.Count > 0)
                        foreach (var org in await db.Organisations.Where(o => o.AccountManagerId == id).ToListAsync(ct)) org.AccountManagerId = reassign;
                    foreach (var role in roles) End(role, by, now);
                    target.Status = IdentityStatuses.Deactivated;
                    target.SecurityStamp = Guid.NewGuid().ToString();
                    db.PendingHumoGrants.RemoveRange(await db.PendingHumoGrants.Where(g => g.IdentityId == id || g.RequestedById == id).ToListAsync(ct));
                    break;
                case "approve-grant":
                    GrantRole(db, id, grant!.Role, grant.Label, $"{grant.RequestedBy}, approved by {by}", now);
                    db.PendingHumoGrants.Remove(grant);
                    break;
                case "decline-grant":
                    db.PendingHumoGrants.Remove(grant!);
                    break;
            }
            target.Version++;
            return Results.NoContent();
        }, ct);
    }

    // ---- Helpers ----

    /// <summary>A System Administrator role waits for a second System Administrator. Under the safeguard, the rest of the team is told at once.</summary>
    private static async Task RequestSystemAdmin(HumoDbContext db, Notices notices, Actor me, HumoUser target, string label, string reason, TimeProvider clock, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        db.PendingHumoGrants.Add(new PendingHumoGrant
        {
            Id = Guid.CreateVersion7(), IdentityId = target.Id, IdentityName = target.Name, Role = Roles.SystemAdmin, Label = label, Reason = reason,
            RequestedById = me.User.Id, RequestedBy = me.User.Name, RequestedAt = now,
        });
        if (!await HumoTeamRules.IsSoleSystemAdmin(db, me.User.Id, ct)) return;
        var from = now.AddHours(HumoTeamRules.SoleAdminCoolingOffHours).ToOffset(TimeSpan.FromHours(2));
        var team = await db.Users.Where(u => u.Kind == IdentityKinds.Humo && u.Status != IdentityStatuses.Deactivated && u.Id != me.User.Id).Select(u => u.Id).ToListAsync(ct);
        foreach (var person in team)
            notices.ToPerson(person, me.User.Id, $"{me.User.Name} asked to make {target.Name} a System Administrator",
                $"{me.User.Name} is Humo’s only System Administrator, so they can confirm it themselves after a {HumoTeamRules.SoleAdminCoolingOffHours}-hour cooling-off period (from {from:d MMM yyyy HH:mm}). If you didn’t expect this, raise it with Humo’s founders before then.",
                $"/platform/team/{target.Id}");
    }

    private static void GrantRole(HumoDbContext db, Guid identityId, string role, string label, string by, DateTimeOffset now) =>
        db.RoleAssignments.Add(new RoleAssignment
        {
            Id = Guid.CreateVersion7(), UserId = identityId, Role = role, ScopeType = ScopeTypes.Platform, Label = label, GrantedBy = by, GrantedAt = now,
        });

    private static void End(RoleAssignment a, string by, DateTimeOffset now)
    {
        a.Status = AssignmentStatuses.Ended;
        a.EndedBy = by;
        a.EndedAt = now;
        a.Version++;
    }

    private static void SetGrant(IEnumerable<RoleAssignment> on, string permission, bool allowed)
    {
        foreach (var a in on)
        {
            a.Grants = allowed ? a.Grants.Append(permission).Distinct().ToList() : a.Grants.Where(g => g != permission).ToList();
            a.Version++;
        }
    }

    private static async Task<List<HumoUser>> Team(HumoDbContext db, Guid? id, CancellationToken ct)
    {
        var query = db.Users.Include(u => u.Assignments).Include(u => u.Memberships).AsSplitQuery().Where(u => u.Kind == IdentityKinds.Humo);
        if (id is { } one) query = query.Where(u => u.Id == one);
        return (await query.ToListAsync(ct)).OrderBy(u => u.Name).ToList();
    }

    private static async Task<List<HumoTeamMemberDto>> Members(HumoDbContext db, List<HumoUser> team, CancellationToken ct)
    {
        var ids = team.Select(u => u.Id).ToList();
        var customers = await db.Organisations.Where(o => o.AccountManagerId != null && ids.Contains(o.AccountManagerId.Value)).Select(o => new { o.Id, o.ShortName, o.AccountManagerId }).ToListAsync(ct);
        var pending = await db.PendingHumoGrants.Where(g => ids.Contains(g.IdentityId)).ToListAsync(ct);
        return team.Select(u =>
        {
            var roles = u.Assignments.Where(a => a.Status == AssignmentStatuses.Active && Roles.IsHumo(a.Role)).ToList();
            var former = u.Assignments.Where(a => a.Status == AssignmentStatuses.Ended && Roles.IsHumo(a.Role)).OrderByDescending(a => a.EndedAt).ToList();
            return new HumoTeamMemberDto(
                SessionBuilder.ToDto(u),
                roles.Select(SessionBuilder.ToDto).ToList(),
                former.Select(SessionBuilder.ToDto).ToList(),
                roles.Any(a => a.Role == Roles.SystemAdmin && a.Grants.Contains(Impersonate)),
                roles.Any(a => a.Role == Roles.AccountManager && a.Grants.Contains(Delegated)),
                customers.Where(c => c.AccountManagerId == u.Id).OrderBy(c => c.ShortName).Select(c => new HumoCustomerRefDto(c.Id.ToString(), c.ShortName)).ToList(),
                pending.Where(g => g.IdentityId == u.Id).Select(ToDto).FirstOrDefault(),
                null);
        }).ToList();
    }

    private static PendingHumoGrantDto ToDto(PendingHumoGrant g) => new(g.Id.ToString(), g.IdentityId.ToString(), g.IdentityName, g.Role, g.Label, g.Reason,
        g.RequestedById.ToString(), g.RequestedBy, g.RequestedAt.ToString("O"));

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex Email();
}
