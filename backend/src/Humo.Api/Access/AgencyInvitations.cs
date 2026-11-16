using System.Security.Claims;
using System.Text.RegularExpressions;
using Humo.Api.Audit;
using Humo.Api.Commands;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Access;

public sealed record AgencyInvitationDto(string OrganisationId, string Organisation, string InvitedAt, string Name, string Email, string Phone, IReadOnlyList<string> Roles);

/// <param name="Name">Their name as they'd like this agency to have it, when what it entered is wrong.</param>
/// <param name="Phone">Their mobile number for this agency, when what it entered is wrong or missing.</param>
public sealed record AcceptInvitationRequest(string? Name, string? Phone);

/// <summary>
/// D46: one Humo sign-in, many agencies. When an agency invites someone who already signs in to Humo for another agency,
/// nothing applies until they accept. They see what the new agency recorded about them and can put it right as they accept;
/// or they decline, and the agency sees only that the invitation was declined. Neither agency ever sees the other's record
/// (POPIA: each agency is the responsible party for its own).
/// </summary>
public static partial class AgencyInvitations
{
    public static void MapAgencyInvitations(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/me/invitations").RequireAuthorization();
        g.MapGet("", Mine);
        g.MapPost("/{organisationId:guid}/accept", Accept);
        g.MapPost("/{organisationId:guid}/decline", Decline);
    }

    /// <summary>The bell (and its email) for the person invited. The email goes to their own address, by their own name.</summary>
    internal static void Tell(Platform.Notices notices, HumoUser user, Guid? actorId, string organisation, string roleLabel) =>
        notices.ToPerson(user.Id, actorId, $"{organisation} invites you to Humo Property Management",
            $"{organisation} has invited you as {roleLabel}. You already sign in to Humo, so there’s nothing to set up: check the details {organisation} has for you, then accept or decline. Nothing changes until you do.",
            "/invitations");

    private static async Task<IResult> Mine(ClaimsPrincipal principal, UserManager<HumoUser> users, HumoDbContext db, CancellationToken ct)
    {
        if (await Me(principal, users, db, ct) is not { } user) return Results.Unauthorized();
        var waiting = user.Memberships.Where(m => m.Status == MembershipStatuses.Invited).ToList();
        if (waiting.Count == 0) return Results.Ok(Array.Empty<AgencyInvitationDto>());
        var orgIds = waiting.Select(m => m.OrganisationId).ToList();
        var orgs = await db.Organisations.AsNoTracking().Where(o => orgIds.Contains(o.Id)).ToDictionaryAsync(o => o.Id, o => o.Name, ct);
        var personIds = waiting.Where(m => m.PersonId != null).Select(m => m.PersonId!.Value).ToList();
        var people = await db.People.AsNoTracking().Where(p => personIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        return Results.Ok(waiting.OrderBy(m => m.Since).Select(m =>
        {
            var person = m.PersonId is { } pid ? people.GetValueOrDefault(pid) : null;
            var roles = user.Assignments.Where(a => a.OrganisationId == m.OrganisationId && a.Status == AssignmentStatuses.Active)
                .Select(a => $"{Domain.Access.Roles.Label(a.Role)} · {a.Label}").ToList();
            return new AgencyInvitationDto(m.OrganisationId.ToString(), orgs.GetValueOrDefault(m.OrganisationId) ?? "", m.Since.ToString("O"),
                person?.DisplayName ?? m.Name ?? user.Name, person?.Email is { Length: > 0 } e ? e : user.Email ?? "", person?.Phone ?? "", roles);
        }));
    }

    private static async Task<IResult> Accept(Guid organisationId, AcceptInvitationRequest? body, ClaimsPrincipal principal, UserManager<HumoUser> users, HumoDbContext db,
        AuditLog audit, Platform.Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await Me(principal, users, db, ct) is not { } user) return Results.Unauthorized();
        if (await Commands.CurrentActor.ActiveImpersonation(db, principal, user.Id, ct) is not null) return Problems.Policy("forbidden", "Only they can accept an invitation, not someone acting for them.");
        var membership = user.Memberships.FirstOrDefault(m => m.OrganisationId == organisationId && m.Status == MembershipStatuses.Invited);
        if (membership is null) return Problems.NotFound();
        var person = membership.PersonId is { } pid ? await db.People.FirstOrDefaultAsync(p => p.Id == pid && p.OrganisationId == organisationId, ct) : null;

        var name = Regex.Replace((body?.Name ?? "").Trim(), @"\s+", " ");
        var phone = Regex.Replace((body?.Phone ?? "").Trim(), @"[\s\-()]", "");
        var errors = new Dictionary<string, string>();
        if (name.Length > 0 && name.Split(' ').Length < 2) errors["name"] = "Enter your first name and surname.";
        if (name.Length > 200) errors["name"] = "That name is too long.";
        if (phone.Length > 0 && !Phone().IsMatch(phone)) errors["phone"] = "Enter a South African mobile number, like 082 123 4567.";
        if (errors.Count > 0) return Problems.Validation(errors);

        var now = clock.GetUtcNow();
        var known = person?.DisplayName ?? membership.Name ?? user.Name;
        var corrected = new List<string>();
        if (name.Length > 0 && name != known)
        {
            corrected.Add($"name ({known} → {name})");
            membership.Name = name;
            if (person is { Kind: "individual" })
            {
                var parts = name.Split(' ');
                person.FirstName = parts[0];
                person.LastName = string.Join(' ', parts[1..]);
                person.DisplayName = name;
                person.Initials = Session.SessionBuilder.Initials(name);
                person.Version++;
            }
        }
        if (phone.Length > 0 && person is not null && phone != person.Phone)
        {
            corrected.Add(person.Phone.Length == 0 ? "mobile number (added)" : "mobile number");
            person.Phone = phone;
            person.Version++;
        }
        membership.Status = MembershipStatuses.Active;
        membership.AcceptedAt = now;
        var who = membership.Name ?? known;

        audit.Record(corrected.Count == 0 ? $"{who} accepted the invitation" : $"{who} accepted the invitation and corrected their {string.Join(" and ", corrected)}",
            "success", user, category: "security", organisationId: organisationId, resource: "Identity", resourceId: user.Id.ToString());
        notices.ToRole(Domain.Access.Roles.AgencyAdmin, user.Id, $"{who} accepted their invitation",
            corrected.Count == 0 ? $"{who} can now sign in to your agency." : $"{who} can now sign in to your agency. They corrected their {string.Join(" and ", corrected)} in your records.",
            "/settings/users", organisationId);
        await db.SaveChangesAsync(ct);
        await notices.SendEmailsAsync(ct);
        return Results.NoContent();
    }

    private static async Task<IResult> Decline(Guid organisationId, ClaimsPrincipal principal, UserManager<HumoUser> users, HumoDbContext db, AuditLog audit,
        Platform.Notices notices, TimeProvider clock, CancellationToken ct)
    {
        if (await Me(principal, users, db, ct) is not { } user) return Results.Unauthorized();
        if (await Commands.CurrentActor.ActiveImpersonation(db, principal, user.Id, ct) is not null) return Problems.Policy("forbidden", "Only they can decline an invitation, not someone acting for them.");
        var membership = user.Memberships.FirstOrDefault(m => m.OrganisationId == organisationId && m.Status == MembershipStatuses.Invited);
        if (membership is null) return Problems.NotFound();

        var now = clock.GetUtcNow();
        membership.Status = MembershipStatuses.Ended;
        membership.EndedAt = now;
        foreach (var a in user.Assignments.Where(a => a.OrganisationId == organisationId && a.Status == AssignmentStatuses.Active))
        {
            a.Status = AssignmentStatuses.Ended;
            a.EndedBy = $"{membership.Name ?? user.Name} (declined the invitation)";
            a.EndedAt = now;
            a.Version++;
        }
        var who = membership.Name ?? user.Name;
        audit.Record($"{who} declined the invitation", "success", user, category: "security", organisationId: organisationId, resource: "Identity", resourceId: user.Id.ToString());
        notices.ToRole(Domain.Access.Roles.AgencyAdmin, user.Id, $"{who} declined their invitation",
            $"{who} won’t be signing in to your agency. Their record in your directory is unchanged.", "/settings/users", organisationId);
        await db.SaveChangesAsync(ct);
        await notices.SendEmailsAsync(ct);
        return Results.NoContent();
    }

    private static async Task<HumoUser?> Me(ClaimsPrincipal principal, UserManager<HumoUser> users, HumoDbContext db, CancellationToken ct) =>
        Guid.TryParse(users.GetUserId(principal), out var id)
            ? await db.Users.Include(u => u.Memberships).Include(u => u.Assignments).AsSplitQuery().FirstOrDefaultAsync(u => u.Id == id && u.Status == IdentityStatuses.Active, ct)
            : null;

    [GeneratedRegex(@"^(\+27|0)[6-8][0-9]{8}$")]
    private static partial Regex Phone();
}
