using System.Text.Json;
using System.Text.RegularExpressions;
using Humo.Api.Commands;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Commercial;

public sealed record EftProofRequest(string Note);
public sealed record ReconcileRequest(string BankReference);

public sealed record PaymentRecordDto(string Id, string InvoiceId, string OrganisationId, string Method, string Status, decimal Amount, string Provider, string? ProviderReference,
    string CreatedAt, string? VerifiedAt, string? VerifiedBy, string? Verification, string? Note, bool Simulated);
public sealed record CustomerInvoiceDto(string Id, string Reference, string OrganisationId, string PeriodStart, string PeriodEnd, string IssuedOn, string DueOn, IReadOnlyList<InvoiceLine> Lines,
    decimal Subtotal, TaxSummary Tax, decimal Total, string Status, bool Simulated, IReadOnlyList<PaymentRecordDto> Payments);
public sealed record InvoiceListItemDto(string Id, string Reference, string OrganisationId, string PeriodStart, string PeriodEnd, string IssuedOn, string DueOn, IReadOnlyList<InvoiceLine> Lines,
    decimal Subtotal, TaxSummary Tax, decimal Total, string Status, bool Simulated, IReadOnlyList<PaymentRecordDto> Payments, string CustomerName, string AccountManager, string BillingPreference);
public sealed record InvoicePaymentSummaryDto(string Status, string Method, decimal Amount, string On, bool Simulated);
public sealed record BillToDto(string OrganisationId, string Name, string LegalName, string City, string Province, string BillingEmail);
public sealed record InvoiceDocumentDto(HumoInvoiceSnapshot Invoice, TaxConfig From, BillToDto BillTo, string BillingPreference, IReadOnlyList<InvoicePaymentSummaryDto> Payments, decimal Balance);

/// <summary>
/// Humo's invoices and payments (docs/23 §6, register R-14), without a payment provider yet:
/// invoices are issued from the agreement as it stands, and manual EFT counts only once it's
/// reconciled with Humo's bank statement. Online payment is Payfast (<see cref="PayfastEndpoints"/>).
/// </summary>
public static partial class BillingEndpoints
{
    public static void MapBilling(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/platform").RequireAuthorization();
        g.MapGet("/invoices", List);
        g.MapGet("/invoices/{id:guid}", Get);
        g.MapPost("/customers/{id:guid}/invoices", Issue);

        g.MapPost("/invoices/{id:guid}/eft-proof", EftProof);
        g.MapPost("/payments/{id:guid}/reconcile", Reconcile);
        var o = api.MapGroup("/organisations/{id:guid}/invoices").RequireAuthorization();
        o.MapGet("", Mine);
        o.MapGet("/{invoiceId:guid}", MyInvoice);
    }

    // ---- Humo staff ----

    private static async Task<IResult> List(CurrentActor current, HumoDbContext db, CommercialRecords commercial, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Platform.Revenue.View")) return Problems.Policy("forbidden", "Not permitted to see invoices");
        var invoices = await db.Invoices.ToListAsync(ct);
        var payments = (await db.Payments.ToListAsync(ct)).ToLookup(p => p.InvoiceId);
        var orgs = await db.Organisations.ToDictionaryAsync(o => o.Id, ct);
        var managers = await db.Users.Where(u => u.Kind == Domain.Access.IdentityKinds.Humo).ToDictionaryAsync(u => u.Id, u => u.Name, ct);
        var prefs = (await db.Agreements.ToListAsync(ct)).ToDictionary(a => a.OrganisationId, a => CommercialRecords.Read(a).Billing.Preference);
        var today = commercial.Today;
        return Results.Ok(invoices.Select(i =>
            {
                var c = ToCustomerInvoice(i, payments[i.Id], today);
                var org = orgs.GetValueOrDefault(i.OrganisationId);
                return new InvoiceListItemDto(c.Id, c.Reference, c.OrganisationId, c.PeriodStart, c.PeriodEnd, c.IssuedOn, c.DueOn, c.Lines, c.Subtotal, c.Tax, c.Total, c.Status, c.Simulated, c.Payments,
                    org?.ShortName ?? "", org?.AccountManagerId is { } m ? managers.GetValueOrDefault(m, "") : "", prefs.GetValueOrDefault(i.OrganisationId, BillingPreferences.ManualEft));
            })
            .OrderByDescending(i => i.IssuedOn, StringComparer.Ordinal).ThenBy(i => i.CustomerName).ToList());
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, CommercialRecords commercial, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Platform.Revenue.View")) return Problems.Policy("forbidden", "Not permitted to see invoices");
        return await Document(db, commercial, id, null, ct) is { } doc ? Results.Ok(doc) : Problems.NotFound();
    }

    /// <summary>
    /// The invoice for the next billing period, from the agreement as it stands. Atomic: the reference
    /// is unique, so a period is never invoiced twice. The agreement moves on to the next billing date.
    /// </summary>
    private static async Task<IResult> Issue(Guid id, CurrentActor current, CommandRunner commands, HumoDbContext db, CommercialRecords commercial, IEmailSender email,
        IOptions<AppOptions> app, TimeProvider clock, ILoggerFactory logs, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var org = await db.Organisations.FirstOrDefaultAsync(o => o.Id == id, ct);
        if (org is null || await commercial.AgreementAsync(id, ct) is not { } rec) return Problems.NotFound();
        var sub = await db.Subscriptions.FirstAsync(s => s.OrganisationId == id, ct);
        var cat = await commercial.CatalogueAsync(ct);
        var schemes = await db.Schemes.CountAsync(s => s.OrganisationId == id && s.Status != "archived", ct);
        var a = rec.Agreement;
        var period = a.Billing.NextBillingDate;
        var reference = await NextReference(db, org, period, ct);
        var alreadyInvoiced = await db.Invoices.AnyAsync(i => i.OrganisationId == id && i.PeriodStart == period, ct);
        var charges = CommercialRules.IsDay(period) ? CommercialRules.ChargesOn(a, period, cat, schemes) : null;
        var invoiceId = Guid.CreateVersion7();

        return await commands.RunAsync(new CommandSpec($"Issued invoice {reference} to {org.ShortName}", "Platform.Billing.Manage")
        {
            Resource = "Invoice",
            ResourceId = invoiceId.ToString(),
            OrganisationId = id,
            Category = "security",
            Validate = () =>
            {
                var e = new Dictionary<string, string>();
                if (charges is null) e["period"] = "The agreement has no next billing date.";
                else if (alreadyInvoiced) e["period"] = "That period is already invoiced.";
                // An invoice never silently charges nothing for a line that has no price.
                else if (charges.AwaitingPrice > 0) e["period"] = "Some charges have no price yet. Agree the price in Billing & agreement first.";
                if (sub.Status == SubscriptionStatuses.Cancelled) e["period"] = "The subscription is cancelled.";
                if (!EmailFormat().IsMatch(a.Billing.BillingEmail ?? "")) e["billingEmail"] = "Set where invoices go first (billing preference).";
                return e;
            },
        }, actor =>
        {
            var today = commercial.Today;
            var snapshot = CommercialRules.BuildInvoice(a, period, cat, schemes, invoiceId.ToString(), reference, today, simulated: false);
            db.Invoices.Add(new Invoice
            {
                Id = invoiceId, OrganisationId = id, Reference = reference, PeriodStart = snapshot.PeriodStart, IssuedOn = today, DueOn = snapshot.DueOn, Total = snapshot.Total,
                Document = CommercialRecords.Serialise(snapshot), IssuedAt = clock.GetUtcNow(), IssuedBy = actor.Human.Name,
            });
            // Credits and once-off fees are used once; the renewal moves on a year once its fee is invoiced.
            var next = a.Clone();
            foreach (var x in next.Adjustments.Where(x => x.Kind != "discount" && x.InvoicedOn is null && string.CompareOrdinal(x.From, period) <= 0)) x.InvoicedOn = today;
            next.Billing.NextBillingDate = CommercialRules.Day(CommercialRules.ParseDay(period).AddMonths(a.Cycle == "annual" ? 12 : 1));
            if (snapshot.Lines.Any(l => l.Kind == "renewal-fee")) next.Renewal.On = CommercialRules.Day(CommercialRules.ParseDay(next.Renewal.On).AddYears(1));
            next.Version++;
            next.History.Insert(0, new AgreementEvent
            {
                At = clock.GetUtcNow().ToString("O"), ById = actor.Human.Id.ToString(), By = actor.Human.Name, Action = $"Issued invoice {reference} ({CommercialEndpoints.Rand(snapshot.Total)})",
                Reason = "Billing", EffectiveFrom = period, Approval = "System Administrator (Platform.Billing.Manage)",
            });
            CommercialRecords.Write(rec.Row, next);
            commands.AfterCommit(() => SendInvoice(email, app.Value, logs, org, next.Billing.BillingEmail, snapshot, ct));
            return Task.FromResult(Results.Created($"/api/platform/invoices/{invoiceId}", new { id = invoiceId.ToString() }));
        }, ct);
    }


    /// <summary>The customer's proof of an EFT: recorded, but the invoice stays unpaid until it's reconciled.</summary>
    private static async Task<IResult> EftProof(Guid id, EftProofRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var inv = await db.Invoices.FirstOrDefaultAsync(i => i.Id == id, ct);
        if (inv is null) return Problems.NotFound();
        var org = await db.Organisations.FirstAsync(o => o.Id == inv.OrganisationId, ct);
        var paymentId = Guid.CreateVersion7();
        return await commands.RunAsync(new CommandSpec($"Recorded the customer’s proof of EFT payment for {inv.Reference} (not yet verified)", "Platform.Subscriptions.Manage")
        {
            Resource = "Payment",
            ResourceId = paymentId.ToString(),
            OrganisationId = inv.OrganisationId,
            StepUp = false,
            Validate = () => inv.Status != "issued" ? new() { ["invoiceId"] = "This invoice is already settled." }
                : (body.Note ?? "").Trim().Length < 5 ? new() { ["note"] = "What did the customer send?" } : [],
        }, actor =>
        {
            CustomerEndpoints.OwnAccountOnly(actor, org);
            db.Payments.Add(new Payment
            {
                Id = paymentId, InvoiceId = id, OrganisationId = inv.OrganisationId, Method = BillingPreferences.ManualEft, Status = "pending-verification",
                Amount = inv.Total, Provider = "Manual EFT", CreatedAt = clock.GetUtcNow(), Note = body.Note.Trim(),
            });
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>A manual EFT matched to a line on Humo's bank statement: the only way an EFT counts as paid.</summary>
    private static async Task<IResult> Reconcile(Guid id, ReconcileRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var p = await db.Payments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return Problems.NotFound();
        var bankRef = (body.BankReference ?? "").Trim();
        return await commands.RunAsync(new CommandSpec($"Verified an EFT payment of {CommercialEndpoints.Rand(p.Amount)} against Humo’s bank statement ({bankRef})", "Platform.Billing.Manage")
        {
            Resource = "Payment",
            ResourceId = id.ToString(),
            OrganisationId = p.OrganisationId,
            Category = "security",
            Validate = () => p.Status != "pending-verification" ? new() { ["paymentId"] = "Only a payment awaiting verification can be reconciled." }
                : bankRef.Length < 4 ? new() { ["bankReference"] = "The bank statement line’s reference." } : [],
        }, async actor =>
        {
            p.Status = "verified";
            p.VerifiedAt = clock.GetUtcNow();
            p.VerifiedBy = actor.Human.Name;
            p.Verification = "bank-reconciliation";
            p.ProviderReference = bankRef;
            p.Note = $"{(p.Note is null ? "" : p.Note + " ")}Matched to bank statement line {bankRef}.";
            // Paid only once verified payments cover it.
            var inv = await db.Invoices.FirstAsync(i => i.Id == p.InvoiceId, ct);
            var verified = (await db.Payments.Where(x => x.InvoiceId == inv.Id && x.Status == "verified" && x.Id != p.Id).Select(x => x.Amount).ToListAsync(ct)).Sum() + p.Amount;
            if (verified + 0.005m >= inv.Total) inv.Status = "paid";
            return Results.NoContent();
        }, ct);
    }

    // ---- The customer's own invoices (Agency Administrators, own organisation only) ----

    private static async Task<IResult> Mine(Guid id, CurrentActor current, HumoDbContext db, CommercialRecords commercial, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.OrganisationId != id) return Problems.Policy("forbidden", "Not your organisation");
        if (!actor.Can("Subscription.Request")) return Problems.Policy("forbidden", "Only agency administrators see Humo invoices");
        var ids = await db.Invoices.Where(i => i.OrganisationId == id).OrderByDescending(i => i.PeriodStart).Select(i => i.Id).ToListAsync(ct);
        var docs = new List<InvoiceDocumentDto>();
        foreach (var i in ids) if (await Document(db, commercial, i, id, ct) is { } doc) docs.Add(doc);
        return Results.Ok(docs);
    }

    private static async Task<IResult> MyInvoice(Guid id, Guid invoiceId, CurrentActor current, HumoDbContext db, CommercialRecords commercial, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.OrganisationId != id || !actor.Can("Subscription.Request")) return Problems.Policy("forbidden", "Not your organisation");
        // Another organisation's invoice can't be opened, even by URL.
        return await Document(db, commercial, invoiceId, id, ct) is { } doc ? Results.Ok(doc) : Problems.NotFound();
    }

    // ---- Helpers ----

    internal static CustomerInvoiceDto ToCustomerInvoice(Invoice i, IEnumerable<Payment> payments, string today)
    {
        var s = Snapshot(i, today);
        return new(s.Id, s.Reference, s.OrganisationId, s.PeriodStart, s.PeriodEnd, s.IssuedOn, s.DueOn, s.Lines, s.Subtotal, s.Tax, s.Total, s.Status, false,
            payments.OrderBy(p => p.CreatedAt).Select(ToDto).ToList());
    }

    /// <summary>As issued, with the status as of today (overdue is worked out from the due date).</summary>
    private static HumoInvoiceSnapshot Snapshot(Invoice i, string today)
    {
        var s = JsonSerializer.Deserialize<HumoInvoiceSnapshot>(i.Document, Json.Options)!;
        var status = i.Status is "paid" or "void" ? i.Status : string.CompareOrdinal(i.DueOn, today) < 0 ? "overdue" : "issued";
        return s with { Status = status, Simulated = false };
    }

    private static PaymentRecordDto ToDto(Payment p) => new(p.Id.ToString(), p.InvoiceId.ToString(), p.OrganisationId.ToString(), p.Method, p.Status, p.Amount, p.Provider, p.ProviderReference,
        p.CreatedAt.ToString("O"), p.VerifiedAt?.ToString("O"), p.VerifiedBy, p.Verification, p.Note, false);

    /// <summary>An invoice as a document. Customers get payment summaries only: no references, notes or staff names.</summary>
    private static async Task<InvoiceDocumentDto?> Document(HumoDbContext db, CommercialRecords commercial, Guid invoiceId, Guid? onlyFor, CancellationToken ct)
    {
        var inv = await db.Invoices.FirstOrDefaultAsync(i => i.Id == invoiceId && (onlyFor == null || i.OrganisationId == onlyFor), ct);
        if (inv is null || await commercial.AgreementAsync(inv.OrganisationId, ct) is not { } rec) return null;
        var org = await db.Organisations.FirstAsync(o => o.Id == inv.OrganisationId, ct);
        // Ordered and summed here, not in SQL: the test database can't order date-time offsets or sum decimals.
        var payments = (await db.Payments.Where(p => p.InvoiceId == invoiceId).ToListAsync(ct)).OrderBy(p => p.CreatedAt).ToList();
        var paid = payments.Where(p => p.Status == "verified").Sum(p => p.Amount);
        var cat = await commercial.CatalogueAsync(ct);
        var a = rec.Agreement;
        return new InvoiceDocumentDto(Snapshot(inv, commercial.Today), cat.Settings.Tax,
            new BillToDto(org.Id.ToString(), org.ShortName, org.Name, org.City, org.Province, a.Billing.BillingEmail), a.Billing.Preference,
            payments.Select(p => new InvoicePaymentSummaryDto(p.Status, p.Method, p.Amount, (p.VerifiedAt ?? p.CreatedAt).ToString("O"), false)).ToList(),
            Math.Max(0, CommercialRules.Round2(inv.Total - paid)));
    }

    /// <summary>
    /// HPM-{customer}-{yyyymm}: readable, and unique (another customer with the same short name gets a suffix).
    /// Two people issuing at once both change the agreement, so one of them gets "someone else changed it first".
    /// </summary>
    private static async Task<string> NextReference(HumoDbContext db, Organisation org, string period, CancellationToken ct)
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

    /// <summary>Emailed once the invoice is saved: a link to it in Settings › Billing &amp; invoices. A failed email doesn't undo the invoice.</summary>
    private static async Task SendInvoice(IEmailSender email, AppOptions app, ILoggerFactory logs, Organisation org, string to, HumoInvoiceSnapshot inv, CancellationToken ct)
    {
        try
        {
            await email.SendAsync(new EmailMessage(to, $"Humo invoice {inv.Reference}: {CommercialEndpoints.Rand(inv.Total)}",
                $"Hello {org.ShortName},\n\nHumo has issued invoice {inv.Reference} for {CommercialEndpoints.Rand(inv.Total)}, due on {inv.DueOn}.\n\nView it (your agency administrators can sign in to see it):\n\n{app.PublicUrl.TrimEnd('/')}/settings/billing/{inv.Id}\n\nPay by EFT, using {inv.Reference} as the reference.\n\nHumo Property Management"), ct);
        }
        catch (Exception e)
        {
            logs.CreateLogger("Humo.Billing").LogError(e, "Couldn't email invoice {Reference}", inv.Reference);
        }
    }

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailFormat();
}
