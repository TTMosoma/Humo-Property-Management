using System.Text;
using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Audit;

public sealed record AuditPartyDto(string IdentityId, string Name);
public sealed record AuditStepUpDto(string Method, string? Device);
public sealed record AuditImpersonationDto(string Mode, string Reason, string? Note);
public sealed record AuditSessionDto(string Ip, string Device, string SessionId);
public sealed record AuditEventDto(string Id, string At, string Category, AuditPartyDto Actor, AuditPartyDto? ActingAs, string Role, string? OrganisationId, string? SchemeId,
    string Action, string? Resource, string? ResourceId, string Result, string? Reason, AuditStepUpDto? StepUp, AuditImpersonationDto? Impersonation, AuditSessionDto Session);
public sealed record AuditExportRequest(string? OrganisationId, string? Category, string? IdentityId);

/// <summary>
/// Reading the audit log (doc 24 §8): an agency's own events with Audit.View; every event with
/// Platform.Audit. Exporting needs step-up and is itself audited. Nothing is ever edited or deleted.
/// </summary>
public static class AuditEndpoints
{
    public static void MapAudit(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/audit").RequireAuthorization();
        g.MapGet("", Query);
        g.MapPost("/export", Export);
    }

    private static async Task<IResult> Query(string? organisationId, string? category, string? identityId, int? page, int? pageSize, CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var scope = Scope(actor, organisationId);
        if (scope is null) return Problems.Policy("forbidden", "Role does not have this permission");
        var events = await Filtered(db, scope.Value.All ? null : scope.Value.Org, category, identityId, ct);
        return Results.Ok(PortfolioReads.Page(events.Select(ToDto).ToList(), page, pageSize));
    }

    private static async Task<IResult> Export(AuditExportRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var platform = body.OrganisationId is null;
        var org = Guid.TryParse(body.OrganisationId, out var o) ? o : actor.OrganisationId;
        var file = $"humo-audit-{(platform ? "platform" : org?.ToString())}-{clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)):yyyy-MM-dd}.csv";

        return await commands.RunAsync(new CommandSpec($"Exported the audit log ({body.Category ?? "all events"})", platform ? "Platform.Audit" : actor.IsHumo ? "Platform.Audit" : "Audit.View")
        {
            Resource = "Export",
            ResourceId = file,
            Category = "security",
            StepUp = true,
        }, async _ =>
        {
            var events = await Filtered(db, platform ? null : actor.IsHumo ? org : actor.OrganisationId, body.Category, body.IdentityId, ct);
            var csv = new StringBuilder("At,Category,Actor,Acting as,Role,Action,Resource,Resource id,Result,Reason\n");
            foreach (var e in events)
                csv.AppendLine(string.Join(',', new[] { e.At.ToString("O"), e.Category, e.ActorName, e.ActingAsName, e.Role, e.Action, e.Resource, e.ResourceId, e.Result, e.Reason }.Select(Cell)));
            return Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv.ToString())).ToArray(), "text/csv", file);
        }, ct);
    }

    /// <summary>Platform-wide needs Platform.Audit; an organisation's events need Audit.View in it (or Platform.Audit).</summary>
    private static (bool All, Guid? Org)? Scope(Actor actor, string? organisationId)
    {
        if (actor.Can("Platform.Audit")) return Guid.TryParse(organisationId, out var o) ? (false, o) : (true, null);
        if (actor.Can("Audit.View") && actor.OrganisationId is { } own) return (false, own);
        return null;
    }

    private static async Task<List<AuditEntry>> Filtered(HumoDbContext db, Guid? org, string? category, string? identityId, CancellationToken ct)
    {
        var q = db.Audit.AsQueryable();
        if (org is { } id) q = q.Where(e => e.OrganisationId == id);
        if (!string.IsNullOrWhiteSpace(category)) q = q.Where(e => e.Category == category);
        if (Guid.TryParse(identityId, out var who)) q = q.Where(e => e.ActorId == who || e.ActingAsId == who);
        // Newest first; ordered by insertion, which is append-only.
        return await q.OrderByDescending(e => e.Id).Take(5000).ToListAsync(ct);
    }

    private static AuditEventDto ToDto(AuditEntry e) => new(
        e.Id.ToString(), e.At.ToString("O"), e.Category, new AuditPartyDto(e.ActorId?.ToString() ?? "", e.ActorName),
        e.ActingAsId is { } a ? new AuditPartyDto(a.ToString(), e.ActingAsName ?? "") : null,
        e.Role ?? "", e.OrganisationId?.ToString(), e.SchemeId?.ToString(), e.Action, e.Resource, e.ResourceId, e.Result, e.Reason,
        e.StepUpMethod is { } m ? new AuditStepUpDto(m, null) : null,
        e.ImpersonationMode is { } mode ? new AuditImpersonationDto(mode, e.ImpersonationReason ?? "other", e.ImpersonationNote) : null,
        new AuditSessionDto(e.Ip ?? "", e.UserAgent ?? "", ""));

    private static string Cell(string? v)
    {
        v ??= "";
        // Spreadsheet formula injection: a leading = + - @ is neutralised.
        if (v.Length > 0 && "=+-@".Contains(v[0])) v = "'" + v;
        return v.Contains(',') || v.Contains('"') || v.Contains('\n') ? $"\"{v.Replace("\"", "\"\"")}\"" : v;
    }
}
