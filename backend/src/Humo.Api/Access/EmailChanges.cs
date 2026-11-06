using System.Security.Cryptography;
using System.Text;
using Humo.Api.Audit;
using Humo.Api.Commands;
using Humo.Api.Portfolio;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Access;

public sealed record EmailChangeDto(string Id, string Name, string OldEmail, string NewEmail, string RequestedBy, string RequestedAt, string ExpiresAt);

public sealed record PersonEmailStateDto(bool SignsIn, EmailChangeDto? Pending);

public sealed record EmailMismatchDto(string IdentityId, string PersonId, string Name, string ContactEmail, string SignInEmail);

public sealed record EmailReviewDto(List<EmailChangeDto> Pending, List<EmailMismatchDto> Mismatches);

public sealed record ConfirmEmailChangeRequest(string? Token);

public sealed record ResolveEmailMismatchRequest(string? Use);

/// <summary>
/// D34: one email address per person. Whoever controls a sign-in's email can sign in with an email link, so moving it
/// needs the new address to confirm; the old address is told, and nothing changes until then.
/// </summary>
public sealed class EmailChanges(HumoDbContext db, IEmailSender email, IOptions<AppOptions> app, TimeProvider clock, ILogger<EmailChanges> logs)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(7);

    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static EmailChangeDto ToDto(EmailChange c, string name) =>
        new(c.Id.ToString(), name, c.OldEmail, c.NewEmail, c.RequestedBy, c.RequestedAt.ToString("O"), c.ExpiresAt.ToString("O"));

    public async Task<EmailChange?> OpenForAsync(Guid userId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        return (await db.EmailChanges.Where(c => c.UserId == userId && c.ConfirmedAt == null && c.CancelledAt == null).ToListAsync(ct)).FirstOrDefault(c => c.ExpiresAt > now);
    }

    /// <summary>Asks the new address to confirm and tells the old one. Replaces a change still waiting. Sends after the command saves.</summary>
    public async Task RequestAsync(HumoUser user, Guid? personId, Guid? organisationId, string newEmail, string by, CommandRunner commands, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        foreach (var open in await db.EmailChanges.Where(c => c.UserId == user.Id && c.ConfirmedAt == null && c.CancelledAt == null).ToListAsync(ct))
        {
            open.CancelledAt = now;
            open.CancelledBy = $"{by} (replaced)";
        }
        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var oldEmail = user.Email ?? "";
        db.EmailChanges.Add(new EmailChange
        {
            Id = Guid.CreateVersion7(), UserId = user.Id, PersonId = personId, OrganisationId = organisationId, OldEmail = oldEmail, NewEmail = newEmail, TokenHash = Hash(token),
            RequestedBy = by, RequestedAt = now, ExpiresAt = now + Lifetime,
        });
        var url = $"{app.Value.PublicUrl.TrimEnd('/')}/confirm-email?token={token}";
        commands.AfterCommit(async () =>
        {
            await SendAsync(new EmailMessage(newEmail, "Confirm your new email for Humo Property Management",
                $"Hello {user.Name},\n\n{by} asked to change your email for Humo Property Management to this address.\n\nConfirm it with this link (it works once, for 7 days):\n{url}\n\nYour statements and sign-in links keep going to your old address until you do. If you weren't expecting this, ignore this email."), ct);
            if (oldEmail.Length > 0)
                await SendAsync(new EmailMessage(oldEmail, "A change of email was requested on your Humo Property Management account",
                    $"Hello {user.Name},\n\n{by} asked to change your email for Humo Property Management to {newEmail}. Nothing changes unless that address confirms it.\n\nIf this wasn't you, contact your managing agent straight away."), ct);
        });
    }

    /// <summary>A failed email never undoes the change: it's logged, and the request can be made again (docs/26 §8).</summary>
    public async Task SendAsync(EmailMessage message, CancellationToken ct)
    {
        try
        {
            await email.SendAsync(message, ct);
        }
        catch (Exception e)
        {
            logs.LogError(e, "Couldn't send an email-change message");
        }
    }
}

/// <summary>
///   POST /auth/email-change/confirm             the link from the new address (no session needed)
///   GET  /people/{id}/email-change              whether they sign in, and any change still waiting
///   POST /email-changes/{id}/cancel             People.Manage or Users.Manage
///   GET  /access/email-review                   changes waiting, and people whose two addresses differ (Users.Manage)
///   POST /access/identities/{id}/email-mismatch keep the sign-in address, or ask the contact address to confirm
/// </summary>
public static class EmailChangeEndpoints
{
    public static void MapEmailChanges(this IEndpointRouteBuilder api)
    {
        api.MapGroup("/auth").RequireRateLimiting(Auth.RateLimits.SignIn).MapPost("/email-change/confirm", Confirm).AllowAnonymous();
        api.MapGet("/people/{id:guid}/email-change", PersonState).RequireAuthorization();
        api.MapPost("/email-changes/{id:guid}/cancel", Cancel).RequireAuthorization();
        api.MapGet("/access/email-review", Review).RequireAuthorization();
        api.MapPost("/access/identities/{id:guid}/email-mismatch", Resolve).RequireAuthorization();
    }

    private static async Task<IResult> Confirm(ConfirmEmailChangeRequest body, HumoDbContext db, EmailChanges changes, AuditLog audit, TimeProvider clock, IEmailSender email, IOptions<AppOptions> app,
        ILoggerFactory logs, CancellationToken ct)
    {
        const string Invalid = "This link was used already, was replaced by a newer one, or is too old. Ask your managing agent to send a new one.";
        var hash = EmailChanges.Hash(body.Token ?? "");
        var change = await db.EmailChanges.FirstOrDefaultAsync(c => c.TokenHash == hash, ct);
        var now = clock.GetUtcNow();
        if (change is null || change.ConfirmedAt is not null || change.CancelledAt is not null || change.ExpiresAt <= now) return Problems.Validation(new() { ["token"] = Invalid });
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == change.UserId, ct);
        if (user is null) return Problems.Validation(new() { ["token"] = Invalid });

        // Checked again: someone may have taken the address since it was asked for.
        var taken = await db.Users.AnyAsync(u => u.Id != user.Id && u.NormalizedEmail == change.NewEmail.ToUpperInvariant(), ct);
        var person = change.PersonId is { } pid ? await db.People.FirstOrDefaultAsync(p => p.Id == pid, ct) : null;
        var takenInDirectory = person is not null && await db.People.AnyAsync(p => p.OrganisationId == person.OrganisationId && p.Id != person.Id && p.Email.ToLower() == change.NewEmail.ToLower(), ct);
        if (taken || takenInDirectory) return Problems.Validation(new() { ["token"] = "Someone else already uses this email here. Ask your managing agent to check it." });

        user.Email = change.NewEmail;
        user.UserName = change.NewEmail;
        user.NormalizedEmail = change.NewEmail.ToUpperInvariant();
        user.NormalizedUserName = change.NewEmail.ToUpperInvariant();
        user.Version++;
        // Other sessions end, and a sign-in link still out at the old address stops working. Passkeys stay.
        user.SecurityStamp = Guid.NewGuid().ToString();
        foreach (var link in await db.SignInLinks.Where(l => l.UserId == user.Id && l.UsedAt == null).ToListAsync(ct)) link.UsedAt = now;
        if (person is not null)
        {
            person.Email = change.NewEmail;
            person.Version++;
        }
        change.ConfirmedAt = now;
        audit.Record($"Confirmed the change of email from {change.OldEmail} to {change.NewEmail}", "success", user, organisationId: change.OrganisationId, resource: "Identity", resourceId: user.Id.ToString());
        await db.SaveChangesAsync(ct);

        if (change.OldEmail.Length > 0)
            await changes.SendAsync(new EmailMessage(change.OldEmail, "Your Humo Property Management email has changed",
                $"Hello {user.Name},\n\nYour email for Humo Property Management is now {change.NewEmail}, and you've been signed out on other devices.\n\nIf this wasn't you, contact your managing agent straight away."), ct);
        // Their invitation link went to the old address and has just stopped working, so a new one goes to this one.
        if (user.Status == IdentityStatuses.Invited)
        {
            var organisation = change.OrganisationId is { } org ? await db.Organisations.Where(o => o.Id == org).Select(o => o.ShortName).FirstOrDefaultAsync(ct) : null;
            await AccessEndpoints.SendInvitation(db, email, app.Value, clock, user, organisation ?? "your agency", logs, ct);
            await db.SaveChangesAsync(ct);
        }
        return Results.Ok(new { email = change.NewEmail });
    }

    private static async Task<IResult> PersonState(Guid id, CurrentActor current, PortfolioReads reads, HumoDbContext db, EmailChanges changes, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if ((await reads.People(await reads.ReadableSchemes(actor, null, ct), q => q.Where(p => p.Id == id), ct)).Count == 0) return Problems.NotFound();
        var key = id.ToString();
        var user = await db.Users.FirstOrDefaultAsync(u => u.PersonId == key && u.Kind == IdentityKinds.Customer && u.Status != IdentityStatuses.Deactivated, ct);
        var open = user is null || !actor.Can("People.Manage") ? null : await changes.OpenForAsync(user.Id, ct);
        return Results.Ok(new PersonEmailStateDto(user is not null, open is null ? null : EmailChanges.ToDto(open, user!.Name)));
    }

    private static async Task<IResult> Cancel(Guid id, CurrentActor current, CommandRunner commands, PortfolioReads reads, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org } actor) return Results.Unauthorized();
        var change = await db.EmailChanges.FirstOrDefaultAsync(c => c.Id == id && c.OrganisationId == org, ct);
        if (change is null) return Problems.NotFound();
        // Staff who manage people cancel for the people they can see; administrators for anyone at the agency.
        var canSee = actor.Can("Users.Manage") || (change.PersonId is { } pid && (await reads.People(await reads.ReadableSchemes(actor, null, ct), q => q.Where(p => p.Id == pid), ct)).Count > 0);
        if (!canSee) return Problems.NotFound();
        return await commands.RunAsync(new CommandSpec($"Cancelled the change of email from {change.OldEmail} to {change.NewEmail}", actor.Can("Users.Manage") ? "Users.Manage" : "People.Manage")
        {
            Resource = "Identity",
            ResourceId = change.UserId.ToString(),
            Category = "security",
            // Cancelling leaves things as they are, so it doesn't ask for a passkey.
            StepUp = false,
            Validate = () => change.ConfirmedAt is not null || change.CancelledAt is not null ? new() { ["id"] = "It’s no longer waiting." } : [],
        }, a =>
        {
            change.CancelledAt = clock.GetUtcNow();
            change.CancelledBy = a.Human.Name;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static async Task<IResult> Review(CurrentActor current, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org } actor || !actor.Can("Users.Manage")) return Results.Ok(new EmailReviewDto([], []));
        var now = clock.GetUtcNow();
        var open = (await db.EmailChanges.Where(c => c.OrganisationId == org && c.ConfirmedAt == null && c.CancelledAt == null).ToListAsync(ct)).Where(c => c.ExpiresAt > now).ToList();
        var waiting = open.Select(c => c.UserId).ToHashSet();
        var names = await db.Users.Where(u => waiting.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Name, ct);
        var people = await db.People.Where(p => p.OrganisationId == org).Select(p => new { p.Id, p.DisplayName, p.Email }).ToListAsync(ct);
        var byId = people.ToDictionary(p => p.Id.ToString());
        var users = await db.Users.Where(u => u.PersonId != null && u.Kind == IdentityKinds.Customer && u.Status != IdentityStatuses.Deactivated && u.Memberships.Any(m => m.OrganisationId == org))
            .Select(u => new { u.Id, u.PersonId, u.Email }).ToListAsync(ct);
        var mismatches = users
            .Where(u => !waiting.Contains(u.Id) && byId.ContainsKey(u.PersonId!) && byId[u.PersonId!].Email.Trim().Length > 0 && !string.Equals(byId[u.PersonId!].Email.Trim(), u.Email, StringComparison.OrdinalIgnoreCase))
            .Select(u => new EmailMismatchDto(u.Id.ToString(), u.PersonId!, byId[u.PersonId!].DisplayName, byId[u.PersonId!].Email.Trim(), u.Email ?? ""))
            .OrderBy(m => m.Name).ToList();
        return Results.Ok(new EmailReviewDto([.. open.Select(c => EmailChanges.ToDto(c, names.GetValueOrDefault(c.UserId, "")))], mismatches));
    }

    private static async Task<IResult> Resolve(Guid id, ResolveEmailMismatchRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, EmailChanges changes, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org }) return Results.Unauthorized();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id && u.Memberships.Any(m => m.OrganisationId == org), ct);
        var person = user is not null && Guid.TryParse(user.PersonId, out var pid) ? await db.People.FirstOrDefaultAsync(p => p.Id == pid && p.OrganisationId == org, ct) : null;
        if (user is null || person is null) return Problems.NotFound();
        var keepSignIn = body.Use == "sign-in";
        var contact = person.Email.Trim().ToLowerInvariant();
        var signIn = user.Email ?? "";
        var signInTaken = !keepSignIn && await db.Users.AnyAsync(u => u.Id != id && u.NormalizedEmail == contact.ToUpperInvariant(), ct);
        var contactTaken = keepSignIn && await db.People.AnyAsync(p => p.OrganisationId == org && p.Id != person.Id && p.Email.ToLower() == signIn.ToLower(), ct);
        return await commands.RunAsync(new CommandSpec(keepSignIn
            ? $"Corrected {person.DisplayName}’s contact email from {person.Email} to their sign-in email, {signIn}"
            : $"Asked to change {person.DisplayName}’s sign-in email from {signIn} to their contact email, {contact}", "Users.Manage")
        {
            Resource = "Identity",
            ResourceId = id.ToString(),
            Category = "security",
            // Moving a sign-in is the sensitive direction; the address they already sign in with is proven.
            StepUp = !keepSignIn,
            Validate = () => body.Use is not ("sign-in" or "contact") ? new() { ["use"] = "Choose which address is right." }
                : signInTaken ? new() { ["use"] = "Someone else already signs in with the contact email." }
                : contactTaken ? new() { ["use"] = "Someone else here already has the sign-in email as their contact email." }
                : [],
        }, async a =>
        {
            if (keepSignIn)
            {
                person.Email = signIn;
                person.Version++;
            }
            else await changes.RequestAsync(user, person.Id, org, contact, a.Human.Name, commands, ct);
            return Results.NoContent();
        }, ct);
    }
}
