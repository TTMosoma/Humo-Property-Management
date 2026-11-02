using System.Globalization;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Files;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Files;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Work;

/// <summary>Who else can approve an approval its preparer can't (D24), as the person deciding sees it.</summary>
/// <param name="Mode">"trustees": a trustee on Humo approves it; "alone": the trustees' permission is in force, so it can be approved alone;
/// "permission-needed": add the trustees' permission first.</param>
public sealed record SecondAuthoriserDto(string Mode, string Note);
public sealed record TrusteePermissionDto(string Id, string SchemeId, string FileId, string Summary, string GrantedOn, string Until, string AddedBy, string AddedAt,
    string? WithdrawnAt, string? WithdrawnBy, string? WithdrawnReason, bool InForce);
public sealed record SchemeAuthorityDto(string SchemeId, string SchemeName, int TrusteesOnHumo, TrusteePermissionDto? Permission, List<TrusteePermissionDto> History);
public sealed record WithdrawPermissionRequest(string? Reason);

/// <summary>
/// Approving with one authoriser (D24). When the person who prepared something is the agency's only approver, a trustee
/// of the scheme with a Humo sign-in approves it instead. Only where the scheme has no trustee on Humo can the agency
/// approve alone, and then only under the trustees' written permission (once per scheme, for up to 12 months), with a
/// passkey, after a 24-hour cooling-off, flagged in the audit log. The approver and the trustees on record are told when
/// it takes effect. There's no mode to switch off: once a second authoriser joins, approving alone simply stops applying.
/// </summary>
public sealed class SoleAuthority(HumoDbContext db, TimeProvider clock, Platform.Notices notices, Audit.AuditLog audit, SmsGateway sms, Messaging.MessageUsage usage,
    IEmailSender email, IEnumerable<IApprovalHandler> handlers, ILogger<SoleAuthority> logger)
{
    public static readonly TimeSpan CoolingOff = TimeSpan.FromHours(24);
    public const int MaxMonths = 12;
    public const string HeldStatus = "cooling-off";

    private DateTimeOffset Now => clock.GetUtcNow();
    public DateOnly Today => DateOnly.FromDateTime(Now.ToOffset(TimeSpan.FromHours(2)).DateTime);

    private static bool Covers(RoleAssignment a, Guid? schemeId) =>
        a.ScopeType == ScopeTypes.Organisation || (schemeId is { } s && a.SchemeIds.Contains(s.ToString()));

    /// <summary>The agency's staff who could decide this approval (active, by its roles, covering its scheme).</summary>
    public async Task<List<Guid>> StaffApproversAsync(WorkItemRow item, CancellationToken ct)
    {
        var roles = JsonSerializer.Deserialize<List<string>>(item.ApproverRoles) ?? [];
        var assignments = await db.RoleAssignments.AsNoTracking()
            .Where(a => a.OrganisationId == item.OrganisationId && a.Status == AssignmentStatuses.Active && roles.Contains(a.Role) && a.Role != Roles.Trustee)
            .ToListAsync(ct);
        var users = assignments.Where(a => Covers(a, item.SchemeId)).Select(a => a.UserId).Distinct().ToList();
        return await db.Users.AsNoTracking().Where(u => users.Contains(u.Id) && u.Status == IdentityStatuses.Active).Select(u => u.Id).ToListAsync(ct);
    }

    /// <summary>Trustees of the scheme who have a Humo sign-in (D2: their access comes from the board register).</summary>
    public async Task<List<Guid>> TrusteesOnHumoAsync(Guid schemeId, CancellationToken ct)
    {
        var assignments = await db.RoleAssignments.AsNoTracking().Where(a => a.Role == Roles.Trustee && a.Status == AssignmentStatuses.Active).ToListAsync(ct);
        var users = assignments.Where(a => a.SchemeIds.Contains(schemeId.ToString())).Select(a => a.UserId).Distinct().ToList();
        return await db.Users.AsNoTracking().Where(u => users.Contains(u.Id) && u.Status == IdentityStatuses.Active).Select(u => u.Id).ToListAsync(ct);
    }

    public async Task<TrusteePermission?> InForceAsync(Guid schemeId, CancellationToken ct)
    {
        var today = Today;
        return (await db.TrusteePermissions.Where(p => p.SchemeId == schemeId && p.WithdrawnAt == null).ToListAsync(ct))
            .Where(p => p.Until >= today).OrderByDescending(p => p.AddedAt).FirstOrDefault();
    }

    /// <summary>
    /// For an approval its decider can't approve (they prepared it): who can. Null when another member of staff can,
    /// so the usual refusal stands.
    /// </summary>
    public async Task<SecondAuthoriserDto?> SecondAuthoriserAsync(WorkItemRow item, Guid deciderId, CancellationToken ct)
    {
        if (item.SchemeId is not { } scheme) return null;
        if ((await StaffApproversAsync(item, ct)).Any(u => u != deciderId)) return null;
        if ((await TrusteesOnHumoAsync(scheme, ct)).Count > 0)
            return new("trustees", "You’re the agency’s only approver for this, so one of the scheme’s trustees approves it in My work.");
        return await InForceAsync(scheme, ct) is { } p
            ? new("alone", $"The scheme has no trustee on Humo. Under the trustees’ permission ({p.Summary}), you can approve it alone with your passkey. It takes effect after 24 hours, and the trustees are told.")
            : new("permission-needed", "The scheme has no trustee on Humo and you’re the agency’s only approver. Add the trustees’ written permission in Settings › Agency to approve it alone, or invite a trustee.");
    }

    /// <summary>Trustees may decide an approval when the agency has no more than one member of staff who could (D24).</summary>
    public async Task<bool> TrusteeMayDecideAsync(WorkItemRow item, Actor actor, CancellationToken ct) =>
        actor.Assignment.Role == Roles.Trustee && item.SchemeId is { } s && actor.CoversScheme(s) && (await StaffApproversAsync(item, ct)).Count <= 1;

    /// <summary>Holds the approval for the cooling-off: it takes effect when <see cref="ReleaseDueAsync"/> runs after <see cref="CoolingOff"/>.</summary>
    public DateTimeOffset Hold(WorkItemRow item, Actor actor, TrusteePermission permission, string? comment)
    {
        item.Status = HeldStatus;
        item.HeldUntil = Now + CoolingOff;
        item.HeldById = actor.Human.Id;
        item.HeldBy = actor.Human.Name;
        item.HeldPermissionId = permission.Id;
        item.Comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();
        return item.HeldUntil.Value;
    }

    public static void CancelHold(WorkItemRow item)
    {
        item.Status = "open";
        (item.HeldUntil, item.HeldById, item.HeldBy, item.HeldPermissionId, item.Comment) = (null, null, null, null, null);
    }

    /// <summary>
    /// Approvals whose cooling-off is over take effect: the record moves on as if approved now, and the approver and the
    /// scheme's trustees on record are told. Runs every minute with the scheduled messages.
    /// </summary>
    public async Task ReleaseDueAsync(CancellationToken ct)
    {
        var now = Now;
        var due = (await db.WorkItems.Where(w => w.Status == HeldStatus).ToListAsync(ct)).Where(w => w.HeldUntil <= now).ToList();
        foreach (var item in due)
        {
            try
            {
                await ReleaseAsync(item, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError(e, "Approval {Ref} couldn’t take effect after its cooling-off; trying again in a minute", item.Ref);
                db.ChangeTracker.Clear();
            }
        }
    }

    private async Task ReleaseAsync(WorkItemRow item, CancellationToken ct)
    {
        // The scheme's trustees on record, signed in or not, loaded first: telling them is part of taking effect.
        var today = Today;
        var seats = (await db.Relationships.AsNoTracking().Where(r => r.SchemeId == item.SchemeId && r.Type == "trustee").ToListAsync(ct))
            .Where(r => r.Until is null || r.Until >= today).Select(r => r.PersonId).Distinct().ToList();
        var trustees = await db.People.AsNoTracking().Where(p => seats.Contains(p.Id)).Select(p => new { p.DisplayName, p.Email, p.Phone, p.PreferredChannel }).ToListAsync(ct);
        var user = await db.Users.FirstAsync(u => u.Id == item.HeldById, ct);
        var assignment = await db.RoleAssignments.FirstOrDefaultAsync(a => a.UserId == user.Id && a.OrganisationId == item.OrganisationId && a.Status == AssignmentStatuses.Active, ct)
            ?? new RoleAssignment { UserId = user.Id, OrganisationId = item.OrganisationId, Role = Roles.AgencyAdmin };
        var actor = new Actor(user, assignment, new HashSet<string>(), null);
        item.Status = "approved";
        item.DecidedBy = item.HeldBy;
        item.DecidedById = item.HeldById;
        item.DecidedAt = Now;
        if (handlers.FirstOrDefault(h => h.Type == item.Type) is { } handler) await handler.DecidedAsync(item, actor, true, item.Comment, ct);

        var scheme = await db.Schemes.AsNoTracking().FirstAsync(s => s.Id == item.SchemeId, ct);
        var org = await db.Organisations.AsNoTracking().FirstAsync(o => o.Id == item.OrganisationId, ct);
        var what = $"{item.Ref}: {item.Title}";

        // The trustees: the agency acted on the board's behalf. Who was told, and how, goes in the audit log and to the approver.
        var told = new List<string>();
        var notTold = new List<string>();
        foreach (var t in trustees)
        {
            var text = $"{org.ShortName} approved {what} for {scheme.Name} on the board’s behalf, under the trustees’ written permission. It took effect today after a 24-hour cooling-off. If the board didn’t agree to this, contact {org.ShortName} straight away.";
            var how = new List<string>();
            if (Settings.SettingsEndpoints.IsEmail(t.Email))
            {
                try
                {
                    await email.SendAsync(new EmailMessage(t.Email.Trim(), $"Approved on the board’s behalf: {item.Title}", $"Dear {t.DisplayName},\n\n{text}\n\n{org.ShortName}"), ct);
                    how.Add($"email ({t.Email.Trim()})");
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    logger.LogError(e, "The mail server didn’t accept the cooling-off notice for {Ref}", item.Ref);
                }
            }
            if ((t.PreferredChannel == "sms" || !Settings.SettingsEndpoints.IsEmail(t.Email)) && MobileNumber.TryNormalise(t.Phone, out var phone)
                && await TextAsync(phone, $"{org.ShortName}: {item.Ref} ({scheme.Name}) was approved on the board’s behalf and is now in effect. Not agreed? Contact {org.ShortName}.", item.OrganisationId, ct))
                how.Add($"SMS ({phone})");
            if (how.Count > 0) told.Add($"{t.DisplayName} by {string.Join(" and ", how)}");
            else notTold.Add(t.DisplayName);
        }
        var trusteesTold = Told(scheme.Name, told, notTold);
        audit.Record($"Approval {item.Ref} took effect after the cooling-off: approved alone by {item.HeldBy} under the trustees’ permission (D24). {trusteesTold}", "success",
            category: "security", organisationId: item.OrganisationId, schemeId: item.SchemeId, resource: "Approval", resourceId: item.Id.ToString(), system: "Humo cooling-off");

        var prefs = await db.PersonalPreferences.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == user.Id, ct);
        var channels = (prefs?.Work ?? "email,portal").Split(',', StringSplitOptions.RemoveEmptyEntries);
        // The approver: in the app always; by email and SMS as they chose for their work (WhatsApp once it's on Humo).
        notices.ToPerson(user.Id, null, $"In effect: {what}", $"Your approval of {what} took effect after the 24-hour cooling-off. {trusteesTold}",
            item.Route, sendEmail: channels.Contains("email"));
        if (channels.Contains("sms") && MobileNumber.TryNormalise(user.PhoneNumber, out var mobile))
            await TextAsync(mobile, $"Humo PM: your approval of {item.Ref} ({scheme.Name}) is now in effect after the 24-hour cooling-off.", item.OrganisationId, ct);
        await db.SaveChangesAsync(ct);
        await notices.SendEmailsAsync(ct);
    }

    /// <summary>Who among the trustees on record was told, and how; or that there's nobody on record to tell.</summary>
    public static string Told(string scheme, IReadOnlyList<string> told, IReadOnlyList<string> notTold)
    {
        if (told.Count == 0 && notTold.Count == 0)
            return $"{scheme} has no trustees on record, so no trustee was told. Tell the trustees yourself.";
        var text = told.Count > 0 ? $"Trustees told: {string.Join("; ", told)}." : "No trustee could be told.";
        return notTold.Count > 0 ? $"{text} Not told (no working email or mobile on record): {string.Join(", ", notTold)}. Tell them yourself." : text;
    }

    /// <summary>True when the provider accepted it.</summary>
    private async Task<bool> TextAsync(string to, string text, Guid organisationId, CancellationToken ct)
    {
        var receipt = await sms.SendAsync(new SmsMessage(to, text), ct);
        if (receipt.Accepted) await usage.RecordAsync(organisationId, "sms", Messaging.MessageUsage.SmsUnits(text, receipt.Parts), ct);
        else logger.LogWarning("The SMS provider refused a cooling-off notice: {Error}", receipt.Error);
        return receipt.Accepted;
    }

    public TrusteePermissionDto ToDto(TrusteePermission p) => new(p.Id.ToString(), p.SchemeId.ToString(), p.FileId.ToString(), p.Summary,
        p.GrantedOn.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), p.Until.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), p.AddedBy, p.AddedAt.ToString("O"),
        p.WithdrawnAt?.ToString("O"), p.WithdrawnBy, p.WithdrawnReason, p.WithdrawnAt is null && p.Until >= Today);
}

/// <summary>The trustees' permission to approve alone (D24), in Settings › Agency.</summary>
public static class TrusteePermissionEndpoints
{
    public static void MapTrusteePermissions(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/trustee-permissions").RequireAuthorization();
        g.MapGet("", List);
        g.MapPost("", Add).DisableAntiforgery();
        g.MapPost("/{id:guid}/withdraw", Withdraw);
    }

    /// <summary>Each scheme in the agency: its trustees on Humo, and the permission in force with its history.</summary>
    private static async Task<IResult> List(CurrentActor current, HumoDbContext db, SoleAuthority sole, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { OrganisationId: { } org } actor || !actor.Can("Organisation.Manage")) return Results.Ok(Array.Empty<SchemeAuthorityDto>());
        var schemes = await db.Schemes.AsNoTracking().Where(s => s.OrganisationId == org).OrderBy(s => s.Name).ToListAsync(ct);
        var permissions = await db.TrusteePermissions.AsNoTracking().Where(p => p.OrganisationId == org).ToListAsync(ct);
        var list = new List<SchemeAuthorityDto>();
        foreach (var s in schemes)
        {
            var mine = permissions.Where(p => p.SchemeId == s.Id).OrderByDescending(p => p.AddedAt).Select(sole.ToDto).ToList();
            list.Add(new(s.Id.ToString(), s.Name, (await sole.TrusteesOnHumoAsync(s.Id, ct)).Count, mine.FirstOrDefault(p => p.InForce), mine));
        }
        return Results.Ok(list);
    }

    /// <summary>Uploads the trustees' signed permission (PDF) for a scheme with no trustee on Humo. Needs a fresh passkey.</summary>
    private static async Task<IResult> Add(HttpRequest request, CurrentActor current, CommandRunner commands, HumoDbContext db, SoleAuthority sole, IFileStore store,
        IFileScanner scanner, IOptions<FilesOptions> options, Commercial.PackageLimits limits, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var form = await request.ReadFormAsync(ct);
        if (!Guid.TryParse(form["schemeId"], out var schemeId)) return Problems.Validation(new() { ["schemeId"] = "Choose the scheme." });
        if (await db.Schemes.AsNoTracking().FirstOrDefaultAsync(s => s.Id == schemeId && s.OrganisationId == actor.OrganisationId, ct) is not { } scheme) return Problems.NotFound();
        var summary = form["summary"].ToString().Trim();
        var granted = DateOnly.TryParseExact(form["grantedOn"].ToString(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var g) ? g : (DateOnly?)null;
        DateOnly? until = DateOnly.TryParseExact(form["until"].ToString(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var u) ? u : granted?.AddMonths(SoleAuthority.MaxMonths);
        var trustees = (await sole.TrusteesOnHumoAsync(schemeId, ct)).Count;
        var today = sole.Today;

        var errors = new Dictionary<string, string>();
        if (trustees > 0) errors["schemeId"] = $"{scheme.Name} has a trustee on Humo, who approves in My work. The trustees’ permission is only for schemes with no trustee on Humo.";
        if (summary.Length < 10) errors["summary"] = "Say what it is and who signed it, e.g. “Resolution of 12 October 2026, signed by J Smith and T Dlamini”.";
        if (granted is null || granted > today) errors["grantedOn"] = "The date the trustees signed it (today or earlier).";
        else if (until is null || until <= today) errors["until"] = "It has to still be in force.";
        else if (until > granted.Value.AddMonths(SoleAuthority.MaxMonths)) errors["until"] = $"Up to {SoleAuthority.MaxMonths} months from the date it was signed. Renew it with a new one after that.";
        if (form.Files.Count == 0) errors["file"] = "Attach the signed permission as a PDF.";
        if (errors.Count > 0) return Problems.Validation(errors);
        var (accepted, refusal) = await PdfIntake.CheckAsync(form.Files.FirstOrDefault(), options.Value.MaxBytes, scanner, ct);
        if (refusal is not null) return refusal;
        if (await limits.RefuseNewFileAsync(scheme.OrganisationId, accepted!.Bytes.Length, ct) is { } full) return Problems.Validation(new() { ["file"] = full });

        return await commands.RunAsync(new CommandSpec($"Added the trustees’ permission to approve alone on {scheme.Name} (D24): {summary}, until {until:d MMMM yyyy}", "Organisation.Manage")
        {
            Resource = "Scheme",
            ResourceId = schemeId.ToString(),
            SchemeId = schemeId,
            Category = "security",
            // It lets one person approve on the board's behalf: verify it's really them.
            StepUp = true,
        }, async writer =>
        {
            var key = await store.SaveAsync(accepted.Bytes, ct);
            var fileId = Guid.CreateVersion7();
            db.UploadedFiles.Add(new UploadedFile
            {
                Id = fileId, OrganisationId = scheme.OrganisationId, SchemeId = schemeId, Name = accepted.Name, ContentType = "application/pdf", SizeBytes = accepted.Bytes.Length,
                Sha256 = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(accepted.Bytes)), StorageKey = key, ScanResult = "clean",
                UploadedBy = writer.Human.Name, UploadedAt = clock.GetUtcNow(),
            });
            // A new permission replaces the one in force.
            foreach (var old in await db.TrusteePermissions.Where(p => p.SchemeId == schemeId && p.WithdrawnAt == null).ToListAsync(ct))
                (old.WithdrawnAt, old.WithdrawnBy, old.WithdrawnReason) = (clock.GetUtcNow(), writer.Human.Name, "Replaced by a newer permission");
            var id = Guid.CreateVersion7();
            db.TrusteePermissions.Add(new TrusteePermission
            {
                Id = id, OrganisationId = scheme.OrganisationId, SchemeId = schemeId, FileId = fileId, Summary = summary, GrantedOn = granted!.Value, Until = until!.Value,
                AddedById = writer.Human.Id, AddedBy = writer.Human.Name, AddedAt = clock.GetUtcNow(),
            });
            return Results.Created($"/api/trustee-permissions/{id}", new { id = id.ToString() });
        }, ct);
    }

    private static async Task<IResult> Withdraw(Guid id, WithdrawPermissionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var p = await db.TrusteePermissions.FirstOrDefaultAsync(x => x.Id == id && x.OrganisationId == actor.OrganisationId, ct);
        if (p is null) return Problems.NotFound();
        return await commands.RunAsync(new CommandSpec($"Withdrew the trustees’ permission to approve alone ({p.Summary}) — {body.Reason?.Trim()}", "Organisation.Manage")
        {
            Resource = "Scheme",
            ResourceId = p.SchemeId.ToString(),
            SchemeId = p.SchemeId,
            Category = "security",
            Validate = () => p.WithdrawnAt is not null ? new() { ["id"] = "It’s already withdrawn." }
                : (body.Reason ?? "").Trim().Length < 5 ? new() { ["reason"] = "Say why, in a few words." } : [],
        }, writer =>
        {
            (p.WithdrawnAt, p.WithdrawnBy, p.WithdrawnReason) = (clock.GetUtcNow(), writer.Human.Name, body.Reason!.Trim());
            return Task.FromResult(Results.NoContent());
        }, ct);
    }
}
