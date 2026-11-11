using System.Globalization;
using System.Security.Cryptography;
using Humo.Api.Commands;
using Humo.Api.Files;
using Humo.Api.Portfolio;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Files;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Work;

/// <param name="OnHumo">Signs in as a trustee of the scheme, so is asked in My work; otherwise their signed approval is needed.</param>
public sealed record BoardSeatDto(string PersonId, string Name, string? Decision, string? Source, bool OnHumo = false);
/// <param name="Needed">More than half the trustees on the board register (D39).</param>
public sealed record BoardProgressDto(int Trustees, int Needed, int Approvals, int Rejections, List<BoardSeatDto> Seats, bool MySeat, bool IVoted);
public sealed record DelegatedLimitRequest(decimal? Limit);

/// <summary>
/// D39: spending above a scheme's limit, and written resolutions, are the board's to approve. A majority of the trustees on
/// the board register decides: those on Humo in My work, the others by their signed approval, uploaded by the agency for
/// that one item. Every trustee on record is told about an upload at once, so a forged one is caught by the people it names.
/// </summary>
public sealed class BoardApprovals(HumoDbContext db, TimeProvider clock, Audit.AuditLog audit, SmsGateway sms, Messaging.MessageUsage usage, IEmailSender email,
    IEnumerable<IApprovalHandler> handlers, ILogger<BoardApprovals> logger)
{
    public const decimal DefaultLimit = 5_000;
    public const string SupportEmail = "support@humo.co.za";

    public sealed record Seat(Guid PersonId, string Name, string Email, string Phone, string PreferredChannel);

    public DateOnly Today => DateOnly.FromDateTime(clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).DateTime);

    /// <summary>The board register (D2): trustees in office, signed in to Humo or not.</summary>
    public async Task<List<Seat>> SeatsAsync(Guid schemeId, CancellationToken ct)
    {
        var today = Today;
        var people = (await db.Relationships.AsNoTracking().Where(r => r.SchemeId == schemeId && r.Type == "trustee").ToListAsync(ct))
            .Where(r => r.Until is null || r.Until >= today).Select(r => r.PersonId).Distinct().ToList();
        return (await db.People.AsNoTracking().Where(p => people.Contains(p.Id)).ToListAsync(ct))
            .Select(p => new Seat(p.Id, p.DisplayName, p.Email ?? "", p.Phone ?? "", p.PreferredChannel ?? "email")).OrderBy(s => s.Name).ToList();
    }

    public static int Majority(int trustees) => trustees / 2 + 1;

    /// <summary>The scheme's trustees who sign in to Humo: their person records and their sign-ins.</summary>
    private static async Task<List<(Guid PersonId, Guid UserId)>> TrusteeUsersAsync(HumoDbContext db, Guid schemeId, CancellationToken ct)
    {
        var assignments = await db.RoleAssignments.AsNoTracking().Where(a => a.Role == Roles.Trustee && a.Status == AssignmentStatuses.Active).ToListAsync(ct);
        var users = assignments.Where(a => a.SchemeIds.Contains(schemeId.ToString())).Select(a => a.UserId).Distinct().ToList();
        return (await db.Users.AsNoTracking().Where(u => users.Contains(u.Id) && u.Status == IdentityStatuses.Active && u.PersonId != null).Select(u => new { u.Id, u.PersonId }).ToListAsync(ct))
            .Where(u => Guid.TryParse(u.PersonId, out _)).Select(u => (Guid.Parse(u.PersonId!), u.Id)).ToList();
    }

    private static async Task<HashSet<Guid>> TrusteePeopleOnHumoAsync(HumoDbContext db, Guid schemeId, CancellationToken ct) =>
        [.. (await TrusteeUsersAsync(db, schemeId, ct)).Select(x => x.PersonId)];

    /// <summary>A notice to the scheme's trustees who sign in to Humo (in the app, and by email). The caller saves.</summary>
    public static async Task TellTrusteesOnHumoAsync(HumoDbContext db, Platform.Notices notices, Guid schemeId, Guid actorId, string title, string detail, string link, CancellationToken ct)
    {
        foreach (var (_, userId) in await TrusteeUsersAsync(db, schemeId, ct)) notices.ToPerson(userId, actorId, title, detail, link);
    }

    /// <summary>
    /// D39: something new for the board, in this command. Its trustees on Humo are told at once (in the app, and by email),
    /// so the board knows to act. Those not on Humo are the agency's to ask for a signed approval.
    /// </summary>
    public static async Task AskForAddedAsync(HumoDbContext db, Platform.Notices notices, Guid actorId, CancellationToken ct)
    {
        var added = db.ChangeTracker.Entries<WorkItemRow>().Where(e => e.State == EntityState.Added && e.Entity.BoardMajority && e.Entity.SchemeId is not null).Select(e => e.Entity).ToList();
        foreach (var item in added)
        {
            var scheme = await db.Schemes.AsNoTracking().FirstAsync(s => s.Id == item.SchemeId, ct);
            var amount = item.Amount is { } a ? $" · {Humo.Domain.Finance.BillingRules.Rand(a)}" : "";
            foreach (var (_, userId) in await TrusteeUsersAsync(db, scheme.Id, ct))
                notices.ToPerson(userId, actorId, $"For the board to decide: {item.Title}",
                    $"{scheme.Name}{amount}. A majority of the board decides. Approve or reject it in My work › Approvals.", "/approvals");
        }
    }

    public async Task<BoardProgressDto> ProgressAsync(WorkItemRow item, Actor? actor, CancellationToken ct)
    {
        var seats = item.SchemeId is { } s ? await SeatsAsync(s, ct) : [];
        var votes = await db.BoardVotes.AsNoTracking().Where(v => v.WorkItemId == item.Id).ToListAsync(ct);
        var me = Guid.TryParse(actor?.User.PersonId, out var p) ? p : Guid.Empty;
        var onHumo = item.SchemeId is { } scheme ? await TrusteePeopleOnHumoAsync(db, scheme, ct) : [];
        return new BoardProgressDto(seats.Count, Majority(seats.Count), votes.Count(v => v.Decision == "approved"), votes.Count(v => v.Decision == "rejected"),
            [.. seats.Select(x => votes.FirstOrDefault(v => v.PersonId == x.PersonId) is { } v ? new BoardSeatDto(x.PersonId.ToString(), x.Name, v.Decision, v.Source, onHumo.Contains(x.PersonId))
                : new BoardSeatDto(x.PersonId.ToString(), x.Name, null, null, onHumo.Contains(x.PersonId)))],
            seats.Any(x => x.PersonId == me), votes.Any(v => v.PersonId == me));
    }

    /// <summary>A trustee's own decision on Humo: one vote. The item is decided once a majority agrees.</summary>
    public async Task VoteAsync(WorkItemRow item, Actor actor, bool approve, string? comment, CancellationToken ct)
    {
        if (!Guid.TryParse(actor.User.PersonId, out var person) || item.SchemeId is not { } scheme || (await SeatsAsync(scheme, ct)).All(x => x.PersonId != person))
            throw new CommandRefused("forbidden", "Only a trustee on this scheme’s board decides this.");
        if (await db.BoardVotes.AnyAsync(v => v.WorkItemId == item.Id && v.PersonId == person, ct))
            throw new CommandRefused("conflict-of-interest", "You’ve already decided this. The rest of the board decides the outcome.");
        db.BoardVotes.Add(new BoardVote
        {
            Id = Guid.CreateVersion7(), WorkItemId = item.Id, PersonId = person, TrusteeName = actor.Human.Name, Decision = approve ? "approved" : "rejected", Source = "humo",
            Comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim(), RecordedBy = actor.Human.Name, RecordedAt = clock.GetUtcNow(),
        });
        await SettleAsync(item, actor, comment, ct, approve ? "approved" : "rejected", 1);
    }

    /// <summary>Decides the item when a majority has: approved, the record moves on; rejected, it goes back to the agency.</summary>
    public async Task SettleAsync(WorkItemRow item, Actor actor, string? comment, CancellationToken ct, string? adding = null, int added = 0)
    {
        var seats = item.SchemeId is { } s ? (await SeatsAsync(s, ct)).Count : 0;
        var votes = await db.BoardVotes.Where(v => v.WorkItemId == item.Id).ToListAsync(ct);
        var approvals = votes.Count(v => v.Decision == "approved") + (adding == "approved" ? added : 0);
        var rejections = votes.Count(v => v.Decision == "rejected") + (adding == "rejected" ? added : 0);
        var needed = Majority(seats);
        var outcome = seats == 0 ? null : approvals >= needed ? "approved" : rejections >= needed ? "rejected" : null;
        if (outcome is null) return;
        item.Status = outcome;
        item.DecidedBy = $"The board ({(outcome == "approved" ? approvals : rejections)} of {seats} trustees)";
        item.DecidedById = actor.Human.Id;
        item.DecidedAt = clock.GetUtcNow();
        item.Comment = string.IsNullOrWhiteSpace(comment) ? item.Comment : comment.Trim();
        if (handlers.FirstOrDefault(h => h.Type == item.Type) is { } handler) await handler.DecidedAsync(item, actor, outcome == "approved", item.Comment, ct);
    }

    /// <summary>
    /// Tells every trustee on record, by email, or SMS where they prefer it or have no email. What happened, and who is said to
    /// have agreed, so anyone named who didn't can say so at once. Who was told goes in the audit log.
    /// </summary>
    public async Task TellTrusteesAsync(Guid organisationId, Guid schemeId, string subject, string text, string smsText, CancellationToken ct)
    {
        var seats = await SeatsAsync(schemeId, ct);
        var told = new List<string>();
        var notTold = new List<string>();
        foreach (var t in seats)
        {
            var how = new List<string>();
            if (Settings.SettingsEndpoints.IsEmail(t.Email))
            {
                try
                {
                    await email.SendAsync(new EmailMessage(t.Email.Trim(), subject, $"Dear {t.Name},\n\n{text}\n\nIf this isn’t what the board agreed, contact the managing agent, or Humo Support at {SupportEmail}."), ct);
                    how.Add("email");
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    logger.LogError(e, "The mail server didn’t accept a board notice: {Subject}", subject);
                }
            }
            if ((t.PreferredChannel == "sms" || !Settings.SettingsEndpoints.IsEmail(t.Email)) && MobileNumber.TryNormalise(t.Phone, out var phone))
            {
                var receipt = await sms.SendAsync(new SmsMessage(phone, smsText), ct);
                if (receipt.Accepted)
                {
                    await usage.RecordAsync(organisationId, "sms", Messaging.MessageUsage.SmsUnits(smsText, receipt.Parts), ct);
                    how.Add("SMS");
                }
            }
            if (how.Count > 0) told.Add($"{t.Name} by {string.Join(" and ", how)}");
            else notTold.Add(t.Name);
        }
        var result = told.Count == 0 && notTold.Count == 0 ? "No trustees on record to tell."
            : $"Trustees told: {(told.Count > 0 ? string.Join("; ", told) : "none")}.{(notTold.Count > 0 ? $" Not told (no working email or mobile): {string.Join(", ", notTold)}." : "")}";
        audit.Record($"{subject}. {result}", "success", category: "security", organisationId: organisationId, schemeId: schemeId, system: "Humo board notice");
        await db.SaveChangesAsync(ct);
    }
}

/// <summary>
///   POST /work-items/{id}/board-approval   the board's signed approval of this one item, for trustees not on Humo (multipart, passkey)
///   POST /schemes/{id}/delegated-limit     the scheme's limit for agency approval (passkey)
/// </summary>
public static class BoardApprovalEndpoints
{
    public static void MapBoardApprovals(this IEndpointRouteBuilder api)
    {
        api.MapPost("/work-items/{id:guid}/board-approval", Upload).RequireAuthorization().DisableAntiforgery();
        api.MapPost("/schemes/{id:guid}/delegated-limit", SetLimit).RequireAuthorization();
    }

    private static async Task<IResult> Upload(Guid id, HttpRequest request, CurrentActor current, CommandRunner commands, HumoDbContext db, BoardApprovals board, IFileStore store,
        IFileScanner scanner, IOptions<FilesOptions> options, Commercial.PackageLimits limits, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var item = await db.WorkItems.FirstOrDefaultAsync(w => w.Id == id && w.OrganisationId == actor.OrganisationId, ct);
        if (item?.SchemeId is not { } schemeId || !await SchemeEndpoints.Visible(actor, db).AnyAsync(x => x.Id == schemeId, ct)) return Problems.NotFound();
        var scheme = await db.Schemes.AsNoTracking().FirstAsync(s => s.Id == schemeId, ct);
        var form = await request.ReadFormAsync(ct);
        var seats = await board.SeatsAsync(schemeId, ct);
        var voted = await db.BoardVotes.Where(v => v.WorkItemId == item.Id).Select(v => v.PersonId).ToListAsync(ct);
        var signers = form["signers"].SelectMany(x => (x ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)).Select(x => Guid.TryParse(x.Trim(), out var g) ? g : Guid.Empty).Distinct().ToList();
        var signedOn = DateOnly.TryParseExact(form["signedOn"].ToString(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : (DateOnly?)null;
        var created = DateOnly.FromDateTime(item.CreatedAt.ToOffset(TimeSpan.FromHours(2)).DateTime);

        var errors = new Dictionary<string, string>();
        if (!item.BoardMajority || item.Status != "open") errors["id"] = "This isn’t waiting for the board.";
        else if (signers.Count == 0) errors["signers"] = "Choose the trustees who signed it.";
        else if (signers.Any(x => seats.All(t => t.PersonId != x))) errors["signers"] = "Only trustees on the board register can sign for the board.";
        else if (signers.Any(voted.Contains)) errors["signers"] = "Someone you chose has already decided this.";
        if (signedOn is null || signedOn > board.Today) errors["signedOn"] = "The date they signed it (today or earlier).";
        else if (signedOn < created) errors["signedOn"] = $"It was signed before this was sent to the board ({created:d MMMM yyyy}), so it can’t be approval of this item.";
        if (form.Files.Count == 0) errors["file"] = "Attach the signed approval as a PDF.";
        if (errors.Count > 0) return Problems.Validation(errors);
        var (accepted, refusal) = await PdfIntake.CheckAsync(form.Files.FirstOrDefault(), options.Value.MaxBytes, scanner, ct);
        if (refusal is not null) return refusal;
        if (await limits.RefuseNewFileAsync(scheme.OrganisationId, accepted!.Bytes.Length, ct) is { } full) return Problems.Validation(new() { ["file"] = full });
        var names = string.Join(", ", seats.Where(t => signers.Contains(t.PersonId)).Select(t => t.Name));
        var amount = item.Amount is { } a ? $" ({Humo.Domain.Finance.BillingRules.Rand(a)})" : "";

        return await commands.RunAsync(new CommandSpec($"Recorded the board’s signed approval of {item.Ref}{amount} (D39): signed by {names} on {signedOn:d MMMM yyyy}", "Approvals.Decide")
        {
            Resource = "Approval",
            ResourceId = item.Id.ToString(),
            SchemeId = schemeId,
            Category = "security",
            // It stands in for trustees' decisions: verify it's really them.
            StepUp = true,
        }, async writer =>
        {
            if (writer.Assignment.Role is not (Roles.AgencyAdmin or Roles.PortfolioManager))
                throw new CommandRefused("forbidden", "An Agency Administrator or Portfolio Manager records the board’s signed approval.");
            var key = await store.SaveAsync(accepted.Bytes, ct);
            var fileId = Guid.CreateVersion7();
            var now = clock.GetUtcNow();
            db.UploadedFiles.Add(new UploadedFile
            {
                Id = fileId, OrganisationId = scheme.OrganisationId, SchemeId = schemeId, Name = accepted.Name, ContentType = "application/pdf", SizeBytes = accepted.Bytes.Length,
                Sha256 = Convert.ToHexStringLower(SHA256.HashData(accepted.Bytes)), StorageKey = key, ScanResult = "clean", UploadedBy = writer.Human.Name, UploadedAt = now,
            });
            foreach (var t in seats.Where(t => signers.Contains(t.PersonId)))
                db.BoardVotes.Add(new BoardVote
                {
                    Id = Guid.CreateVersion7(), WorkItemId = item.Id, PersonId = t.PersonId, TrusteeName = t.Name, Decision = "approved", Source = "upload", FileId = fileId,
                    SignedOn = signedOn, RecordedBy = writer.Human.Name, RecordedAt = now,
                });
            await board.SettleAsync(item, writer, null, ct, "approved", signers.Count);
            commands.AfterCommit(() => board.TellTrusteesAsync(scheme.OrganisationId, schemeId, $"Board approval recorded: {item.Ref}{amount}",
                $"{writer.Human.Name} recorded the board’s signed approval of {item.Ref}: {item.Title}{amount} for {scheme.Name}. It says it was signed by {names} on {signedOn:d MMMM yyyy}.",
                $"{scheme.Name}: the board’s approval of {item.Ref}{amount} was recorded, signed by {names}. Not right? Contact {BoardApprovals.SupportEmail}.", ct));
            return Results.NoContent();
        }, ct);
    }

    private static async Task<IResult> SetLimit(Guid id, DelegatedLimitRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var scheme = await db.Schemes.FirstOrDefaultAsync(s => s.Id == id && s.OrganisationId == actor.OrganisationId, ct);
        if (scheme is null) return Problems.NotFound();
        var limit = body.Limit ?? -1;
        return await commands.RunAsync(new CommandSpec($"Changed {scheme.Name}’s limit for agency approval from {Humo.Domain.Finance.BillingRules.Rand(scheme.DelegatedLimit)} to {Humo.Domain.Finance.BillingRules.Rand(limit)} (D39)", "Organisation.Manage")
        {
            Resource = "Scheme",
            ResourceId = id.ToString(),
            SchemeId = id,
            Category = "security",
            StepUp = true,
            Validate = () => limit is < 0 or > 10_000_000 ? new() { ["limit"] = "Enter an amount from R0 to R10 000 000." } : [],
        }, _ =>
        {
            scheme.DelegatedLimit = Math.Round(limit, 2);
            scheme.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }
}
