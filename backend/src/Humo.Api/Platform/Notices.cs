using Humo.Api.Commands;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Platform;

public sealed record AppNotificationDto(string Id, string Kind, string Title, string Detail, string? SchemeId, IReadOnlyList<string> Audience, string At, bool Read, string Link);
public sealed record MarkReadRequest(List<string> Ids);

/// <summary>
/// In-app notifications (the topbar bell): to one person or to a role. The person who acted
/// never gets their own notice. Email for the same events is a later integration (docs/18 R-9).
/// </summary>
public sealed class Notices(HumoDbContext db, TimeProvider clock)
{
    public void ToRole(string role, Guid? actorId, string title, string detail, string link, Guid? organisationId = null) =>
        db.Notices.Add(new Notice { Id = Guid.CreateVersion7(), ToRole = role, ActorId = actorId, Title = title, Detail = detail, Link = link, OrganisationId = organisationId, At = clock.GetUtcNow() });

    public void ToPerson(Guid identityId, Guid? actorId, string title, string detail, string link)
    {
        if (identityId == actorId) return;
        db.Notices.Add(new Notice { Id = Guid.CreateVersion7(), ToIdentityId = identityId, ActorId = actorId, Title = title, Detail = detail, Link = link, At = clock.GetUtcNow() });
    }

    public static void MapNotifications(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/notifications").RequireAuthorization();
        g.MapGet("", List);
        g.MapPost("/read", MarkRead);
    }

    /// <summary>The signed-in person's notices for their active role, newest first.</summary>
    private static async Task<IResult> List(CurrentActor current, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var me = actor.User.Id;
        var role = actor.Assignment.Role;
        var notices = await db.Notices
            .Where(n => n.ActorId != me && (n.ToIdentityId == me || (n.ToRole == role && (n.OrganisationId == null || n.OrganisationId == actor.OrganisationId))))
            .ToListAsync(ct);
        // Ordered here, not in SQL: date-time offsets don't sort in every database the tests use.
        notices = notices.OrderByDescending(n => n.At).Take(100).ToList();
        var ids = notices.Select(n => n.Id).ToList();
        var read = (await db.NoticeReads.Where(r => r.IdentityId == me && ids.Contains(r.NoticeId)).Select(r => r.NoticeId).ToListAsync(ct)).ToHashSet();
        return Results.Ok(notices.Select(n => new AppNotificationDto(n.Id.ToString(), n.Kind, n.Title, n.Detail, null, [n.ToRole ?? role], n.At.ToString("O"), read.Contains(n.Id), n.Link)));
    }

    private static async Task<IResult> MarkRead(MarkReadRequest body, CurrentActor current, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var ids = (body.Ids ?? []).Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToList();
        var already = await db.NoticeReads.Where(r => r.IdentityId == actor.User.Id && ids.Contains(r.NoticeId)).Select(r => r.NoticeId).ToListAsync(ct);
        foreach (var id in ids.Except(already)) db.NoticeReads.Add(new NoticeRead { NoticeId = id, IdentityId = actor.User.Id, At = clock.GetUtcNow() });
        await db.SaveChangesAsync(ct);
        return Results.NoContent();
    }
}
