using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using Humo.Api.Commands;
using Humo.Api.Documents;
using Humo.Api.Portfolio;
using Humo.Api.Settings;
using Humo.Domain.Commercial;
using Humo.Domain.Documents;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Documents;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Finance;

// The shapes match Statement and StatementView in the app (account.ts, read-models.ts).
public sealed record StatementDto(string AccountId, string Period, string PeriodLabel, string IssuedOn, string DueOn, decimal Opening, decimal Charges, decimal Payments,
    decimal Adjustments, decimal Interest, decimal Closing, IReadOnlyList<TransactionDto> Lines);
public sealed record TemplateRefDto(string TemplateId, int Version);
public sealed record StatementViewDto(StatementDto Statement, AccountDto Account, UnitDto Unit, SchemeDto Scheme, PersonDto Holder, TrustAccountDto PayTo, TemplateRefDto IssuedWith);

/// <summary>Everything an issued statement shows (D7): the snapshot the PDF is drawn from, and what the print route renders.</summary>
public sealed record StatementSnapshot(StatementViewDto View, TemplateDesign Design, ResolvedBranding Branding, DocumentSettingsDto Settings, string OrganisationName);

/// <summary>
/// Levy statements (slice 2c; D7–D10). A statement is worked out from the ledger until it's issued.
/// Issuing freezes it: the data snapshot and its SHA-256 are stored, and the PDF is rendered from that
/// snapshot by headless Chromium through the app's print route (D8), then stored with its own hash.
/// No statement numbers (D10): a statement is "account + period". Delivery (D9): a secure link to the
/// resident portal by default; the PDF attached when the agency chooses that.
/// </summary>
public sealed class StatementService(HumoDbContext db, Commercial.CommercialRecords commercial, DocumentPrinter printer, IEmailSender email, Messaging.SentRecords sent,
    DocumentLinks links, IOptions<AppOptions> app, TimeProvider clock, ILogger<StatementService> logger)
{
    private DateOnly Today => DateOnly.FromDateTime(clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).DateTime);

    public static readonly string[] ChargeTypes = [TransactionTypes.Levy, TransactionTypes.SpecialLevy, TransactionTypes.Utility];

    public static string PeriodLabel(string period) =>
        $"{BillingRules.MonthName(period)} {period[..4]}";

    /// <summary>The period's statement from the ledger, or null when nothing happened on the account that month.</summary>
    public static StatementDto? Build(Guid accountId, IReadOnlyList<LedgerEntry> ledger, string period, DateOnly issuedOn, int dueDay)
    {
        var all = AccountEndpoints.WithBalances(ledger);
        var lines = all.Where(t => t.Date[..7] == period).ToList();
        if (lines.Count == 0) return null;
        var opening = Ledger.Round2(ledger.Where(e => string.CompareOrdinal(e.Date.ToString("yyyy-MM", CultureInfo.InvariantCulture), period) < 0).Sum(e => e.Amount));
        decimal Sum(params string[] types) => Ledger.Round2(lines.Where(l => types.Contains(l.Type)).Sum(l => l.Amount));
        var charges = Sum(ChargeTypes);
        var payments = Sum(TransactionTypes.Payment);
        var adjustments = Sum(TransactionTypes.Adjustment, TransactionTypes.Opening);
        var interest = Sum(TransactionTypes.Interest);
        var due = new DateOnly(int.Parse(period[..4], CultureInfo.InvariantCulture), int.Parse(period[5..7], CultureInfo.InvariantCulture), Math.Clamp(dueDay, 1, 28));
        return new StatementDto(accountId.ToString(), period, PeriodLabel(period), issuedOn.ToString("yyyy-MM-dd"), due.ToString("yyyy-MM-dd"), opening, charges, payments, adjustments,
            interest, Ledger.Round2(opening + charges + payments + adjustments + interest), lines);
    }

    /// <summary>The statement as it would be issued today: the organisation's default template (if its plan still includes it) and current branding.</summary>
    public async Task<StatementSnapshot?> DraftAsync(LevyAccount account, string period, DateOnly? issuedOn, CancellationToken ct)
    {
        if (account.HolderPersonId is not { } holderId) return null;
        var scheme = await db.Schemes.FirstAsync(s => s.Id == account.SchemeId, ct);
        var org = await db.Organisations.FirstAsync(o => o.Id == scheme.OrganisationId, ct);
        var agency = await db.AgencySettings.AsNoTracking().FirstOrDefaultAsync(s => s.OrganisationId == org.Id, ct);
        var ledger = await db.Ledger.Where(e => e.AccountId == account.Id).ToListAsync(ct);
        var y = int.Parse(period[..4], CultureInfo.InvariantCulture);
        var m = int.Parse(period[5..7], CultureInfo.InvariantCulture);
        if (Build(account.Id, ledger, period, issuedOn ?? new DateOnly(y, m, 1), agency?.DueDay ?? 7) is not { } statement) return null;

        var unit = await db.Units.FirstAsync(u => u.Id == account.UnitId, ct);
        var holder = await db.People.FirstAsync(p => p.Id == holderId, ct);
        var trust = await db.TrustAccounts.AsNoTracking().FirstOrDefaultAsync(t => t.SchemeId == scheme.Id, ct);
        var settings = await DocumentEndpoints.ReadAsync(db, org.Id, ct);
        var entitled = await DocumentEndpoints.EntitledAsync(commercial, org.Id, ct);
        var template = DocumentCatalogue.DefaultFor("levy-statement", settings.Defaults.GetValueOrDefault("levy-statement"), entitled)
            ?? throw new InvalidOperationException("Humo has no default levy statement template.");
        var version = template.At()!;
        var view = new StatementViewDto(statement, PortfolioReads.ToDto(account), PortfolioReads.ToDto(unit), (await SchemeEndpoints.ToDtos([scheme], db, ct))[0], PortfolioReads.ToDto(holder),
            SettingsEndpoints.ToDto(trust), new TemplateRefDto(template.Id, version.Version));
        return new StatementSnapshot(view, version.Design, DocumentCatalogue.Branding(version.Design, settings.Branding, entitled), settings, org.Name);
    }

    /// <summary>The issued statement for the period, or a new one (not yet saved). Issuing is once per account per month.</summary>
    public async Task<IssuedStatement?> IssueAsync(LevyAccount account, string period, string by, Guid? runId, CancellationToken ct)
    {
        if (await db.IssuedStatements.FirstOrDefaultAsync(s => s.AccountId == account.Id && s.Period == period, ct) is { } existing) return existing;
        if (await DraftAsync(account, period, Today, ct) is not { } snapshot) return null;
        var json = JsonSerializer.Serialize(snapshot, Json.Options);
        var issued = new IssuedStatement
        {
            Id = Guid.CreateVersion7(), AccountId = account.Id, SchemeId = account.SchemeId, OrganisationId = Guid.Parse(snapshot.Settings.OrganisationId), Period = period,
            TemplateId = snapshot.View.IssuedWith.TemplateId, TemplateVersion = snapshot.View.IssuedWith.Version, Snapshot = json, SnapshotSha256 = Sha256(Encoding.UTF8.GetBytes(json)),
            IssuedAt = clock.GetUtcNow(), IssuedBy = by, BillingRunId = runId,
        };
        db.IssuedStatements.Add(issued);
        return issued;
    }

    /// <summary>The view the app shows: as issued (from the snapshot, unchanged), or as it stands in the ledger.</summary>
    public async Task<JsonNode?> ViewAsync(LevyAccount account, string period, CancellationToken ct)
    {
        if (await db.IssuedStatements.AsNoTracking().FirstOrDefaultAsync(s => s.AccountId == account.Id && s.Period == period, ct) is { } issued)
        {
            var snapshot = JsonNode.Parse(issued.Snapshot)!;
            var view = snapshot["view"]!.DeepClone();
            view["issued"] = JsonSerializer.SerializeToNode(new
            {
                at = issued.IssuedAt.ToString("O"), by = issued.IssuedBy, sha256 = issued.SnapshotSha256, pdf = issued.Pdf is not null, sentBy = issued.SentBy,
                sentAt = issued.SentAt?.ToString("O"),
            }, Json.Options);
            // The screen draws with the branding and contact details the PDF was drawn with (D7, R-2), not today's.
            view["branding"] = snapshot["branding"]!.DeepClone();
            view["documentSettings"] = snapshot["settings"]!.DeepClone();
            return view;
        }
        return await DraftAsync(account, period, null, ct) is { } draft ? JsonSerializer.SerializeToNode(draft.View, Json.Options) : null;
    }

    /// <summary>Renders and stores the PDF if it isn't yet. The PDF is drawn from the stored snapshot, never from today's data.</summary>
    public async Task<byte[]> PdfAsync(IssuedStatement issued, CancellationToken ct)
    {
        if (issued.Pdf is { } done) return done;
        var pdf = await printer.PrintAsync("statement", issued.Id, ct);
        issued.Pdf = pdf;
        issued.PdfSha256 = Sha256(pdf);
        await db.SaveChangesAsync(ct);
        return pdf;
    }

    /// <summary>
    /// Renders each statement's PDF and emails the ones going by email: a secure link to the portal (D9), or the
    /// PDF attached when the agency chose that. A failure on one statement doesn't stop the others.
    /// </summary>
    public async Task DeliverAsync(IReadOnlyCollection<Guid> ids, CancellationToken ct)
    {
        foreach (var id in ids)
        {
            try
            {
                var issued = await db.IssuedStatements.FirstAsync(s => s.Id == id, ct);
                var snapshot = JsonSerializer.Deserialize<StatementSnapshot>(issued.Snapshot, Json.Options)!;
                byte[]? pdf = null;
                try
                {
                    pdf = await PdfAsync(issued, ct);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    logger.LogError(e, "Couldn’t render the PDF for statement {Id}; it renders on first download instead", id);
                }
                if (issued.SentBy != "email") continue;
                var holder = await db.People.AsNoTracking().FirstAsync(p => p.Id == Guid.Parse(snapshot.View.Holder.Id), ct);
                if (!SettingsEndpoints.IsEmail(holder.Email))
                {
                    await sent.MarkAsync(id, "failed", "No email address on record", ct);
                    continue;
                }
                var attach = snapshot.Settings.StatementDelivery == "attachment" && pdf is not null;
                // Otherwise a secure link that opens with a one-time code: no Humo PM account needed.
                string? secureLink = null;
                if (!attach)
                {
                    secureLink = links.Create(issued, holder.Id);
                    await db.SaveChangesAsync(ct);
                }
                try
                {
                    await email.SendAsync(Message(snapshot, holder.Email, attach ? pdf : null, secureLink), ct);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    logger.LogError(e, "The mail server didn’t accept statement {Id}", id);
                    await sent.MarkAsync(id, "failed", "The mail server didn’t accept it. Retry from Sent.", ct);
                    continue;
                }
                // Accepted by Humo's mail server. Bounces come back later by email and aren't matched up yet.
                await sent.MarkAsync(id, "delivered", null, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError(e, "Couldn’t deliver statement {Id}", id);
            }
        }
    }

    public const string SentBody = "Dear {person.name},\n\nYour levy statement for unit {unit.number} is ready in the resident portal. The balance owing is {account.balance}.\n\nKind regards,\n{agency.name}";

    /// <summary>
    /// Records sent statements in Communications › Sent: one record for the send, a delivery per owner by the account's
    /// channel. Statements by post are listed as not sent by Humo (the agency prints and posts them).
    /// </summary>
    public async Task RecordSentAsync(IReadOnlyList<(IssuedStatement Issued, LevyAccount Account)> items, string? audienceLabel, Messaging.SentSourceDto source, string by,
        CancellationToken ct)
    {
        if (items.Count == 0) return;
        var scheme = await db.Schemes.FirstAsync(s => s.Id == items[0].Account.SchemeId, ct);
        var to = new List<Messaging.Recipient>();
        var skipped = new List<Messaging.SkippedDto>();
        foreach (var (issued, a) in items)
        {
            if (await sent.RecipientAsync(a, issued.SentBy ?? "email", issued.Id, ct) is not { } r) continue;
            if (r.Channel == "post") skipped.Add(new Messaging.SkippedDto(r.PersonId.ToString(), r.Name, r.UnitLabel, "By post: the agency prints and posts it"));
            else to.Add(r);
        }
        var period = items[0].Issued.Period;
        await sent.RecordAsync("statement", scheme.OrganisationId, scheme.Id, $"Your {scheme.Name} levy statement: {PeriodLabel(period)}", SentBody, audienceLabel ?? $"Owners · {scheme.Name}",
            by, source, to, skipped, ct);
    }

    private EmailMessage Message(StatementSnapshot s, string to, byte[]? pdf, string? secureLink)
    {
        var v = s.View;
        var portal = $"{app.Value.PublicUrl.TrimEnd('/')}/my/statements/{v.Statement.Period}";
        var due = DateOnly.ParseExact(v.Statement.DueOn, "yyyy-MM-dd", CultureInfo.InvariantCulture).ToString("d MMMM yyyy", CultureInfo.InvariantCulture);
        var owing = v.Statement.Closing > 0 ? $"The balance owing is {BillingRules.Rand(v.Statement.Closing)}, due by {due}." : v.Statement.Closing < 0
            ? $"Your account is {BillingRules.Rand(-v.Statement.Closing)} in credit." : "Your account is paid up.";
        var reach = string.Join(" or ", new[] { s.Settings.Contact.Email, s.Settings.Contact.Phone }.Where(c => !string.IsNullOrWhiteSpace(c)));
        var questions = reach.Length > 0 ? $"Questions about your statement? Contact {s.OrganisationName} at {reach}." : $"Questions about your statement? Reply to {s.OrganisationName}.";
        var how = pdf is not null
            ? $"Your statement is attached as a PDF. You can also see it, and every earlier statement, in the resident portal:\n{portal}"
            : $"Open your statement here:\n{secureLink}\n\nFor your privacy, we’ll send a one-time code to your phone (or this email address) when you open it. The link works for 90 days. "
              + $"With a Humo Property Management account you can also sign in to see every statement:\n{portal}";
        var text = $"""
            Dear {v.Holder.DisplayName},

            Your {v.Scheme.Name} levy statement for unit {v.Unit.Number}, {v.Statement.PeriodLabel}, is ready. {owing}

            {how}

            Pay into the scheme’s trust account and use {v.Account.AccountNo} as the reference.

            {questions}

            Kind regards,
            {s.OrganisationName}
            """;
        var attachments = pdf is null ? null : new[] { new EmailAttachment($"{v.Account.AccountNo}-{v.Statement.Period}.pdf", "application/pdf", pdf) };
        return new EmailMessage(to, $"Your {v.Scheme.Name} levy statement: {v.Statement.PeriodLabel}", text, Attachments: attachments);
    }

    public static string Sha256(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
}

/// <summary>
/// Short-lived, single-purpose tokens that let a print route read one issued document's snapshot
/// without a session (Chromium has none). In memory: the API renders on the same machine it runs on.
/// </summary>
public sealed class PrintTokens(TimeProvider clock)
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(2);
    private readonly ConcurrentDictionary<string, (Guid Id, DateTimeOffset Expires)> tokens = new();

    public string Issue(Guid documentId)
    {
        foreach (var old in tokens.Where(t => t.Value.Expires < clock.GetUtcNow())) tokens.TryRemove(old.Key, out _);
        var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        tokens[token] = (documentId, clock.GetUtcNow() + Lifetime);
        return token;
    }

    public Guid? Redeem(string token) => tokens.TryGetValue(token, out var t) && t.Expires >= clock.GetUtcNow() ? t.Id : null;

    public void Revoke(string token) => tokens.TryRemove(token, out _);
}

/// <summary>Prints an issued document (D8): Chromium opens the app's print route for it (<c>/print/{route}/{token}</c>) with a one-off token.</summary>
public sealed class DocumentPrinter(IPdfRenderer renderer, PrintTokens tokens, IOptions<AppOptions> app, IOptions<DocumentOptions> documents)
{
    public async Task<byte[]> PrintAsync(string route, Guid documentId, CancellationToken ct)
    {
        var token = tokens.Issue(documentId);
        try
        {
            var root = (string.IsNullOrWhiteSpace(documents.Value.RenderBaseUrl) ? app.Value.PublicUrl : documents.Value.RenderBaseUrl).TrimEnd('/');
            return await renderer.RenderAsync($"{root}/print/{route}/{token}", ct);
        }
        finally
        {
            tokens.Revoke(token);
        }
    }
}

/// <summary>Documents issued in bulk (a billing run's statements, bulk reminders), waiting for their PDFs and delivery, so the request doesn't wait.</summary>
public sealed class DeliveryQueue
{
    public const string Statements = "statements";
    public const string Letters = "letters";
    /// <summary>Composed messages and notices, by delivery id.</summary>
    public const string Messages = "messages";

    private readonly Channel<(string Kind, Guid[] Ids)> channel = Channel.CreateUnbounded<(string Kind, Guid[] Ids)>();

    public void Enqueue(string kind, IEnumerable<Guid> ids) => channel.Writer.TryWrite((kind, [.. ids]));

    public IAsyncEnumerable<(string Kind, Guid[] Ids)> ReadAllAsync(CancellationToken ct) => channel.Reader.ReadAllAsync(ct);
}

public sealed class DeliveryHost(DeliveryQueue queue, IServiceScopeFactory scopes, TimeProvider clock, ILogger<DeliveryHost> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Scheduled messages go out when their time comes: checked every minute.
        _ = Task.Run(async () =>
        {
            using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1), clock);
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    await scope.ServiceProvider.GetRequiredService<Messaging.Communications>().SendDueAsync(stoppingToken);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    logger.LogError(e, "Scheduled messages couldn’t be sent; trying again in a minute");
                }
            }
        }, stoppingToken);

        await foreach (var (kind, batch) in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                if (kind == DeliveryQueue.Letters) await scope.ServiceProvider.GetRequiredService<CreditControl>().DeliverAsync(batch, stoppingToken);
                else if (kind == DeliveryQueue.Messages) await scope.ServiceProvider.GetRequiredService<Messaging.Communications>().DeliverAsync(batch, stoppingToken);
                else await scope.ServiceProvider.GetRequiredService<StatementService>().DeliverAsync(batch, stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError(e, "A batch of {Count} {Kind} failed", batch.Length, kind);
            }
        }
    }
}

/// <summary>The statement endpoints: the view, the PDF, emailing one, and the print route's data.</summary>
public static class StatementEndpoints
{
    public static void MapStatements(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/accounts/{id:guid}/statements/{period}").RequireAuthorization();
        g.MapGet("", Get);
        g.MapGet("/pdf", Pdf);
        g.MapPost("/send", Send);
        // Chromium reads the snapshot with a print token instead of a session.
        api.MapGet("/print/statements/{token}", Print).AllowAnonymous();
    }

    /// <summary>A statement tells owners where to pay: none goes out before the scheme's trust account is on record.</summary>
    public const string NoTrustAccount = "Add the scheme’s trust account in Settings › Trust accounts first: statements tell owners where to pay.";

    public static Task<bool> HasTrustAccountAsync(HumoDbContext db, Guid schemeId, CancellationToken ct) =>
        db.TrustAccounts.AnyAsync(t => t.SchemeId == schemeId && t.AccountNumber != "", ct);

    private static bool IsPeriod(string period) =>
        period.Length == 7 && DateOnly.TryParseExact($"{period}-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    private static async Task<IResult> Get(Guid id, string period, CurrentActor current, HumoDbContext db, StatementService statements, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!IsPeriod(period) || await AccountEndpoints.Readable(actor, db, id, ct) is not { } account) return Problems.NotFound();
        return await statements.ViewAsync(account, period, ct) is { } view ? Results.Json(view, Json.Options) : Problems.NotFound();
    }

    /// <summary>The issued statement's PDF, exactly as sent. A statement that hasn't been issued has no PDF.</summary>
    private static async Task<IResult> Pdf(Guid id, string period, CurrentActor current, HumoDbContext db, StatementService statements, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!IsPeriod(period) || await AccountEndpoints.Readable(actor, db, id, ct) is not { } account) return Problems.NotFound();
        if (await db.IssuedStatements.FirstOrDefaultAsync(s => s.AccountId == id && s.Period == period, ct) is not { } issued) return Problems.NotFound();
        var pdf = await statements.PdfAsync(issued, ct);
        return Results.File(pdf, "application/pdf", $"{account.AccountNo}-{period}.pdf");
    }

    /// <summary>Issues the statement if it isn't yet, and emails it to the holder (D9) in the background. Returns the issued statement's id.</summary>
    private static async Task<IResult> Send(Guid id, string period, CurrentActor current, CommandRunner commands, HumoDbContext db, StatementService statements, DeliveryQueue queue, TimeProvider clock,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await AccountEndpoints.Readable(me, db, id, ct) is not { } account || !me.Can("Accounts.View")) return Problems.NotFound();
        var holder = account.HolderPersonId is { } h ? await db.People.FirstOrDefaultAsync(p => p.Id == h, ct) : null;
        var hasStatement = IsPeriod(period) && (await db.IssuedStatements.AnyAsync(s => s.AccountId == id && s.Period == period, ct)
            || (await db.Ledger.Where(e => e.AccountId == id).Select(e => e.Date).ToListAsync(ct)).Any(d => d.ToString("yyyy-MM", CultureInfo.InvariantCulture) == period));
        var payTo = await HasTrustAccountAsync(db, account.SchemeId, ct);
        return await commands.RunAsync(new CommandSpec($"Emailed the {(IsPeriod(period) ? StatementService.PeriodLabel(period) : period)} statement for {account.AccountNo}", "Collections.Manage")
        {
            Resource = "Account",
            ResourceId = id.ToString(),
            SchemeId = account.SchemeId,
            Feature = "finance-basic",
            Validate = () => !hasStatement ? new() { ["period"] = "There’s no statement for that period." }
                : !payTo ? new() { ["period"] = NoTrustAccount }
                : holder is null || !SettingsEndpoints.IsEmail(holder.Email) ? new() { ["email"] = $"{holder?.DisplayName ?? "The account holder"} has no email address. Add one on their person record." }
                : [],
        }, async actor =>
        {
            var issued = (await statements.IssueAsync(account, period, actor.Human.Name, null, ct))!;
            issued.SentBy = "email";
            issued.SentAt = clock.GetUtcNow();
            var unit = await db.Units.Where(u => u.Id == account.UnitId).Select(u => u.Number).FirstAsync(ct);
            await statements.RecordSentAsync([(issued, account)], $"{holder!.DisplayName} · {account.AccountNo}",
                new Messaging.SentSourceDto($"Statement {StatementService.PeriodLabel(period)} · {account.AccountNo}", $"/schemes/{account.SchemeId}/units/{unit}/account/statements/{period}"),
                actor.Human.Name, ct);
            commands.AfterCommit(() =>
            {
                queue.Enqueue(DeliveryQueue.Statements, [issued.Id]);
                return Task.CompletedTask;
            });
            return Results.Ok(new { id = issued.Id.ToString() });
        }, ct);
    }

    private static async Task<IResult> Print(string token, PrintTokens tokens, HumoDbContext db, CancellationToken ct)
    {
        if (tokens.Redeem(token) is not { } statementId) return Problems.NotFound();
        var issued = await db.IssuedStatements.AsNoTracking().FirstOrDefaultAsync(s => s.Id == statementId, ct);
        return issued is null ? Problems.NotFound() : Results.Text(issued.Snapshot, "application/json", Encoding.UTF8);
    }
}
