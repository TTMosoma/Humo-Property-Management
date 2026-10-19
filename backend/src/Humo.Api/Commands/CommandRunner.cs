using Humo.Api.Audit;
using Humo.Api.Platform;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Commands;

/// <summary>What a command is, for the checks and the audit log (doc 24 §1).</summary>
public sealed record CommandSpec(string Action, string Permission)
{
    public string? Resource { get; init; }
    public string? ResourceId { get; init; }
    /// <summary>The scheme the command touches: checked against a scheme-scoped assignment (D1, C4).</summary>
    public Guid? SchemeId { get; init; }
    public Guid? OrganisationId { get; init; }
    /// <summary>Force (true) or waive (false) step-up; null: the permission's default (C7).</summary>
    public bool? StepUp { get; init; }
    public int? ExpectedVersion { get; init; }
    public int? CurrentVersion { get; init; }
    /// <summary>Field → message, after authorisation (C6).</summary>
    public Func<Dictionary<string, string>>? Validate { get; init; }
    public string Category { get; init; } = "activity";
    /// <summary>The feature the customer's plan must include (docs/04: the API checks entitlements, not packages).</summary>
    public string? Feature { get; init; }
    /// <summary>Allowed in Observe impersonation (e.g. ending the impersonation itself).</summary>
    public bool AllowedWhileObserving { get; init; }
}

/// <summary>A refusal from inside the command (C8), e.g. a status move that isn't allowed. Audited as denied.</summary>
public sealed class CommandRefused(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>
/// Every command goes through the same checks, in the same order as the prototype's
/// gateway (doc 24 §1): permission → entitlement → scope → version → validation → step-up → apply → audit.
/// Nobody verifies a passkey for a request that was going to fail.
/// </summary>
public sealed class CommandRunner(CurrentActor current, HumoDbContext db, AuditLog audit, Notices notices, Commercial.CommercialRecords commercial, TimeProvider clock)
{
    /// <summary>A fresh step-up proof lasts 5 minutes (STEP_UP_FRESH_MS in the frontend).</summary>
    public static readonly TimeSpan StepUpFresh = TimeSpan.FromMinutes(5);

    public async Task<IResult> RunAsync(CommandSpec spec, Func<Actor, Task<IResult>> apply, CancellationToken ct)
    {
        var actor = await current.GetAsync(ct);
        if (actor is null) return Results.Unauthorized();

        if (actor.Observing && !spec.AllowedWhileObserving) return await Deny(actor, spec, "observe-only", "Observe mode is read-only", ct);
        if (!actor.Can(spec.Permission)) return await Deny(actor, spec, "forbidden", "Role does not have this permission", ct);
        if (spec.Feature is { } feature && (spec.OrganisationId ?? actor.OrganisationId) is { } org && !await commercial.EntitledAsync(org, feature, ct))
            return await Deny(actor, spec, "not-entitled", "Not included in the agency’s plan", ct);
        if (spec.SchemeId is { } scheme && !actor.CoversScheme(scheme)) return await Deny(actor, spec, "out-of-scope", "Outside the assignment's schemes (D1)", ct);

        if (spec.ExpectedVersion is { } expected && spec.CurrentVersion is { } now && expected != now) return Problems.Conflict();

        var errors = spec.Validate?.Invoke();
        if (errors is { Count: > 0 }) return Problems.Validation(errors);

        var needsProof = spec.StepUp ?? (AccessCatalogue.Permissions.TryGetValue(spec.Permission, out var p) && p.StepUp);
        if (needsProof && !(actor.StepUpAt is { } at && clock.GetUtcNow() - at < StepUpFresh)) return Problems.Policy("step-up-required", "Step-up verification was not fresh");

        IResult result;
        try
        {
            result = await apply(actor);
        }
        catch (CommandRefused refused)
        {
            return await Deny(actor, spec, refused.Code, refused.Message, ct);
        }

        audit.Record(spec.Action, "success", actor.Human, category: spec.Category, role: actor.Assignment.Role, organisationId: spec.OrganisationId ?? actor.OrganisationId,
            resource: spec.Resource, resourceId: spec.ResourceId, stepUpMethod: needsProof ? "passkey" : null,
            actingAs: actor.Impersonation is null ? null : actor.User, impersonation: actor.Impersonation, schemeId: spec.SchemeId);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            notices.Discard();
            return Problems.Conflict();
        }
        await notices.SendEmailsAsync(ct);
        return result;
    }

    private async Task<IResult> Deny(Actor actor, CommandSpec spec, string code, string reason, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        notices.Discard();
        audit.Record(spec.Action, "denied", actor.Human, reason: reason, category: spec.Category, role: actor.Assignment.Role, organisationId: spec.OrganisationId ?? actor.OrganisationId,
            resource: spec.Resource, resourceId: spec.ResourceId, actingAs: actor.Impersonation is null ? null : actor.User, impersonation: actor.Impersonation, schemeId: spec.SchemeId);
        await db.SaveChangesAsync(ct);
        return Problems.Policy(code, reason);
    }
}

/// <summary>ProblemDetails the frontend maps onto ApiError (docs/08 §4).</summary>
public static class Problems
{
    public static IResult Policy(string code, string title) =>
        Results.Problem(title: title, statusCode: StatusCodes.Status403Forbidden, extensions: new Dictionary<string, object?> { ["code"] = code });

    public static IResult Validation(Dictionary<string, string> errors) =>
        Results.Problem(title: "Some details need attention", statusCode: StatusCodes.Status422UnprocessableEntity, extensions: new Dictionary<string, object?> { ["errors"] = errors });

    public static IResult Conflict() => Results.Problem(title: "Someone else changed this first", statusCode: StatusCodes.Status409Conflict);

    public static IResult NotFound() => Results.Problem(title: "Not found", statusCode: StatusCodes.Status404NotFound);
}
