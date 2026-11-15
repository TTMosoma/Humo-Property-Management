using Humo.Api.Commands;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Platform;

public sealed record AppNotificationDto(string Id, string Kind, string Title, string Detail, string? SchemeId, IReadOnlyList<string> Audience, string At, bool Read, string Link);
public sealed record MarkReadRequest(List<string> Ids);

/// <summary>
/// Notifications: in the app (the topbar bell) and by email, to one person or to a role. The person
/// who acted never gets their own notice. Emails go only after the change is saved (the command runner
/// calls <see cref="SendEmailsAsync"/>), to people who are active and still hold the role (docs/18 R-9).
/// </summary>
public sealed class Notices(HumoDbContext db, TimeProvider clock, IEmailSender email, IOptions<AppOptions> app, ILogger<Notices> logger)
{
    private readonly List<(Notice Notice, Guid? ActorId)> queued = [];

    /// <param name="sendEmail">False for news that needs no action (e.g. a task that has closed itself): in the app only.</param>
    public void ToRole(string role, Guid? actorId, string title, string detail, string link, Guid? organisationId = null, string kind = "platform", bool sendEmail = true) =>
        Add(new Notice { Id = Guid.CreateVersion7(), Kind = kind, ToRole = role, ActorId = actorId, Title = title, Detail = detail, Link = link, OrganisationId = organisationId, At = clock.GetUtcNow() },
            sendEmail);

    /// <param name="sendEmail">False when the person chose not to hear about their work by email: the notice is in the app only.</param>
    /// <param name="kind">The bell's icon: maintenance, finance, compliance, communication, governance or platform.</param>
    public void ToPerson(Guid identityId, Guid? actorId, string title, string detail, string link, bool sendEmail = true, string kind = "platform")
    {
        if (identityId == actorId) return;
        Add(new Notice { Id = Guid.CreateVersion7(), Kind = kind, ToIdentityId = identityId, ActorId = actorId, Title = title, Detail = detail, Link = link, At = clock.GetUtcNow() }, sendEmail);
    }

    private void Add(Notice notice, bool sendEmail = true)
    {
        db.Notices.Add(notice);
        if (sendEmail) queued.Add((notice, notice.ActorId));
    }

    /// <summary>The command didn't go through: nothing to email.</summary>
    public void Discard() => queued.Clear();

    /// <summary>
    /// Emails the notices of a saved command. A failed email never undoes the change: the notice is in
    /// the app either way, and the failure is logged for the IT Technician (doc 26 §8).
    /// </summary>
    public async Task SendEmailsAsync(CancellationToken ct)
    {
        if (queued.Count == 0) return;
        var batch = queued.ToList();
        queued.Clear();
        var site = app.Value.PublicUrl.TrimEnd('/');
        foreach (var (notice, actorId) in batch)
        {
            foreach (var (address, name) in await Recipients(notice, actorId, ct))
            {
                try
                {
                    await email.SendAsync(new EmailMessage(address, notice.Title,
                        $"Hello {name},\n\n{notice.Detail}\n\nOpen it in Humo Property Management:\n\n{site}{notice.Link}\n\nYou get this email because it’s also in your notifications in Humo Property Management.\n\nHumo Property Management"), ct);
                }
                catch (Exception e)
                {
                    logger.LogError(e, "Couldn't email a notification to {To}: {Title}", SmtpEmailSender.Mask(address), notice.Title);
                }
            }
        }
    }

    /// <summary>The same people who see it in the app, as long as they're active: invited, suspended and deactivated people get nothing.</summary>
    private async Task<List<(string Email, string Name)>> Recipients(Notice notice, Guid? actorId, CancellationToken ct)
    {
        var people = db.Users.Where(u => u.Status == IdentityStatuses.Active && u.Email != null && u.Id != actorId);
        if (notice.ToIdentityId is { } person) people = people.Where(u => u.Id == person);
        else if (notice.ToRole is { } role)
            people = people.Where(u => db.RoleAssignments.Any(a => a.UserId == u.Id && a.Role == role && a.Status == AssignmentStatuses.Active
                && (notice.OrganisationId == null || a.OrganisationId == notice.OrganisationId)));
        else return [];
        return (await people.Select(u => new { u.Email, u.Name }).ToListAsync(ct)).Select(u => (u.Email!, u.Name)).ToList();
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
