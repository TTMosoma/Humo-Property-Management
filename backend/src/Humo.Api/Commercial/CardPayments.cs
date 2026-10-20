using Humo.Api.Audit;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Payments;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Commercial;

/// <summary>
/// Card debit orders through Payfast tokenization (docs/23 §6). The customer saves a card on Payfast's page
/// while paying an invoice; Humo keeps only Payfast's token (the "mandate reference"), never card details.
/// The billing run charges new invoices to it; each charge counts only when Payfast's notification confirms it.
/// </summary>
public sealed class CardPayments(HumoDbContext db, CommercialRecords commercial, IPayfast payfast, AuditLog audit, TimeProvider clock, ILogger<CardPayments> logger)
{
    /// <summary>Charges the invoice's balance to the saved card. True when Payfast accepted the charge (it's still unpaid until the notification).</summary>
    public async Task<bool> ChargeAsync(Guid invoiceId, CancellationToken ct)
    {
        var inv = await db.Invoices.FirstAsync(i => i.Id == invoiceId, ct);
        var rec = await commercial.AgreementAsync(inv.OrganisationId, ct);
        var token = rec?.Agreement.Billing.Mandate is { Status: "active", Reference: { Length: > 0 } t } ? t : null;
        if (token is null || !payfast.Configured) return false;
        var paid = (await db.Payments.Where(p => p.InvoiceId == inv.Id && p.Status == "verified").Select(p => p.Amount).ToListAsync(ct)).Sum();
        var due = CommercialRules.Round2(inv.Total - paid);
        if (inv.Status != "issued" || due <= 0) return false;
        var payment = new Payment
        {
            Id = Guid.CreateVersion7(), InvoiceId = inv.Id, OrganisationId = inv.OrganisationId, Method = BillingPreferences.CardRecurring, Status = "initiated", Amount = due,
            Provider = payfast.Sandbox ? "Payfast (sandbox)" : "Payfast", CreatedAt = clock.GetUtcNow(), Note = "Charged to the saved card (debit order). Waiting for Payfast’s confirmation.",
        };
        db.Payments.Add(payment);
        await db.SaveChangesAsync(ct);
        var result = await payfast.ChargeAsync(token, due, $"Humo invoice {inv.Reference}", payment.Id.ToString(), ct);
        if (!result.Ok)
        {
            payment.Status = "failed";
            payment.Note = $"Payfast refused the card charge: {result.Message}";
            logger.LogWarning("Card charge refused for invoice {Reference}", inv.Reference);
        }
        audit.Record($"{(result.Ok ? "Charged" : "Couldn’t charge")} invoice {inv.Reference} ({CommercialEndpoints.Rand(due)}) to the saved card", result.Ok ? "success" : "denied",
            reason: result.Ok ? null : result.Message, category: "security", organisationId: inv.OrganisationId, resource: "Payment", resourceId: payment.Id.ToString(), system: "Humo billing run");
        await db.SaveChangesAsync(ct);
        return result.Ok;
    }

    /// <summary>Payfast confirmed a payment the customer asked to save the card with: from now on, invoices are charged to it.</summary>
    public async Task SaveMandateAsync(Guid organisationId, string token, CancellationToken ct)
    {
        if (await commercial.AgreementAsync(organisationId, ct) is not { } rec) return;
        var next = rec.Agreement.Clone();
        next.Billing.Preference = BillingPreferences.CardRecurring;
        next.Billing.Mandate = new Mandate { Status = "active", Reference = token };
        next.Version++;
        next.History.Insert(0, new AgreementEvent
        {
            At = clock.GetUtcNow().ToString("O"), By = "Payfast", Action = "Card saved for monthly invoices (debit order)", Reason = "The customer chose to save their card on Payfast’s page",
            Approval = "The customer, on Payfast",
        });
        CommercialRecords.Write(rec.Row, next);
    }

    /// <summary>Stops the debit order: cancelled at Payfast first, then the agreement goes back to paying each invoice online.</summary>
    public async Task<PayfastApiResult> CancelAsync(Guid organisationId, string by, string byId, string why, CancellationToken ct)
    {
        if (await commercial.AgreementAsync(organisationId, ct) is not { } rec || rec.Agreement.Billing.Mandate is not { Status: "active", Reference: { Length: > 0 } token })
            return new PayfastApiResult(false, "There’s no saved card.");
        var result = await payfast.CancelAsync(token, ct);
        if (!result.Ok) return result;
        var next = rec.Agreement.Clone();
        next.Billing.Preference = BillingPreferences.InstantEft;
        next.Billing.Mandate = new Mandate();
        next.Version++;
        next.History.Insert(0, new AgreementEvent { At = clock.GetUtcNow().ToString("O"), ById = byId, By = by, Action = "Cancelled the card debit order", Reason = why, Approval = by });
        CommercialRecords.Write(rec.Row, next);
        return result;
    }
}
