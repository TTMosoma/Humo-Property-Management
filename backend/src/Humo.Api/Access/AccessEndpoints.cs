using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Api.Session;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Access;

public sealed record ScopeRequest(string Type, string? OrganisationId, List<string>? SchemeIds, string? UnitId);
public sealed record NewAssignmentRequest(string Role, ScopeRequest Scope, string Label);
public sealed record InviteRequest(string OrganisationId, string Name, string Email, string? Title, NewAssignmentRequest Assignment, string? PersonId);
public sealed record IdentityDetailsRequest(string Name, string Email, string? Title, int? ExpectedVersion);
public sealed record MembershipStatusRequest(string OrganisationId, string Status, string Reason);
public sealed record BrowseAgencyRequest(bool Allowed, int? ExpectedVersion);
public sealed record VersionRequest(int? ExpectedVersion);

/// <summary>
/// Users &amp; access (doc 24 §7): the directory, invitations, details, membership, roles and the
/// browse grant (D1). Nobody changes their own access. Every change needs step-up and is audited.
/// An agency sees only its own memberships and roles of a person, never another agency's.
/// </summary>
public static partial class AccessEndpoints
{
    public static readonly TimeSpan InvitationLifetime = TimeSpan.FromDays(7);
    private static readonly string[] ResidentRoles = [Roles.Owner, Roles.Tenant, Roles.Trustee];
    private static readonly string[] StaffRoles = [Roles.AgencyAdmin, Roles.PortfolioManager, Roles.Finance, Roles.Operations];

    public static void MapAccess(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/access").RequireAuthorization();
        g.MapGet("/directory", Directory);
        g.MapGet("/humo-team", HumoTeam);
        g.MapPost("/invitations", Invite);
        g.MapPost("/identities/{id:guid}/resend-invitation", Resend);
        g.MapPut("/identities/{id:guid}", UpdateIdentity);
        g.MapPost("/identities/{id:guid}/membership", SetMembership);
        g.MapPost("/identities/{id:guid}/assignments", Assign);
        g.MapPost("/identities/{id:guid}/assignments/{assignmentId:guid}/browse-agency", SetBrowseAgency);
        g.MapPost("/identities/{id:guid}/assignments/{assignmentId:guid}/end", EndAssignment);
    }

    // ---- Reads ----

    /// <summary>Customer identities with access to the organisation. Customers: their own organisation only. Humo staff: any (Platform.Customers.Users).</summary>
    private static async Task<IResult> Directory(string? organisationId, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        Guid? org = Guid.TryParse(organisationId, out var o) ? o : null;
        if (!actor.IsHumo) org = actor.OrganisationId;
        else if (!actor.Can("Platform.Customers.Users")) return Problems.Policy("forbidden", "Role does not have this permission");

        var query = db.Users.Include(u => u.Memberships).Include(u => u.Assignments).AsSplitQuery().Where(u => u.Kind == IdentityKinds.Customer);
        query = org is { } id ? query.Where(u => u.Memberships.Any(m => m.OrganisationId == id && m.Status != MembershipStatuses.Ended)) : query.Where(u => u.Memberships.Any());
        var users = await query.OrderBy(u => u.Name).ToListAsync(ct);
        return Results.Ok(users.Select(u => View(u, org)));
    }

    private static async Task<IResult> HumoTeam(CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Platform.View")) return Problems.Policy("forbidden", "Role does not have this permission");
        var users = await db.Users.Include(u => u.Memberships).Include(u => u.Assignments).AsSplitQuery().Where(u => u.Kind == IdentityKinds.Humo).OrderBy(u => u.Name).ToListAsync(ct);
        return Results.Ok(users.Select(u => SessionBuilder.ToDto(u)));
    }

    // ---- Invitations ----

    private static async Task<IResult> Invite(InviteRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, UserManager<HumoUser> users,
        PortfolioReads reads, IEmailSender email, IOptions<AppOptions> app, TimeProvider clock, ILoggerFactory logs, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!Guid.TryParse(body.OrganisationId, out var orgId) || (!actor.IsHumo && orgId != actor.OrganisationId)) return Problems.NotFound();
        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == orgId, ct);
        if (org is null) return Problems.NotFound();

        var address = (body.Email ?? "").Trim().ToLowerInvariant();
        var existing = await db.Users.Include(u => u.Memberships).Include(u => u.Assignments).AsSplitQuery().FirstOrDefaultAsync(u => u.NormalizedEmail == address.ToUpperInvariant(), ct);
        var a = body.Assignment;
        var resident = ResidentRoles.Contains(a.Role);
        var personId = body.PersonId ?? existing?.PersonId;
        var person = Guid.TryParse(personId, out var pid) ? await db.People.FirstOrDefaultAsync(p => p.Id == pid && p.OrganisationId == orgId, ct) : null;
        var schemeIds = (a.Scope.SchemeIds ?? []).ToList();
        var onBoard = await OnBoard(db, reads, person?.Id, schemeIds, ct);
        var linkedToUnit = person is not null && Guid.TryParse(a.Scope.UnitId, out var unitId)
            && (await db.Relationships.Where(r => r.PersonId == person.Id && r.UnitId == unitId && r.Type == a.Role).ToListAsync(ct)).Any(reads.IsCurrent);
        var name = Regex.Replace((body.Name ?? "").Trim(), @"\s+", " ");
        var id = existing?.Id ?? Guid.CreateVersion7();

        return await commands.RunAsync(new CommandSpec(existing is null
            ? $"Invited {name} ({address}) as {Roles.Label(a.Role)} · {a.Label}"
            : $"Gave {existing.Name} access: {Roles.Label(a.Role)} · {a.Label}",
            // Humo staff onboarding a customer invite its first administrator; inside an agency, its administrators invite staff,
            // and Portfolio Managers may invite residents and trustees of their schemes (D3).
            actor.IsHumo ? "Platform.Customers.Manage" : a.Role == Roles.AgencyAdmin ? "Users.ManageAdmins" : resident ? "Residents.Invite" : "Users.Manage")
        {
            Resource = "Identity",
            ResourceId = id.ToString(),
            OrganisationId = orgId,
            Category = "security",
            SchemeId = !actor.IsHumo && schemeIds.Count == 1 && Guid.TryParse(schemeIds[0], out var sid) ? sid : null,
            StepUp = true,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (actor.IsHumo && a.Role != Roles.AgencyAdmin) e["role"] = "Onboarding invites the customer’s first Agency Administrator. They invite everyone else.";
                else if (!StaffRoles.Contains(a.Role) && !resident) e["role"] = "Choose a customer role.";
                if (name.Split(' ').Length < 2) e["name"] = "Enter their first name and surname.";
                if (!Email().IsMatch(address)) e["email"] = "Enter the email address the invitation goes to.";
                else if (existing?.Kind == IdentityKinds.Humo || HumoEmail.IsHumoAddress(address)) e["email"] = "That’s a Humo staff address. Humo staff are managed by Humo, not from an agency.";
                else if (existing?.Memberships.Any(m => m.OrganisationId == orgId && m.Status != MembershipStatuses.Ended) == true) e["email"] = $"{existing.Name} already has access here. Add the role from their access instead.";
                if (body.PersonId is not null && person is null) e["name"] = "That person isn’t in the directory any more.";
                var scopeError = CheckScope(a);
                if (scopeError is not null) e[scopeError.Value.Field] = scopeError.Value.Message;
                // D2: trustee access comes from a current board seat.
                if (a.Role == Roles.Trustee && !onBoard) e["role"] = $"{name} isn’t on that scheme’s board. Appoint them on the board (Governance › Board), then invite them from there.";
                if (person is not null && a.Role is Roles.Owner or Roles.Tenant && !linkedToUnit) e["role"] = $"{person.DisplayName} isn’t a current {a.Role} of that unit.";
                return e;
            },
        }, async actor =>
        {
            var user = existing;
            if (user is null)
            {
                user = new HumoUser
                {
                    Id = id, UserName = address, Email = address, Name = name, Kind = IdentityKinds.Customer, Status = IdentityStatuses.Invited,
                    Title = string.IsNullOrWhiteSpace(body.Title) ? null : body.Title.Trim(), PersonId = person?.Id.ToString(), CreatedAt = clock.GetUtcNow(),
                };
                var created = await users.CreateAsync(user);
                if (!created.Succeeded) throw new CommandRefused("forbidden", string.Join("; ", created.Errors.Select(x => x.Description)));
            }
            else if (user.PersonId is null && person is not null)
            {
                user.PersonId = person.Id.ToString();
            }
            Grant(db, user, orgId, a, actor.User.Name, clock.GetUtcNow());
            if (user.Status == IdentityStatuses.Invited) await SendInvitation(db, email, app.Value, clock, user, org.ShortName, logs, ct);
            return Results.Created($"/api/access/identities/{user.Id}", new { id = user.Id.ToString() });
        }, ct);
    }

    private static async Task<IResult> Resend(Guid id, CurrentActor current, CommandRunner commands, HumoDbContext db, IEmailSender email, IOptions<AppOptions> app,
        TimeProvider clock, ILoggerFactory logs, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var user = await Target(db, actor, id, ct);
        if (user is null) return Problems.NotFound();
        var orgName = actor.OrganisationId is { } org ? await db.Organisations.Where(o => o.Id == org).Select(o => o.ShortName).FirstAsync(ct) : "Humo";

        return await commands.RunAsync(new CommandSpec($"Resent the invitation to {user.Name} ({user.Email})", "Users.Manage")
        {
            Resource = "Identity",
            ResourceId = id.ToString(),
            Validate = () => user.Status == IdentityStatuses.Invited ? [] : new() { ["status"] = "They’ve already accepted their invitation." },
        }, async _ =>
        {
            await SendInvitation(db, email, app.Value, clock, user, orgName, logs, ct);
            return Results.NoContent();
        }, ct);
    }

    // ---- Details and membership ----

    private static async Task<IResult> UpdateIdentity(Guid id, IdentityDetailsRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var user = await Target(db, actor, id, ct);
        if (user is null) return Problems.NotFound();
        var address = (body.Email ?? "").Trim().ToLowerInvariant();
        var taken = await db.Users.AnyAsync(u => u.Id != id && u.NormalizedEmail == address.ToUpperInvariant(), ct);
        var name = Regex.Replace((body.Name ?? "").Trim(), @"\s+", " ");

        return await commands.RunAsync(new CommandSpec($"Updated {name}’s details", "Users.Manage")
        {
            Resource = "Identity",
            ResourceId = id.ToString(),
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = user.Version,
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (name.Split(' ').Length < 2) e["name"] = "Enter their first name and surname.";
                if (!Email().IsMatch(address)) e["email"] = "Enter a valid email address.";
                else if (taken) e["email"] = "Someone else already signs in with this email.";
                else if (user.Kind == IdentityKinds.Customer && HumoEmail.IsHumoAddress(address)) e["email"] = "That’s a Humo staff address. Use the person’s own email.";
                return e;
            },
        }, _ =>
        {
            user.Name = name;
            user.Email = address;
            user.UserName = address;
            user.NormalizedEmail = address.ToUpperInvariant();
            user.NormalizedUserName = address.ToUpperInvariant();
            user.Title = string.IsNullOrWhiteSpace(body.Title) ? null : body.Title.Trim();
            user.Version++;
            // Changing the sign-in email ends their other sessions (Identity's security stamp).
            user.SecurityStamp = Guid.NewGuid().ToString();
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> SetMembership(Guid id, MembershipStatusRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var user = await Target(db, actor, id, ct);
        if (user is null || !Guid.TryParse(body.OrganisationId, out var orgId) || (!actor.IsHumo && orgId != actor.OrganisationId)) return Problems.NotFound();
        var membership = user.Memberships.FirstOrDefault(m => m.OrganisationId == orgId);
        var isAdmin = user.Assignments.Any(a => a.Role == Roles.AgencyAdmin && a.OrganisationId == orgId && a.Status == AssignmentStatuses.Active);
        var verb = body.Status switch { "suspended" => "Suspended access for", "ended" => "Removed", _ => "Restored access for" };

        return await commands.RunAsync(new CommandSpec($"{verb} {user.Name}{(body.Status == "ended" ? " from the organisation" : "")} — {body.Reason}", isAdmin ? "Users.ManageAdmins" : "Users.Manage")
        {
            Resource = "Membership",
            ResourceId = id.ToString(),
            OrganisationId = orgId,
            Category = "security",
            StepUp = true,
            Validate = () =>
            {
                if (body.Status is not ("active" or "suspended" or "ended")) return new() { ["status"] = "Choose active, suspended or ended." };
                if (membership is null) return new() { ["status"] = "They aren’t a member of this organisation." };
                if (membership.Status == MembershipStatuses.Ended) return new() { ["status"] = "Their membership has already ended." };
                if (membership.Status == body.Status) return new() { ["status"] = $"Their access is already {body.Status}." };
                return (body.Reason ?? "").Trim().Length < 5 ? new() { ["reason"] = PortfolioRules.ReasonMessage } : [];
            },
        }, actor =>
        {
            NotSelf(actor, id, "You can’t change your own access");
            membership!.Status = body.Status;
            if (body.Status == MembershipStatuses.Ended)
            {
                membership.EndedAt = DateTimeOffset.UtcNow;
                // Removed from the organisation: every role there ends; the history stays.
                foreach (var a in user.Assignments.Where(a => a.OrganisationId == orgId && a.Status == AssignmentStatuses.Active)) End(a, actor.User.Name);
            }
            // Suspending or removing someone signs them out within minutes (security stamp).
            if (body.Status != "active") user.SecurityStamp = Guid.NewGuid().ToString();
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    // ---- Roles ----

    private static async Task<IResult> Assign(Guid id, NewAssignmentRequest a, CurrentActor current, CommandRunner commands, HumoDbContext db, PortfolioReads reads, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var user = await Target(db, actor, id, ct);
        if (user is null) return Problems.NotFound();
        var orgId = actor.OrganisationId;
        var schemeIds = a.Scope.SchemeIds ?? [];
        Guid? personId = Guid.TryParse(user.PersonId, out var p) ? p : null;
        var onBoard = await OnBoard(db, reads, personId, schemeIds, ct);
        var duplicate = user.Assignments.Any(x => x.Status == AssignmentStatuses.Active && x.Role == a.Role && x.ScopeType == a.Scope.Type && x.OrganisationId == orgId
            && string.Join(',', x.SchemeIds) == string.Join(',', schemeIds) && x.UnitId == a.Scope.UnitId);

        return await commands.RunAsync(new CommandSpec($"Granted {Roles.Label(a.Role)} · {a.Label} to {user.Name}", Roles.IsHumo(a.Role) ? "Platform.ManageHumoRoles" : a.Role == Roles.AgencyAdmin ? "Users.ManageAdmins" : "Users.Manage")
        {
            Resource = "Role assignment",
            ResourceId = id.ToString(),
            Category = "security",
            StepUp = true,
            Validate = () =>
            {
                if (Roles.IsHumo(a.Role) || !AccessCatalogue.IsRole(a.Role)) return new() { ["role"] = "Choose a customer role." };
                if (CheckScope(a) is { } s) return new() { [s.Field] = s.Message };
                if (duplicate) return new() { ["role"] = $"{user.Name} already has this role here." };
                // D2: trustee access is derived from the board register. It can't be given here without a seat on the board.
                if (a.Role == Roles.Trustee && !onBoard) return new() { ["role"] = $"{user.Name} isn’t on that scheme’s board. Appoint them on the board (Governance › Board) and trustee access follows." };
                return [];
            },
        }, actor =>
        {
            // The API refuses self-escalation, whatever the caller's role.
            NotSelf(actor, id, "You can’t change your own roles");
            Grant(db, user, orgId!.Value, a, actor.User.Name, DateTimeOffset.UtcNow);
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>D1: allow or withdraw browsing every scheme in the agency, read-only, on a scheme-limited staff role.</summary>
    private static async Task<IResult> SetBrowseAgency(Guid id, Guid assignmentId, BrowseAgencyRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var user = await Target(db, actor, id, ct);
        var a = user?.Assignments.FirstOrDefault(x => x.Id == assignmentId);
        if (user is null || a is null) return Problems.NotFound();

        return await commands.RunAsync(new CommandSpec($"{(body.Allowed ? "Allowed" : "Withdrew")} browsing every scheme (read-only) for {user.Name} · {Roles.Label(a.Role)}", "Users.Manage")
        {
            Resource = "Role assignment",
            ResourceId = assignmentId.ToString(),
            Category = "security",
            StepUp = true,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = a.Version,
            Validate = () => a.Status != AssignmentStatuses.Active
                ? new() { ["assignmentId"] = "That role isn’t active." }
                : a.ScopeType != ScopeTypes.Schemes || !StaffRoles.Contains(a.Role)
                    ? new() { ["assignmentId"] = "Only staff roles limited to some schemes can be allowed to browse the rest." }
                    : [],
        }, actor =>
        {
            NotSelf(actor, id, "You can’t change your own access");
            a.Grants = body.Allowed ? a.Grants.Append("Portfolio.BrowseAgency").Distinct().ToList() : a.Grants.Where(g => g != "Portfolio.BrowseAgency").ToList();
            a.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> EndAssignment(Guid id, Guid assignmentId, VersionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var user = await Target(db, actor, id, ct);
        var a = user?.Assignments.FirstOrDefault(x => x.Id == assignmentId);
        if (user is null || a is null) return Problems.NotFound();

        return await commands.RunAsync(new CommandSpec($"Ended {Roles.Label(a.Role)} · {a.Label} for {user.Name}", Roles.IsHumo(a.Role) ? "Platform.ManageHumoRoles" : a.Role == Roles.AgencyAdmin ? "Users.ManageAdmins" : "Users.Manage")
        {
            Resource = "Role assignment",
            ResourceId = assignmentId.ToString(),
            Category = "security",
            StepUp = true,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = a.Version,
            Validate = () => a.Status == AssignmentStatuses.Ended ? new() { ["assignmentId"] = "That role has already ended." } : [],
        }, actor =>
        {
            NotSelf(actor, id, "You can’t change your own roles");
            End(a, actor.User.Name);
            user.SecurityStamp = Guid.NewGuid().ToString();
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    // ---- Helpers ----

    /// <summary>A customer identity in the caller's organisation (Humo staff: any customer). Otherwise not found.</summary>
    private static async Task<HumoUser?> Target(HumoDbContext db, Actor actor, Guid id, CancellationToken ct)
    {
        var user = await db.Users.Include(u => u.Memberships).Include(u => u.Assignments).AsSplitQuery().FirstOrDefaultAsync(u => u.Id == id && u.Kind == IdentityKinds.Customer, ct);
        if (user is null) return null;
        return actor.IsHumo || user.Memberships.Any(m => m.OrganisationId == actor.OrganisationId) ? user : null;
    }

    private static void NotSelf(Actor actor, Guid target, string message)
    {
        if (actor.User.Id == target) throw new CommandRefused("forbidden", message);
    }

    private static (string Field, string Message)? CheckScope(NewAssignmentRequest a) => a.Scope.Type switch
    {
        ScopeTypes.Schemes when (a.Scope.SchemeIds ?? []).Count == 0 => ("scope", "Choose at least one scheme."),
        ScopeTypes.Unit when string.IsNullOrWhiteSpace(a.Scope.UnitId) => ("unit", "Choose the unit."),
        ScopeTypes.Schemes or ScopeTypes.Unit or ScopeTypes.Organisation => null,
        _ => ("scope", "Choose where the role applies."),
    };

    private static async Task<bool> OnBoard(HumoDbContext db, PortfolioReads reads, Guid? personId, List<string> schemeIds, CancellationToken ct)
    {
        if (personId is not { } p || schemeIds.Count == 0) return false;
        var ids = schemeIds.Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).ToList();
        var seats = (await db.Relationships.Where(r => r.PersonId == p && r.Type == "trustee" && ids.Contains(r.SchemeId)).ToListAsync(ct)).Where(reads.IsCurrent).Select(r => r.SchemeId).ToHashSet();
        return ids.All(seats.Contains);
    }

    /// <summary>Adds the role, creating (or reopening) the membership of the organisation.</summary>
    private static void Grant(HumoDbContext db, HumoUser user, Guid orgId, NewAssignmentRequest a, string by, DateTimeOffset now)
    {
        var membership = user.Memberships.FirstOrDefault(m => m.OrganisationId == orgId);
        if (membership is null) db.Memberships.Add(new Membership { Id = Guid.CreateVersion7(), UserId = user.Id, OrganisationId = orgId, Since = now });
        else if (membership.Status == MembershipStatuses.Ended) { membership.Status = MembershipStatuses.Active; membership.Since = now; membership.EndedAt = null; }
        db.RoleAssignments.Add(new RoleAssignment
        {
            Id = Guid.CreateVersion7(), UserId = user.Id, Role = a.Role, ScopeType = a.Scope.Type, OrganisationId = orgId,
            SchemeIds = a.Scope.SchemeIds ?? [], UnitId = a.Scope.UnitId, Label = a.Label, GrantedBy = by, GrantedAt = now,
        });
    }

    private static void End(RoleAssignment a, string by)
    {
        a.Status = AssignmentStatuses.Ended;
        a.EndedBy = by;
        a.EndedAt = DateTimeOffset.UtcNow;
        a.Version++;
    }

    /// <summary>An invitation is a sign-in link that lasts a week; using it accepts the invitation.</summary>
    internal static async Task SendInvitation(HumoDbContext db, IEmailSender email, AppOptions app, TimeProvider clock, HumoUser user, string organisation, ILoggerFactory logs, CancellationToken ct)
    {
        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var now = clock.GetUtcNow();
        db.SignInLinks.Add(new SignInLink { Id = Guid.CreateVersion7(), UserId = user.Id, TokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))), CreatedAt = now, ExpiresAt = now + InvitationLifetime });
        var url = $"{app.PublicUrl.TrimEnd('/')}/sign-in/link?token={token}";
        try
        {
            await email.SendAsync(new EmailMessage(user.Email!, $"You’re invited to {organisation} on Humo Property Management",
                $"Hello {user.Name},\n\n{organisation} has invited you to Humo Property Management.\n\nAccept the invitation with this link (it works once, for 7 days), then set up a passkey so you can sign in with your fingerprint, face or screen lock:\n\n{url}\n\nIf you weren’t expecting this, ignore this email.\n\nHumo Property Management"), ct);
        }
        catch (Exception e)
        {
            // The invitation stands; it can be resent. The failure is logged for the IT Technician (doc 26 §8).
            logs.CreateLogger("Humo.Access").LogError(e, "Couldn't send an invitation");
        }
    }

    /// <summary>The identity as an organisation sees it: only its own membership and roles (other agencies' stay private).</summary>
    private static IdentityDto View(HumoUser u, Guid? org)
    {
        var dto = SessionBuilder.ToDto(u);
        if (org is not { } id) return dto;
        return dto with
        {
            Memberships = dto.Memberships.Where(m => m.OrganisationId == id.ToString()).ToList(),
            Assignments = dto.Assignments.Where(a => a.Scope.OrganisationId == id.ToString()).ToList(),
        };
    }

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex Email();
}
