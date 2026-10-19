using System.Security.Claims;
using Humo.Api.Audit;
using Humo.Api.Auth;
using Humo.Api.Commands;
using Humo.Api.Session;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Platform;

public sealed record StartImpersonationRequest(string TargetId, string TargetAssignmentId, string Mode, string Reason, string? Note, string? Ticket);

/// <summary>
/// Impersonation (doc 24 §8): only a System Administrator with the individual System.Impersonate
/// grant, only of a customer identity. Act needs a fresh step-up; Observe changes nothing. Start,
/// refusal and end are audited, the end with its duration. Ending always succeeds.
/// </summary>
public static class ImpersonationEndpoints
{
    private static readonly string[] Reasons = ["support", "bug", "security", "data-correction", "other"];
    private static readonly Dictionary<string, string> ReasonLabels = new()
    {
        ["support"] = "Customer support investigation", ["bug"] = "Bug reproduction", ["security"] = "Security investigation",
        ["data-correction"] = "Data correction", ["other"] = "Other",
    };

    public static void MapImpersonation(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/me/impersonation").RequireAuthorization();
        g.MapPost("", Start);
        g.MapPost("/end", End);
    }

    private static async Task<IResult> Start(StartImpersonationRequest body, ClaimsPrincipal principal, UserManager<HumoUser> users, SignInManager<HumoUser> signIn,
        SessionBuilder sessions, HumoDbContext db, AuditLog audit, TimeProvider clock, CancellationToken ct)
    {
        if (!Guid.TryParse(users.GetUserId(principal), out var actorId) || await sessions.LoadUserAsync(actorId, ct) is not { Status: IdentityStatuses.Active } actor) return Results.Unauthorized();
        var mine = await sessions.BuildAsync(actor, principal.FindFirstValue(AuthEndpoints.AssignmentClaim), ct);
        if (!mine.SignedIn) return Results.Unauthorized();

        var target = Guid.TryParse(body.TargetId, out var tid) ? await sessions.LoadUserAsync(tid, ct) : null;
        var targetSession = target is null ? null : await sessions.BuildAsync(target, body.TargetAssignmentId, ct);
        var assignment = target?.Assignments.FirstOrDefault(a => a.Id.ToString() == body.TargetAssignmentId);
        var now = clock.GetUtcNow();
        var stepUpFresh = long.TryParse(principal.FindFirstValue(CurrentActor.StepUpClaim), out var s) && now - DateTimeOffset.FromUnixTimeSeconds(s) < CommandRunner.StepUpFresh;
        var mode = body.Mode == "act" ? "act" : "observe";
        var reason = Reasons.Contains(body.Reason) ? body.Reason : "other";
        var draft = new ImpersonationSession { Mode = mode, Reason = reason, Note = body.Note?.Trim(), Ticket = body.Ticket?.Trim() };

        string? refusal =
            principal.FindFirstValue(CurrentActor.ImpersonationClaim) is not null ? "Already impersonating" :
            !mine.ActorPermissions.Contains("System.Impersonate") ? "System.Impersonate not granted" :
            target is null || target.Kind != IdentityKinds.Customer || assignment is null || targetSession is not { SignedIn: true } || targetSession.ActiveAssignmentId != body.TargetAssignmentId
                ? "Target cannot be impersonated" : null;
        if (refusal is not null)
        {
            audit.Record("Tried to start impersonation", "denied", actor, reason: refusal, category: "impersonation", role: assignment?.Role ?? Roles.SystemAdmin,
                organisationId: assignment?.OrganisationId, resource: "Identity", resourceId: body.TargetId, actingAs: target, impersonation: draft);
            await db.SaveChangesAsync(ct);
            return Problems.Policy("forbidden", refusal);
        }
        // Act needs a fresh proof: a challenge, answered by verifying and starting again.
        if (mode == "act" && !stepUpFresh) return Problems.Policy("step-up-required", "Step-up verification was not fresh");

        var session = new ImpersonationSession
        {
            Id = Guid.CreateVersion7(), ActorId = actor.Id, TargetId = target!.Id, TargetAssignmentId = assignment!.Id, Mode = mode, Reason = reason,
            Note = string.IsNullOrWhiteSpace(body.Note) ? null : body.Note.Trim(), Ticket = string.IsNullOrWhiteSpace(body.Ticket) ? null : body.Ticket.Trim(), StartedAt = now,
        };
        db.ImpersonationSessions.Add(session);
        audit.Record($"Started impersonation ({(mode == "act" ? "Act" : "Observe")} · {ReasonLabels[reason]})", "success", actor, category: "impersonation", role: assignment.Role,
            organisationId: assignment.OrganisationId, resource: "Identity", resourceId: target.Id.ToString(), stepUpMethod: mode == "act" ? "passkey" : null, actingAs: target, impersonation: session);
        await db.SaveChangesAsync(ct);

        await signIn.SignInWithClaimsAsync(actor, isPersistent: false, Claims(principal, session.Id));
        return Results.Ok(new ImpersonationDto(session.Id.ToString(), actor.Id.ToString(), target.Id.ToString(), assignment.Id.ToString(), mode, reason, session.Note, session.Ticket, now.ToString("O")));
    }

    /// <summary>Always succeeds: the session ends server-side even if the response is lost.</summary>
    private static async Task<IResult> End(ClaimsPrincipal principal, UserManager<HumoUser> users, SignInManager<HumoUser> signIn, HumoDbContext db, AuditLog audit, TimeProvider clock, CancellationToken ct)
    {
        if (!Guid.TryParse(users.GetUserId(principal), out var actorId)) return Results.Unauthorized();
        var actor = await db.Users.FirstOrDefaultAsync(u => u.Id == actorId, ct);
        if (actor is null) return Results.Unauthorized();
        if (await CurrentActor.ActiveImpersonation(db, principal, actorId, ct) is { } imp)
        {
            imp.EndedAt = clock.GetUtcNow();
            var minutes = Math.Max(1, (int)Math.Round((imp.EndedAt.Value - imp.StartedAt).TotalMinutes));
            var target = await db.Users.FirstOrDefaultAsync(u => u.Id == imp.TargetId, ct);
            audit.Record($"Ended impersonation ({minutes} min)", "success", actor, category: "impersonation", resource: "Identity", resourceId: imp.TargetId.ToString(), actingAs: target, impersonation: imp);
            await db.SaveChangesAsync(ct);
        }
        await signIn.SignInWithClaimsAsync(actor, isPersistent: false, Claims(principal, null));
        return Results.NoContent();
    }

    /// <summary>Keeps the person's own role and step-up proof; sets or clears the impersonation.</summary>
    private static List<Claim> Claims(ClaimsPrincipal principal, Guid? impersonation)
    {
        var claims = new List<Claim>();
        if (principal.FindFirstValue(AuthEndpoints.AssignmentClaim) is { } a) claims.Add(new Claim(AuthEndpoints.AssignmentClaim, a));
        if (principal.FindFirstValue(CurrentActor.StepUpClaim) is { } s) claims.Add(new Claim(CurrentActor.StepUpClaim, s));
        if (impersonation is { } id) claims.Add(new Claim(CurrentActor.ImpersonationClaim, id.ToString()));
        return claims;
    }
}
