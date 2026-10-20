using System.Text.RegularExpressions;
using Humo.Api.Audit;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Commercial;

/// <summary>Everything needed to issue a customer's next invoice, and why it can't be issued yet (empty when it can).</summary>
public sealed record InvoicePlan(Organisation Org, Agreement Row, CommercialAgreement Agreement, Subscription Subscription, CommercialCatalogue Catalogue, int Schemes,
    string Period, string Reference, Dictionary<string, string> Errors);

public sealed record BillingRunResult(string Day, int Issued, int Charged, int Reminders, int TrialsEnded, IReadOnlyList<string> Skipped);

/// <summary>
/// Issuing invoices and the daily billing run (docs/23 §6, register R-14). The same rules whether a
/// person issues one (Billing &amp; agreement) or the run does: a snapshot of the agreement, a unique
/// reference, never an unpriced charge, and the agreement moves on to its next billing date.
/// </summary>
public sealed partial class BillingService(HumoDbContext db, CommercialRecords commercial, IEmailSender email, IOptions<AppOptions> app, AuditLog audit,
    Platform.Notices notices, CardPayments cards, TimeProvider clock, ILogger<BillingService> logger)
{
    /// <summary>Reminders go this many days after the due date; after the last, the subscription is past due.</summary>
    public static readonly int[] ReminderDays = [1, 7, 14];
    public const string LastRunKey = "billing-run-last";

    public async Task<InvoicePlan?> PlanAsync(Guid organisationId, CancellationToken ct)
    {
        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == organisationId, ct);
        var sub = await db.Subscriptions.FirstOrDefaultAsync(s => s.OrganisationId == organisationId, ct);
        if (org is null || sub is null || await commercial.AgreementAsync(organisationId, ct) is not { } rec) return null;
        var cat = await commercial.CatalogueAsync(ct);
        var schemes = await db.Schemes.CountAsync(s => s.OrganisationId == organisationId && s.Status != "archived", ct);
        var a = rec.Agreement;
        var period = a.Billing.NextBillingDate;
        var e = new Dictionary<string, string>();
        var charges = CommercialRules.IsDay(period) ? CommercialRules.ChargesOn(a, period, cat, schemes) : null;
        if (charges is null) e["period"] = "The agreement has no next billing date.";
        else if (await db.Invoices.AnyAsync(i => i.OrganisationId == organisationId && i.PeriodStart == period, ct)) e["period"] = "That period is already invoiced.";
        // An invoice never silently charges nothing for a line that has no price.
        else if (charges.AwaitingPrice > 0) e["period"] = "Some charges have no price yet. Agree the price in Billing & agreement first.";
        if (sub.Status == SubscriptionStatuses.Cancelled) e["period"] = "The subscription is cancelled.";
        if (!EmailFormat().IsMatch(a.Billing.BillingEmail ?? "")) e["billingEmail"] = "Set where invoices go first (billing preference).";
        return new InvoicePlan(org, rec.Row, a, sub, cat, schemes, period, await NextReference(org, period, ct), e);
    }

    /// <summary>Adds the invoice and moves the agreement on (the caller saves). Credits and once-off fees are used once; the renewal moves on a year once its fee is invoiced.</summary>
    public HumoInvoiceSnapshot Issue(InvoicePlan p, Guid invoiceId, string byId, string by, string approval)
    {
        var today = commercial.Today;
        var now = clock.GetUtcNow();
        var a = p.Agreement;
        var snapshot = CommercialRules.BuildInvoice(a, p.Period, p.Catalogue, p.Schemes, invoiceId.ToString(), p.Reference, today, simulated: false);
        db.Invoices.Add(new Invoice
        {
            Id = invoiceId, OrganisationId = p.Org.Id, Reference = p.Reference, PeriodStart = snapshot.PeriodStart, IssuedOn = today, DueOn = snapshot.DueOn, Total = snapshot.Total,
            Document = CommercialRecords.Serialise(snapshot), IssuedAt = now, IssuedBy = by,
        });
        var next = a.Clone();
        foreach (var x in next.Adjustments.Where(x => x.Kind != "discount" && x.InvoicedOn is null && string.CompareOrdinal(x.From, p.Period) <= 0)) x.InvoicedOn = today;
        next.Billing.NextBillingDate = CommercialRules.Day(CommercialRules.ParseDay(p.Period).AddMonths(a.Cycle == "annual" ? 12 : 1));
        if (snapshot.Lines.Any(l => l.Kind == "renewal-fee")) next.Renewal.On = CommercialRules.Day(CommercialRules.ParseDay(next.Renewal.On).AddYears(1));
        next.Version++;
        next.History.Insert(0, new AgreementEvent
        {
            At = now.ToString("O"), ById = byId, By = by, Action = $"Issued invoice {p.Reference} ({CommercialEndpoints.Rand(snapshot.Total)})",
            Reason = "Billing", EffectiveFrom = p.Period, Approval = approval,
        });
        CommercialRecords.Write(p.Row, next);
        return snapshot;
    }

    /// <summary>Emailed once the invoice is saved: a link to it in Settings › Billing &amp; invoices. A failed email doesn't undo the invoice.</summary>
    public async Task SendInvoiceAsync(Organisation org, string to, HumoInvoiceSnapshot inv, bool cardCharged, CancellationToken ct)
    {
        var site = app.Value.PublicUrl.TrimEnd('/');
        var how = cardCharged
            ? "It will be charged to your saved card. You'll see it as paid here once Payfast confirms the payment."
            : $"Pay online (Pay now on the invoice), or by EFT using {inv.Reference} as the reference.";
        await Send(to, $"Humo invoice {inv.Reference}: {CommercialEndpoints.Rand(inv.Total)}",
            $"Hello {org.ShortName},\n\nWeDesign Solutions has issued Humo Property Management invoice {inv.Reference} for {CommercialEndpoints.Rand(inv.Total)}, due on {inv.DueOn}.\n\nView it (your agency administrators can sign in to see it):\n\n{site}/settings/billing/{inv.Id}\n\n{how}\n\nHumo Property Management, a brand of WeDesign Solutions", ct);
    }

    // ---------------------------------------------------------------- The daily run

    /// <summary>
    /// Once a day: trials that have ended become active; due agreements are invoiced (and charged to a
    /// saved card where there's a debit order); overdue invoices get reminders. Each customer is saved on
    /// its own, so one problem never stops the rest. Nothing is invoiced twice: the reference and the
    /// "already invoiced" check see to that.
    /// </summary>
    public async Task<BillingRunResult> RunAsync(string by, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var today = commercial.Today;
        var skipped = new List<string>();
        int issued = 0, charged = 0, reminders = 0, trials = 0;

        // Trials that have ended: the subscription is active, and invoicing starts with the next billing date.
        foreach (var sub in (await db.Subscriptions.Where(s => s.Status == SubscriptionStatuses.Trial).ToListAsync(ct)).Where(s => s.StartedAt + CommercialRecords.TrialLength <= now))
        {
            sub.Status = SubscriptionStatuses.Active;
            sub.Version++;
            audit.Record("Trial ended: the subscription is active", "success", system: by, category: "security", organisationId: sub.OrganisationId, resource: "Subscription", resourceId: sub.OrganisationId.ToString());
            trials++;
        }
        await db.SaveChangesAsync(ct);

        // Due agreements.
        var due = (await db.Agreements.ToListAsync(ct)).Select(r => (Row: r, A: CommercialRecords.Read(r)))
            .Where(x => CommercialRules.IsDay(x.A.Billing.NextBillingDate) && string.CompareOrdinal(x.A.Billing.NextBillingDate, today) <= 0)
            .Select(x => x.Row.OrganisationId).ToList();
        foreach (var orgId in due)
        {
            try
            {
                if (await PlanAsync(orgId, ct) is not { } plan) continue;
                if (plan.Subscription.Status is SubscriptionStatuses.Trial or SubscriptionStatuses.Suspended) continue;
                if (plan.Errors.Count > 0)
                {
                    skipped.Add($"{plan.Org.ShortName}: {string.Join(" ", plan.Errors.Values)}");
                    continue;
                }
                var invoiceId = Guid.CreateVersion7();
                var snapshot = Issue(plan, invoiceId, "", by, "The billing run (Platform.Billing.Manage)");
                audit.Record($"Issued invoice {plan.Reference} to {plan.Org.ShortName} (billing run)", "success", system: by, category: "security", organisationId: orgId, resource: "Invoice", resourceId: invoiceId.ToString());
                await db.SaveChangesAsync(ct);
                issued++;
                var mandate = plan.Agreement.Billing;
                var card = mandate.Preference == BillingPreferences.CardRecurring && mandate.Mandate.Status == "active" && mandate.Mandate.Reference is { Length: > 0 };
                if (card && await cards.ChargeAsync(invoiceId, ct)) charged++;
                await SendInvoiceAsync(plan.Org, mandate.BillingEmail, snapshot, card, ct);
            }
            catch (Exception e)
            {
                db.ChangeTracker.Clear();
                logger.LogError(e, "The billing run couldn't invoice organisation {Organisation}", orgId);
                skipped.Add($"{orgId}: something went wrong (logged)");
            }
        }

        // Overdue reminders, then past due after the last one.
        var open = (await db.Invoices.Where(i => i.Status == "issued").ToListAsync(ct)).Where(i => string.CompareOrdinal(i.DueOn, today) < 0).ToList();
        foreach (var inv in open)
        {
            var daysLate = CommercialRules.ParseDay(today).DayNumber - CommercialRules.ParseDay(inv.DueOn).DayNumber;
            if (inv.RemindersSent >= ReminderDays.Length || daysLate < ReminderDays[inv.RemindersSent]) continue;
            var org = await db.Organisations.FirstAsync(o => o.Id == inv.OrganisationId, ct);
            var to = (await commercial.AgreementAsync(inv.OrganisationId, ct))?.Agreement.Billing.BillingEmail;
            inv.RemindersSent++;
            inv.LastReminderOn = today;
            if (inv.RemindersSent == ReminderDays.Length && await db.Subscriptions.FirstOrDefaultAsync(s => s.OrganisationId == inv.OrganisationId, ct) is { Status: SubscriptionStatuses.Active } sub)
            {
                // Past due: Humo is told. Nothing is suspended automatically.
                sub.Status = SubscriptionStatuses.PastDue;
                sub.Version++;
                notices.ToRole(Roles.HumoFinance, null, $"Past due: {org.ShortName}", $"Invoice {inv.Reference} is {daysLate} days overdue after {ReminderDays.Length} reminders.", $"/platform/invoices/{inv.Id}");
            }
            audit.Record($"Sent overdue reminder {inv.RemindersSent} for invoice {inv.Reference} ({daysLate} days late)", "success", system: by, category: "activity", organisationId: inv.OrganisationId, resource: "Invoice", resourceId: inv.Id.ToString());
            await db.SaveChangesAsync(ct);
            await notices.SendEmailsAsync(ct);
            if (to is not null)
                await Send(to, $"Reminder: Humo invoice {inv.Reference} is overdue",
                    $"Hello {org.ShortName},\n\nInvoice {inv.Reference} for {CommercialEndpoints.Rand(inv.Total)} was due on {inv.DueOn}. If you've paid, thank you: it shows once the payment is confirmed.\n\nPay online or see it here:\n\n{app.Value.PublicUrl.TrimEnd('/')}/settings/billing/{inv.Id}\n\nOr pay by EFT using {inv.Reference} as the reference.\n\nHumo Property Management, a brand of WeDesign Solutions", ct);
            reminders++;
        }

        await SetLastRun(today, ct);
        logger.LogInformation("Billing run {Day}: {Issued} invoices, {Charged} card charges, {Reminders} reminders, {Trials} trials ended, {Skipped} skipped", today, issued, charged, reminders, trials, skipped.Count);
        return new BillingRunResult(today, issued, charged, reminders, trials, skipped);
    }

    public async Task<string?> LastRunAsync(CancellationToken ct) => (await db.PlatformSettings.FirstOrDefaultAsync(s => s.Key == LastRunKey, ct))?.Value;

    private async Task SetLastRun(string day, CancellationToken ct)
    {
        var row = await db.PlatformSettings.FirstOrDefaultAsync(s => s.Key == LastRunKey, ct);
        if (row is null) db.PlatformSettings.Add(new PlatformSetting { Key = LastRunKey, Value = day });
        else { row.Value = day; row.Version++; }
        await db.SaveChangesAsync(ct);
    }

    private async Task Send(string to, string subject, string text, CancellationToken ct)
    {
        try
        {
            await email.SendAsync(new EmailMessage(to, subject, text), ct);
        }
        catch (Exception e)
        {
            logger.LogError(e, "Couldn't email {To}: {Subject}", SmtpEmailSender.Mask(to), subject);
        }
    }

    /// <summary>
    /// HPM-{customer}-{yyyymm}: readable, and unique (another customer with the same short name gets a suffix).
    /// Two people issuing at once both change the agreement, so one of them gets "someone else changed it first".
    /// </summary>
    private async Task<string> NextReference(Organisation org, string period, CancellationToken ct)
    {
        var code = new string(org.ShortName.ToUpperInvariant().Where(char.IsAsciiLetterOrDigit).Take(10).ToArray());
        var month = period.Length >= 7 ? period[..7].Replace("-", "") : "000000";
        var stem = $"HPM-{(code.Length > 0 ? code : "CUSTOMER")}-{month}";
        var taken = (await db.Invoices.Where(i => i.Reference.StartsWith(stem)).Select(i => i.Reference).ToListAsync(ct)).ToHashSet();
        if (!taken.Contains(stem)) return stem;
        var n = 2;
        while (taken.Contains($"{stem}-{n}")) n++;
        return $"{stem}-{n}";
    }

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailFormat();
}

/// <summary>Runs the billing run once a day, after <c>Billing:RunHour</c> (South African time). <c>Billing:Enabled=false</c> switches it off.</summary>
public sealed class BillingRunHost(IServiceScopeFactory scopes, IConfiguration config, TimeProvider clock, ILogger<BillingRunHost> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!config.GetValue("Billing:Enabled", true)) return;
        var hour = config.GetValue("Billing:RunHour", 6);
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(15), clock);
        do
        {
            try
            {
                var now = clock.GetUtcNow().ToOffset(CommercialRules.SouthAfricaOffset);
                if (now.Hour < hour) continue;
                using var scope = scopes.CreateScope();
                var billing = scope.ServiceProvider.GetRequiredService<BillingService>();
                if (await billing.LastRunAsync(stoppingToken) == CommercialRules.Day(now)) continue;
                await billing.RunAsync("Humo billing run", stoppingToken);
                // Levy accounts age as days pass: current becomes 30 days and so on (slice 2a).
                await scope.ServiceProvider.GetRequiredService<Finance.AccountLedger>().RefreshAsync(null, stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError(e, "The billing run failed; it tries again in 15 minutes");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
