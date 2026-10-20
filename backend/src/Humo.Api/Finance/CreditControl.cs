using System.Globalization;
using System.Text;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Documents;
using Humo.Api.Portfolio;
using Humo.Api.Settings;
using Humo.Api.Work;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Domain.Documents;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Finance;

// The shapes match CollectionView in the app (collections.ts).
public sealed record CollectionViewDto(CollectionCase Case, AccountDto Account, UnitDto Unit, SchemeDto Scheme, PersonDto Holder, int DaysInArrears, decimal OverdueAmount,
    NextAction? Next, CollectionStep? LastStep, string AssigneeName, TrustAccountDto PayTo, string AgencyName, int StepDays);
public sealed record CollectionActionRequest(CollectionAction? Action, int? ExpectedVersion);
public sealed record RemindRequest(List<string>? AccountIds, string? Channel);

/// <summary>What a letter shows (D7, like statements): the snapshot the PDF and the print route draw from.</summary>
public sealed record LetterSnapshot(CollectionViewDto View, CollectionStep Step, TemplateDesign Design, ResolvedBranding Branding, DocumentSettingsDto Settings);

/// <summary>
/// Credit control on the API (slice 2d; docs/11 §2). A case per account in arrears, moved on by the rules in
/// <see cref="CreditControlRules"/>. Each letter is issued like a statement: a frozen snapshot and its hash, a PDF
/// rendered from it through the app's print route, delivered by email (PDF attached), SMS, or by post (the agency
/// prints it). A letter of demand needs the trustees' approval in My work; every active case has one follow-up Task.
/// </summary>
public sealed class CreditControl(HumoDbContext db, Commercial.CommercialRecords commercial, DocumentPrinter printer, IEmailSender email, SmsGateway sms, Messaging.SentRecords sent,
    Messaging.MessageUsage usage,
    TimeProvider clock, ILogger<CreditControl> logger) : IApprovalHandler
{
    public const string Feature = "credit-control";
    public const string Permission = "Collections.Manage";
    public const string DemandApprovalType = "demand-approval";
    public const string FollowUpType = "debtor-follow-up";

    public string Type => DemandApprovalType;

    private DateTimeOffset Now => clock.GetUtcNow();
    private string NowText => Now.ToString("O");

    public static AccountAgeing Ageing(LevyAccount a) => new(a.AgeingCurrent, a.AgeingD30, a.AgeingD60, a.AgeingD90, a.AgeingD120);

    // ---------------------------------------------------------------- Reads

    public async Task<(CollectionCase Case, CollectionCaseRow? Row)> CaseAsync(LevyAccount a, CancellationToken ct)
    {
        var row = await db.CollectionCases.FirstOrDefaultAsync(c => c.AccountId == a.Id, ct);
        return (row is null ? New(a) : Read(row), row);
    }

    private static CollectionCase New(LevyAccount a) => new() { AccountId = a.Id.ToString(), SchemeId = a.SchemeId.ToString(), Stage = CollectionStages.NotStarted };

    public static CollectionCase Read(CollectionCaseRow row) => JsonSerializer.Deserialize<CollectionCase>(row.Json, Json.Options)!;

    /// <summary>Every account in arrears in these schemes, plus accounts still owing with an arrangement, dispute or hand-over.</summary>
    public async Task<List<CollectionViewDto>> ListAsync(IReadOnlyCollection<Guid> schemeIds, CancellationToken ct)
    {
        var accounts = await db.LevyAccounts.Where(a => schemeIds.Contains(a.SchemeId) && a.HolderPersonId != null).ToListAsync(ct);
        var cases = await db.CollectionCases.Where(c => schemeIds.Contains(c.SchemeId)).ToDictionaryAsync(c => c.AccountId, ct);
        string[] active = [CollectionStages.Arrangement, CollectionStages.Disputed, CollectionStages.HandedOver];
        var chased = accounts.Where(a => CreditControlRules.Overdue(Ageing(a)) > 0 || (a.Balance > 0 && cases.TryGetValue(a.Id, out var c) && active.Contains(c.Stage))).ToList();
        var views = await ViewsAsync(chased, cases, ct);
        return [.. views.OrderByDescending(v => v.DaysInArrears).ThenByDescending(v => v.OverdueAmount)];
    }

    public async Task<CollectionViewDto?> ViewAsync(LevyAccount a, CancellationToken ct)
    {
        if (a.HolderPersonId is null) return null;
        var cases = await db.CollectionCases.Where(c => c.AccountId == a.Id).ToDictionaryAsync(c => c.AccountId, ct);
        return (await ViewsAsync([a], cases, ct)).SingleOrDefault();
    }

    private async Task<List<CollectionViewDto>> ViewsAsync(List<LevyAccount> accounts, Dictionary<Guid, CollectionCaseRow> cases, CancellationToken ct)
    {
        if (accounts.Count == 0) return [];
        var unitIds = accounts.Select(a => a.UnitId).ToList();
        var holderIds = accounts.Select(a => a.HolderPersonId!.Value).ToList();
        var schemeIds = accounts.Select(a => a.SchemeId).Distinct().ToList();
        var units = await db.Units.Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, ct);
        var holders = await db.People.Where(p => holderIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        var schemes = await db.Schemes.Where(s => schemeIds.Contains(s.Id)).ToListAsync(ct);
        var schemeDtos = (await SchemeEndpoints.ToDtos(schemes, db, ct)).ToDictionary(s => Guid.Parse(s.Id));
        var orgIds = schemes.Select(s => s.OrganisationId).Distinct().ToList();
        var orgs = await db.Organisations.Where(o => orgIds.Contains(o.Id)).ToDictionaryAsync(o => o.Id, ct);
        var settings = await db.AgencySettings.Where(s => orgIds.Contains(s.OrganisationId)).ToDictionaryAsync(s => s.OrganisationId, ct);
        var trust = await db.TrustAccounts.Where(t => schemeIds.Contains(t.SchemeId)).ToDictionaryAsync(t => t.SchemeId, ct);
        var assignees = new Dictionary<Guid, (string? Id, string Name)>();
        foreach (var org in orgIds) assignees[org] = await AssigneeAsync(org, ct);

        return [.. accounts.Select(a =>
        {
            var scheme = schemes.First(s => s.Id == a.SchemeId);
            var c = cases.TryGetValue(a.Id, out var row) ? Read(row) : New(a);
            var stepDays = settings.GetValueOrDefault(scheme.OrganisationId)?.StepDays ?? 14;
            var ageing = Ageing(a);
            return new CollectionViewDto(c, PortfolioReads.ToDto(a), PortfolioReads.ToDto(units[a.UnitId]), schemeDtos[a.SchemeId], PortfolioReads.ToDto(holders[a.HolderPersonId!.Value]),
                CreditControlRules.DaysInArrears(ageing), CreditControlRules.Overdue(ageing), CreditControlRules.Next(c, stepDays, Now), c.Steps.FirstOrDefault(),
                assignees[scheme.OrganisationId].Name, SettingsEndpoints.ToDto(trust.GetValueOrDefault(a.SchemeId)), orgs[scheme.OrganisationId].Name, stepDays);
        })];
    }

    /// <summary>The agency's credit controller (a Finance person titled so) if it has one; otherwise the case's Tasks are unassigned for the team.</summary>
    private async Task<(string? Id, string Name)> AssigneeAsync(Guid orgId, CancellationToken ct)
    {
        var finance = await db.RoleAssignments.Where(r => r.OrganisationId == orgId && r.Role == Roles.Finance && r.Status == AssignmentStatuses.Active).Select(r => r.UserId).ToListAsync(ct);
        var users = await db.Users.Where(u => finance.Contains(u.Id) && u.Status == IdentityStatuses.Active && u.Title != null).ToListAsync(ct);
        var controller = users.FirstOrDefault(u => u.Title!.Contains("credit", StringComparison.OrdinalIgnoreCase));
        return controller is null ? (null, "Unassigned") : (controller.Id.ToString(), controller.Name);
    }

    // ---------------------------------------------------------------- Commands

    /// <summary>Applies an action that has passed <see cref="CreditControlRules.Check"/>. Returns the letter issued, if any (not yet delivered).</summary>
    public async Task<IssuedLetter?> ApplyAsync(LevyAccount a, CollectionCase c, CollectionCaseRow? row, CollectionAction action, Actor actor, CancellationToken ct)
    {
        var by = actor.Human.Name;
        var overdue = CreditControlRules.Overdue(Ageing(a));
        IssuedLetter? issued = null;
        switch (action.Type)
        {
            case "send-letter":
            {
                var kind = action.Kind!;
                var name = CreditControlRules.LetterNames[kind];
                issued = await IssueAsync(a, c, kind, action.Channel!, $"{name} sent by {action.Channel}: {BillingRules.Rand(overdue)} overdue", by, ct);
                c.Stage = kind;
                if (kind == CollectionStages.LetterOfDemand) c.DemandApproval = null;
                if (action.Channel != "post" && await sent.RecipientAsync(a, action.Channel!, issued.Id, ct) is { } r)
                    await sent.RecordAsync("letter", issued.OrganisationId, a.SchemeId, $"{name}: levy account {a.AccountNo}", LetterBody(name), $"{r.Name} · {a.AccountNo}", by,
                        new Messaging.SentSourceDto($"Collection case {a.AccountNo}", $"/finance/credit-control/{a.Id}"), [r], null, ct);
                break;
            }
            case "request-demand-approval":
            {
                var unit = await db.Units.FirstAsync(u => u.Id == a.UnitId, ct);
                var holder = await db.People.FirstAsync(p => p.Id == a.HolderPersonId, ct);
                var orgId = await db.Schemes.Where(s => s.Id == a.SchemeId).Select(s => s.OrganisationId).FirstAsync(ct);
                var item = new WorkItemRow
                {
                    Id = Guid.CreateVersion7(), OrganisationId = orgId, SchemeId = a.SchemeId, Ref = a.AccountNo, Kind = "approval", Type = DemandApprovalType,
                    Title = $"Letter of demand: unit {unit.Number} — {holder.DisplayName}",
                    Detail = $"{BillingRules.Rand(overdue)} overdue, {CreditControlRules.DaysInArrears(Ageing(a))}+ days. Reminder and final demand sent; no payment.",
                    Amount = overdue, CreatedAt = Now, DueAt = Now.AddDays(3), ApproverRoles = WorkItemEndpoints.Roles(Roles.Trustee, Roles.AgencyAdmin),
                    Evidence = JsonSerializer.Serialize(c.Steps.Where(s => s.Letter is not null).Select(s =>
                        $"{CreditControlRules.LetterNames[s.Letter!.Kind]} sent {DateTimeOffset.Parse(s.At, CultureInfo.InvariantCulture).ToOffset(CreditControlRules.Sa):d MMM yyyy}")),
                    Route = $"/finance/credit-control/{a.Id}", SourceId = a.Id,
                };
                db.WorkItems.Add(item);
                c.DemandApproval = new DemandApproval(item.Id.ToString(), "pending");
                CreditControlRules.Log(c, c.Stage, "Asked the trustees to approve a letter of demand", by, NowText);
                break;
            }
            case "hand-over":
                c.Stage = CollectionStages.HandedOver;
                a.Status = AccountStatuses.HandedOver;
                CreditControlRules.Log(c, c.Stage, $"Handed over to {action.Attorney!.Trim()} for collection", by, NowText);
                break;
            case "arrangement":
                c.PreviousStage = c.Stage == CollectionStages.Disputed ? c.PreviousStage : c.Stage;
                c.Stage = CollectionStages.Arrangement;
                c.Arrangement = new PaymentArrangement(action.Instalment!.Value, action.Day!.Value, action.Months!.Value, NowText, 0);
                a.Status = AccountStatuses.Arrangement;
                CreditControlRules.Log(c, c.Stage, $"Payment arrangement: {BillingRules.Rand(action.Instalment.Value)} on the {CreditControlRules.Ordinal(action.Day.Value)} of each month for {action.Months} months, on top of the levy. Interest suspended while it’s kept.", by, NowText);
                break;
            case "missed-instalment":
                c.Arrangement = c.Arrangement! with { Missed = c.Arrangement.Missed + 1 };
                c.Stage = c.PreviousStage ?? CollectionStages.FinalDemand;
                a.Status = Ledger.Status(a.Balance, new Ageing(a.AgeingCurrent, a.AgeingD30, a.AgeingD60, a.AgeingD90, a.AgeingD120));
                CreditControlRules.Log(c, c.Stage, $"Arrangement broken: instalment of {BillingRules.Rand(c.Arrangement.Instalment)} missed. Collection resumes.", by, NowText);
                break;
            case "dispute":
                c.PreviousStage = c.Stage;
                c.Stage = CollectionStages.Disputed;
                c.Dispute = new CaseDispute(action.Reason!.Trim(), NowText, by);
                CreditControlRules.Log(c, c.Stage, $"Disputed: {c.Dispute.Reason}", by, NowText);
                break;
            case "resolve-dispute":
                c.Stage = c.PreviousStage ?? CollectionStages.NotStarted;
                CreditControlRules.Log(c, c.Stage, $"Dispute resolved{(action.Outcome == "written-off-in-part" ? " (part written off by journal)" : "")}: {action.Note!.Trim()}", by, NowText);
                c.Dispute = null;
                break;
            case "note":
                CreditControlRules.Log(c, c.Stage, action.Text!.Trim(), by, NowText);
                break;
        }
        c.Version++;
        await FollowUpAsync(a, c, by, ct);
        await WriteAsync(a, c, row, ct);
        return issued;
    }

    private async Task WriteAsync(LevyAccount a, CollectionCase c, CollectionCaseRow? row, CancellationToken ct)
    {
        if (row is null)
        {
            var orgId = await db.Schemes.Where(s => s.Id == a.SchemeId).Select(s => s.OrganisationId).FirstAsync(ct);
            row = new CollectionCaseRow { AccountId = a.Id, SchemeId = a.SchemeId, OrganisationId = orgId };
            db.CollectionCases.Add(row);
        }
        row.Stage = c.Stage;
        row.Version = c.Version;
        row.Json = JsonSerializer.Serialize(c, Json.Options);
    }

    /// <summary>
    /// Records the step with its letter and issues the letter (D7): the snapshot of what it says, as it says it now,
    /// with the agency's payment-notice template. The PDF and delivery follow once the change is saved.
    /// </summary>
    private async Task<IssuedLetter> IssueAsync(LevyAccount a, CollectionCase c, string kind, string channel, string text, string by, CancellationToken ct)
    {
        var scheme = await db.Schemes.FirstAsync(s => s.Id == a.SchemeId, ct);
        var settings = await DocumentEndpoints.ReadAsync(db, scheme.OrganisationId, ct);
        var entitled = await DocumentEndpoints.EntitledAsync(commercial, scheme.OrganisationId, ct);
        var template = DocumentCatalogue.DefaultFor("payment-notice", settings.Defaults.GetValueOrDefault("payment-notice"), entitled)
            ?? throw new InvalidOperationException("Humo has no default payment notice template.");
        var version = template.At()!;
        var dueBy = new DateTimeOffset(Now.ToOffset(CreditControlRules.Sa).Date.AddDays(kind == CollectionStages.Reminder ? 7 : 14).AddHours(17), CreditControlRules.Sa);
        var ageing = Ageing(a);
        var letter = new CollectionLetter(kind, CreditControlRules.Overdue(ageing), ageing, dueBy.ToString("O"), channel, new LetterTemplateRef(template.Id, version.Version));
        CreditControlRules.Log(c, kind, text, by, NowText, letter);
        var step = c.Steps[0];

        var view = (await ViewAsync(a, ct))! with { Case = c, LastStep = step };
        var snapshot = new LetterSnapshot(view, step, version.Design, DocumentCatalogue.Branding(version.Design, settings.Branding, entitled), settings);
        var json = JsonSerializer.Serialize(snapshot, Json.Options);
        var issued = new IssuedLetter
        {
            Id = Guid.CreateVersion7(), AccountId = a.Id, SchemeId = a.SchemeId, OrganisationId = scheme.OrganisationId, StepId = step.Id, Kind = kind, Channel = channel,
            TemplateId = template.Id, TemplateVersion = version.Version, Snapshot = json, SnapshotSha256 = StatementService.Sha256(Encoding.UTF8.GetBytes(json)),
            IssuedAt = Now, IssuedBy = by,
        };
        db.IssuedLetters.Add(issued);
        return issued;
    }

    /// <summary>One open follow-up Task per active case, due when the next step is. Taking a step closes it and opens the next.</summary>
    private async Task FollowUpAsync(LevyAccount a, CollectionCase c, string by, CancellationToken ct)
    {
        if (c.FollowUpWorkItemId is { } open && Guid.TryParse(open, out var openId) && await db.WorkItems.FirstOrDefaultAsync(w => w.Id == openId, ct) is { Status: "open" } done)
        {
            done.Status = "done";
            done.DecidedBy = by;
            done.DecidedAt = Now;
        }
        c.FollowUpWorkItemId = null;
        var scheme = await db.Schemes.FirstAsync(s => s.Id == a.SchemeId, ct);
        var stepDays = (await db.AgencySettings.AsNoTracking().FirstOrDefaultAsync(s => s.OrganisationId == scheme.OrganisationId, ct))?.StepDays ?? 14;
        if (c.Stage == CollectionStages.NotStarted || CreditControlRules.Next(c, stepDays, Now) is not { } next) return;
        var unit = await db.Units.FirstAsync(u => u.Id == a.UnitId, ct);
        var holder = a.HolderPersonId is { } h ? await db.People.FirstOrDefaultAsync(p => p.Id == h, ct) : null;
        var ageing = Ageing(a);
        var item = new WorkItemRow
        {
            Id = Guid.CreateVersion7(), OrganisationId = scheme.OrganisationId, SchemeId = a.SchemeId, Ref = a.AccountNo, Kind = "task", Type = FollowUpType,
            Title = $"Unit {unit.Number}{(holder is null ? "" : $" ({holder.DisplayName})")} — {char.ToLowerInvariant(next.Label[0])}{next.Label[1..]}",
            Detail = $"{CollectionStages.Labels[c.Stage]} · {BillingRules.Rand(CreditControlRules.Overdue(ageing))} overdue, {CreditControlRules.DaysInArrears(ageing)}+ days",
            Amount = CreditControlRules.Overdue(ageing), CreatedAt = Now, DueAt = DateTimeOffset.Parse(next.DueAt, CultureInfo.InvariantCulture),
            AssigneeId = (await AssigneeAsync(scheme.OrganisationId, ct)).Id, Route = $"/finance/credit-control/{a.Id}", SourceId = a.Id,
        };
        db.WorkItems.Add(item);
        c.FollowUpWorkItemId = item.Id.ToString();
    }

    /// <summary>Reminders to many accounts at once (the Compose pattern). Only accounts whose next step is a reminder get one; the others are skipped.</summary>
    public async Task<List<IssuedLetter>> RemindAsync(IReadOnlyCollection<LevyAccount> accounts, string channel, Actor actor, CancellationToken ct)
    {
        var issued = new List<IssuedLetter>();
        var to = new Dictionary<Guid, List<Messaging.Recipient>>();
        var skipped = new Dictionary<Guid, List<Messaging.SkippedDto>>();
        foreach (var a in accounts)
        {
            var (c, row) = await CaseAsync(a, ct);
            var action = new CollectionAction("send-letter", Kind: CollectionStages.Reminder, Channel: channel);
            var why = c.Stage != CollectionStages.NotStarted ? $"Already at “{CollectionStages.Labels[c.Stage]}”"
                : CreditControlRules.Check(c, Ageing(a), action).Values.FirstOrDefault() ?? await DeliveryProblemAsync(a, channel, ct);
            if (why is not null)
            {
                if (await sent.RecipientAsync(a, channel, null, ct) is { } x)
                    (skipped.TryGetValue(a.SchemeId, out var list) ? list : skipped[a.SchemeId] = []).Add(new Messaging.SkippedDto(x.PersonId.ToString(), x.Name, x.UnitLabel, why));
                continue;
            }
            var letter = await IssueAsync(a, c, CollectionStages.Reminder, channel, $"Reminder sent by {channel} (bulk): {BillingRules.Rand(CreditControlRules.Overdue(Ageing(a)))} overdue", actor.Human.Name, ct);
            c.Stage = CollectionStages.Reminder;
            c.Version++;
            await FollowUpAsync(a, c, actor.Human.Name, ct);
            await WriteAsync(a, c, row, ct);
            issued.Add(letter);
            if (await sent.RecipientAsync(a, channel, letter.Id, ct) is { } r) (to.TryGetValue(a.SchemeId, out var list) ? list : to[a.SchemeId] = []).Add(r);
        }
        // One Sent record per scheme, listing who was reminded and who wasn't (and why).
        foreach (var schemeId in to.Keys.Union(skipped.Keys))
        {
            var scheme = await db.Schemes.FirstAsync(s => s.Id == schemeId, ct);
            var reached = to.GetValueOrDefault(schemeId) ?? [];
            await sent.RecordAsync("reminder", scheme.OrganisationId, schemeId, "Your levy account {account.number}", LetterBody(CreditControlRules.LetterNames[CollectionStages.Reminder]),
                $"{reached.Count} account{(reached.Count == 1 ? "" : "s")} in arrears · {scheme.Name}", actor.Human.Name, new Messaging.SentSourceDto("Credit control", "/finance/credit-control"),
                reached, skipped.GetValueOrDefault(schemeId), ct);
        }
        return issued;
    }

    /// <summary>What Sent shows as the letter's text (the letter itself is the attached PDF).</summary>
    private static string LetterBody(string name) =>
        $"Dear {{person.name}},\n\n{name}: {{account.overdue}} is overdue on your levy account {{account.number}} for unit {{unit.number}}, {{scheme.name}}. The letter is attached.\n\n{{agency.name}}";

    /// <summary>Why a letter can't go by this channel to this holder, or null. Letters tell owners where to pay, so the scheme's trust account must be on record.</summary>
    public async Task<string?> DeliveryProblemAsync(LevyAccount a, string? channel, CancellationToken ct)
    {
        if (!await StatementEndpoints.HasTrustAccountAsync(db, a.SchemeId, ct)) return NoTrustAccount;
        var holder = a.HolderPersonId is { } h ? await db.People.FirstOrDefaultAsync(p => p.Id == h, ct) : null;
        if (holder is null) return "This account has no owner on record.";
        return channel switch
        {
            "email" when !SettingsEndpoints.IsEmail(holder.Email) => $"{holder.DisplayName} has no email address. Add one on their person record, or send it by post.",
            "sms" when !MobileNumber.TryNormalise(holder.Phone, out _) => $"{holder.DisplayName} has no mobile number. Add one on their person record, or send it by post.",
            _ => null,
        };
    }

    public const string NoTrustAccount = "Add the scheme’s trust account in Settings › Trust accounts first: letters tell owners where to pay.";

    private async Task<bool> CanDeliverAsync(LevyAccount a, string channel, CancellationToken ct) => await DeliveryProblemAsync(a, channel, ct) is null;

    // ---------------------------------------------------------------- Delivery

    /// <summary>Renders and stores the letter's PDF if it isn't yet: drawn from the stored snapshot, never today's data.</summary>
    public async Task<byte[]> PdfAsync(IssuedLetter letter, CancellationToken ct)
    {
        if (letter.Pdf is { } done) return done;
        var pdf = await printer.PrintAsync("letter", letter.Id, ct);
        letter.Pdf = pdf;
        letter.PdfSha256 = StatementService.Sha256(pdf);
        await db.SaveChangesAsync(ct);
        return pdf;
    }

    /// <summary>
    /// Renders each letter's PDF and sends it: by email with the PDF attached (a demand is a document the owner keeps),
    /// by SMS as a short notice, or not at all for post (the agency prints and posts it). One failure doesn't stop the rest.
    /// </summary>
    public async Task DeliverAsync(IReadOnlyCollection<Guid> ids, CancellationToken ct)
    {
        foreach (var id in ids)
        {
            try
            {
                var letter = await db.IssuedLetters.FirstAsync(l => l.Id == id, ct);
                var s = JsonSerializer.Deserialize<LetterSnapshot>(letter.Snapshot, Json.Options)!;
                byte[]? pdf = null;
                try
                {
                    pdf = await PdfAsync(letter, ct);
                }
                catch (Exception e) when (e is not OperationCanceledException)
                {
                    logger.LogError(e, "Couldn’t render the PDF for letter {Id}; it renders on first download instead", id);
                }
                if (letter.Channel == "post" || letter.DeliveredAt is not null) continue;
                var holder = await db.People.AsNoTracking().FirstAsync(p => p.Id == Guid.Parse(s.View.Holder.Id), ct);
                var delivery = await sent.DeliveryForAsync(letter.Id, ct);
                if (letter.Channel == "email")
                {
                    try
                    {
                        await email.SendAsync(Email(s, holder.Email, pdf), ct);
                        // Accepted by Humo's mail server. Bounces come back later by email and aren't matched up yet.
                        if (delivery is not null) sent.Mark(delivery, "delivered", null);
                    }
                    catch (Exception e) when (e is not OperationCanceledException)
                    {
                        logger.LogError(e, "The mail server didn’t accept letter {Id}", id);
                        if (delivery is not null) sent.Mark(delivery, "failed", "The mail server didn’t accept it. Retry from Sent.");
                        await db.SaveChangesAsync(ct);
                        continue;
                    }
                }
                else
                {
                    // The delivery's id goes to the provider as our reference: its delivery report comes back with it.
                    var text = Sms(s);
                    var receipt = await sms.SendAsync(new SmsMessage(holder.Phone, text, delivery?.Id.ToString("N") ?? s.View.Account.AccountNo), ct);
                    if (receipt.Accepted) await usage.RecordAsync(letter.OrganisationId, "sms", Messaging.MessageUsage.SmsUnits(text, receipt.Parts), ct);
                    if (delivery is not null) sent.Mark(delivery, receipt.Accepted ? "queued" : "failed", receipt.Accepted ? null : receipt.Error ?? "The SMS provider refused it.", receipt.ProviderMessageId);
                    if (!receipt.Accepted)
                    {
                        await db.SaveChangesAsync(ct);
                        continue;
                    }
                }
                letter.DeliveredAt = Now;
                await db.SaveChangesAsync(ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError(e, "Couldn’t deliver letter {Id}", id);
            }
        }
    }

    private static string DueBy(CollectionLetter l) =>
        DateTimeOffset.Parse(l.DueBy, CultureInfo.InvariantCulture).ToOffset(CreditControlRules.Sa).ToString("d MMMM yyyy", CultureInfo.InvariantCulture);

    private static EmailMessage Email(LetterSnapshot s, string to, byte[]? pdf)
    {
        var v = s.View;
        var l = s.Step.Letter!;
        var name = CreditControlRules.LetterNames[l.Kind];
        var reach = string.Join(" or ", new[] { s.Settings.Contact.Email, s.Settings.Contact.Phone }.Where(x => !string.IsNullOrWhiteSpace(x)));
        var text = $"""
            Dear {v.Holder.DisplayName},

            {(pdf is null ? $"This is a {name.ToLowerInvariant()}" : $"Please find attached a {name.ToLowerInvariant()}")} about {BillingRules.Rand(l.Amount)} overdue on your levy account {v.Account.AccountNo} for unit {v.Unit.Number}, {v.Scheme.Name}.

            Please pay by {DueBy(l)} into {v.Scheme.Name}’s trust account ({v.PayTo.Bank}, account {v.PayTo.AccountNumber}, branch {v.PayTo.BranchCode}) using {v.Account.AccountNo} as the reference.

            If you can’t pay in full, contact us{(reach.Length > 0 ? $" at {reach}" : "")} to arrange. If you have already paid, thank you, and please ignore this letter.

            {v.AgencyName}, for the trustees of {v.Scheme.Name}
            """;
        var attachments = pdf is null ? null : new[] { new EmailAttachment($"{v.Account.AccountNo}-{l.Kind}-{DateTimeOffset.Parse(s.Step.At, CultureInfo.InvariantCulture):yyyy-MM-dd}.pdf", "application/pdf", pdf) };
        return new EmailMessage(to, $"{name}: levy account {v.Account.AccountNo}", text, Attachments: attachments);
    }

    private static string Sms(LetterSnapshot s)
    {
        var v = s.View;
        var l = s.Step.Letter!;
        var phone = string.IsNullOrWhiteSpace(s.Settings.Contact.Phone) ? "" : $", or call {s.Settings.Contact.Phone} to arrange";
        return $"{v.Scheme.Name}: {BillingRules.Rand(l.Amount)} is overdue on levy account {v.Account.AccountNo} (unit {v.Unit.Number}). {CreditControlRules.LetterNames[l.Kind]}: please pay by {DueBy(l)} using reference {v.Account.AccountNo}{phone}. {v.AgencyName}";
    }

    // ---------------------------------------------------------------- Letters of demand decided in My work

    public Task<string?> RefuseAsync(WorkItemRow item, Actor actor, bool approve, CancellationToken ct) => Task.FromResult<string?>(null);

    public async Task DecidedAsync(WorkItemRow item, Actor actor, bool approve, string? comment, CancellationToken ct)
    {
        if (item.SourceId is not { } accountId || await db.LevyAccounts.FirstOrDefaultAsync(a => a.Id == accountId, ct) is not { } a) return;
        var (c, row) = await CaseAsync(a, ct);
        if (c.DemandApproval?.WorkItemId != item.Id.ToString()) return;
        var by = actor.Human.Name;
        c.DemandApproval = c.DemandApproval with { Status = approve ? "approved" : "rejected", DecidedBy = by, DecidedAt = NowText };
        CreditControlRules.Log(c, c.Stage, approve ? $"Trustees approved a letter of demand ({by})" : $"Trustees declined a letter of demand ({by}){(comment is null ? "" : $": “{comment}”")}", by, NowText);
        c.Version++;
        await FollowUpAsync(a, c, by, ct);
        await WriteAsync(a, c, row, ct);
    }
}

/// <summary>
/// Credit control endpoints (docs/11 §2): Collections.Manage and the credit-control entitlement, within the person's schemes.
///   GET  /collections?schemeIds=…          accounts in arrears with their case
///   GET  /collections/{accountId}
///   POST /collections/{accountId}/actions   send a letter, ask the trustees, hand over, arrangement, dispute, note
///   POST /collections/reminders             bulk reminders
///   GET  /collections/{accountId}/letters/{stepId}/pdf   a letter as sent
/// </summary>
public static class CreditControlEndpoints
{
    private static readonly Dictionary<string, string> Verbs = new()
    {
        ["send-letter"] = "Sent a letter on", ["request-demand-approval"] = "Asked the trustees about a letter of demand on", ["hand-over"] = "Handed over",
        ["arrangement"] = "Set up a payment arrangement on", ["missed-instalment"] = "Recorded a missed instalment on", ["dispute"] = "Marked as disputed",
        ["resolve-dispute"] = "Resolved the dispute on", ["note"] = "Added a note to",
    };

    public static void MapCreditControl(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/collections").RequireAuthorization();
        g.MapGet("", List);
        g.MapGet("/{accountId:guid}", Get);
        g.MapPost("/{accountId:guid}/actions", Act);
        g.MapPost("/reminders", Remind);
        g.MapGet("/{accountId:guid}/letters/{stepId}/pdf", Pdf);
        api.MapGet("/print/letters/{token}", Print).AllowAnonymous();
    }

    private static bool CanRead(Actor actor) => actor.Can(CreditControl.Permission) || actor.Can("Accounts.View");

    private static async Task<IResult> List(string[]? schemeIds, int? page, int? pageSize, CurrentActor current, HumoDbContext db, CreditControl credit, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!CanRead(actor)) return Results.Ok(PortfolioReads.Page(new List<CollectionViewDto>(), page, pageSize));
        var wanted = (schemeIds ?? []).Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).ToHashSet();
        var visible = await SchemeEndpoints.Visible(actor, db).Select(s => s.Id).ToListAsync(ct);
        var ids = visible.Where(wanted.Contains).ToList();
        return Results.Ok(PortfolioReads.Page(await credit.ListAsync(ids, ct), page, pageSize));
    }

    private static async Task<IResult> Get(Guid accountId, CurrentActor current, HumoDbContext db, CreditControl credit, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!CanRead(actor) || await AccountEndpoints.Readable(actor, db, accountId, ct) is not { } a) return Problems.NotFound();
        return await credit.ViewAsync(a, ct) is { } view ? Results.Ok(view) : Problems.NotFound();
    }

    private static async Task<IResult> Act(Guid accountId, CollectionActionRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CreditControl credit, DeliveryQueue queue,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (!CanRead(me) || await AccountEndpoints.Readable(me, db, accountId, ct) is not { HolderPersonId: not null } a) return Problems.NotFound();
        var (c, row) = await credit.CaseAsync(a, ct);
        var action = body.Action ?? new CollectionAction("");
        var deliveryProblem = action.Type == "send-letter" ? await credit.DeliveryProblemAsync(a, action.Channel, ct) : null;
        return await commands.RunAsync(new CommandSpec($"{Verbs.GetValueOrDefault(action.Type ?? "", action.Type ?? "Acted on")} {a.AccountNo}", CreditControl.Permission)
        {
            Resource = "Account",
            ResourceId = a.AccountNo,
            SchemeId = a.SchemeId,
            Feature = CreditControl.Feature,
            ExpectedVersion = body.ExpectedVersion,
            CurrentVersion = c.Version,
            Validate = () =>
            {
                var e = CreditControlRules.Check(c, CreditControl.Ageing(a), action);
                if (e.Count == 0 && deliveryProblem is not null) e["channel"] = deliveryProblem;
                return e;
            },
        }, async actor =>
        {
            if (await credit.ApplyAsync(a, c, row, action, actor, ct) is { } letter)
                commands.AfterCommit(() =>
                {
                    queue.Enqueue(DeliveryQueue.Letters, [letter.Id]);
                    return Task.CompletedTask;
                });
            return Results.NoContent();
        }, ct);
    }

    /// <summary>Returns how many were sent; letters render and go out in the background.</summary>
    private static async Task<IResult> Remind(RemindRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CreditControl credit, DeliveryQueue queue,
        CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        var keys = (body.AccountIds ?? []).Select(s => Guid.TryParse(s, out var g) ? g : Guid.Empty).ToList();
        var visible = await SchemeEndpoints.Visible(me, db).Select(s => s.Id).ToListAsync(ct);
        var accounts = await db.LevyAccounts.Where(x => keys.Contains(x.Id) && visible.Contains(x.SchemeId) && x.HolderPersonId != null).ToListAsync(ct);
        var schemes = accounts.Select(x => x.SchemeId).Distinct().ToList();
        return await commands.RunAsync(new CommandSpec($"Sent {accounts.Count} arrears reminder{(accounts.Count == 1 ? "" : "s")} by {body.Channel}", CreditControl.Permission)
        {
            Resource = "Collections",
            SchemeId = schemes.Count == 1 ? schemes[0] : null,
            Feature = CreditControl.Feature,
            Validate = () => accounts.Count == 0 ? new() { ["accounts"] = "Choose the accounts to remind." }
                : body.Channel is not ("email" or "sms") ? new() { ["channel"] = "By email or SMS." }
                : schemes.Any(s => !me.CoversScheme(s)) ? new() { ["accounts"] = "Some of these accounts are outside your schemes." } : [],
        }, async actor =>
        {
            var letters = await credit.RemindAsync(accounts, body.Channel!, actor, ct);
            commands.AfterCommit(() =>
            {
                queue.Enqueue(DeliveryQueue.Letters, letters.Select(l => l.Id));
                return Task.CompletedTask;
            });
            return Results.Ok(letters.Count);
        }, ct);
    }

    private static async Task<IResult> Pdf(Guid accountId, string stepId, CurrentActor current, HumoDbContext db, CreditControl credit, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!CanRead(actor) || await AccountEndpoints.Readable(actor, db, accountId, ct) is null) return Problems.NotFound();
        if (await db.IssuedLetters.FirstOrDefaultAsync(l => l.AccountId == accountId && l.StepId == stepId, ct) is not { } letter) return Problems.NotFound();
        var pdf = await credit.PdfAsync(letter, ct);
        var account = await db.LevyAccounts.Where(x => x.Id == accountId).Select(x => x.AccountNo).FirstAsync(ct);
        return Results.File(pdf, "application/pdf", $"{account}-{letter.Kind}-{letter.IssuedAt.ToOffset(CreditControlRules.Sa):yyyy-MM-dd}.pdf");
    }

    private static async Task<IResult> Print(string token, PrintTokens tokens, HumoDbContext db, CancellationToken ct)
    {
        if (tokens.Redeem(token) is not { } id) return Problems.NotFound();
        var letter = await db.IssuedLetters.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id, ct);
        return letter is null ? Problems.NotFound() : Results.Text(letter.Snapshot, "application/json", Encoding.UTF8);
    }
}
