using System.Globalization;
using Humo.Api.Audit;
using Humo.Api.Commands;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Payments;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Commercial;

public sealed record CheckoutFormDto(string Action, IReadOnlyList<KeyValuePair<string, string>> Fields);
/// <summary>As the frontend's <c>CheckoutSession</c>: the browser posts <see cref="Form"/> to Payfast. Starting a checkout is not a payment.</summary>
public sealed record CheckoutSessionDto(string PaymentId, string ProviderReference, string? RedirectUrl, bool Simulated, CheckoutFormDto Form);

/// <summary>
/// Online payment through Payfast (doc 17, D15; register R-14). The customer pays on Payfast's page; the
/// invoice is paid only when Payfast's server-to-server notification (ITN) checks out: its signature, that it
/// came from Payfast, Payfast's own confirmation, and the amount. Card details never reach Humo.
/// </summary>
public static class PayfastEndpoints
{
    public const string NotificationPath = "/payments/notifications/payfast";

    public static void MapPayfast(this IEndpointRouteBuilder api)
    {
        api.MapPost("/platform/invoices/{id:guid}/checkout", StaffCheckout).RequireAuthorization();
        api.MapPost("/organisations/{orgId:guid}/invoices/{id:guid}/checkout", CustomerCheckout).RequireAuthorization();
        api.MapPost(NotificationPath, Notify).AllowAnonymous().DisableAntiforgery();
    }

    /// <summary>Humo Finance starts a checkout for a customer (e.g. while on the phone with them).</summary>
    private static async Task<IResult> StaffCheckout(Guid id, CurrentActor current, CommandRunner commands, HumoDbContext db, CommercialRecords commercial, IPayfast payfast,
        IOptions<AppOptions> app, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is null) return Results.Unauthorized();
        var inv = await db.Invoices.FirstOrDefaultAsync(i => i.Id == id, ct);
        if (inv is null) return Problems.NotFound();
        return await Start(inv, "Platform.Billing.Manage", $"/platform/invoices/{id}", commands, db, commercial, payfast, app.Value, clock, ct);
    }

    /// <summary>The customer's administrator pays their own invoice ("Pay now", Settings › Billing &amp; invoices).</summary>
    private static async Task<IResult> CustomerCheckout(Guid orgId, Guid id, CurrentActor current, CommandRunner commands, HumoDbContext db, CommercialRecords commercial, IPayfast payfast,
        IOptions<AppOptions> app, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var inv = await db.Invoices.FirstOrDefaultAsync(i => i.Id == id && i.OrganisationId == orgId, ct);
        // Another organisation's invoice can't be paid, or even found, from here.
        if (inv is null || actor.OrganisationId != orgId) return Problems.NotFound();
        return await Start(inv, "Subscription.Request", $"/settings/billing/{id}", commands, db, commercial, payfast, app.Value, clock, ct);
    }

    private static async Task<IResult> Start(Invoice inv, string permission, string backTo, CommandRunner commands, HumoDbContext db, CommercialRecords commercial, IPayfast payfast,
        AppOptions app, TimeProvider clock, CancellationToken ct)
    {
        var rec = await commercial.AgreementAsync(inv.OrganisationId, ct);
        var paid = (await db.Payments.Where(p => p.InvoiceId == inv.Id && p.Status == "verified").Select(p => p.Amount).ToListAsync(ct)).Sum();
        var due = CommercialRules.Round2(inv.Total - paid);
        var paymentId = Guid.CreateVersion7();
        var site = app.PublicUrl.TrimEnd('/');

        return await commands.RunAsync(new CommandSpec($"Started a Payfast checkout for invoice {inv.Reference} ({CommercialEndpoints.Rand(due)})", permission)
        {
            Resource = "Payment",
            ResourceId = paymentId.ToString(),
            OrganisationId = inv.OrganisationId,
            StepUp = false,
            Validate = () =>
                !payfast.Configured ? new() { ["invoiceId"] = "Online payment isn’t set up yet. Pay by EFT, using the invoice reference." }
                : inv.Status != "issued" || due <= 0 ? new() { ["invoiceId"] = "This invoice is already settled." }
                : [],
        }, _ =>
        {
            var preference = rec?.Agreement.Billing.Preference ?? BillingPreferences.InstantEft;
            db.Payments.Add(new Payment
            {
                Id = paymentId, InvoiceId = inv.Id, OrganisationId = inv.OrganisationId, Status = "initiated", Amount = due, Provider = payfast.Sandbox ? "Payfast (sandbox)" : "Payfast",
                Method = preference == BillingPreferences.ManualEft ? BillingPreferences.InstantEft : preference, CreatedAt = clock.GetUtcNow(),
                Note = "Waiting for Payfast’s confirmation. Starting a checkout is not a payment.",
            });
            var checkout = payfast.Checkout(paymentId.ToString(), due, $"Humo invoice {inv.Reference}", "Humo Property Management subscription", rec?.Agreement.Billing.BillingEmail,
                $"{site}{backTo}?payment=returned", $"{site}{backTo}?payment=cancelled", $"{site}/api{NotificationPath}", inv.Id.ToString());
            return Task.FromResult(Results.Ok(new CheckoutSessionDto(paymentId.ToString(), paymentId.ToString(), null, payfast.Sandbox, new CheckoutFormDto(checkout.Action, checkout.Fields))));
        }, ct);
    }

    /// <summary>
    /// Payfast's ITN. Genuine, for a payment we started, for the right amount: then COMPLETE verifies the payment
    /// (and pays the invoice once verified payments cover it), FAILED or CANCELLED records that. A repeat changes nothing.
    /// </summary>
    private static async Task<IResult> Notify(HttpRequest request, HumoDbContext db, IPayfast payfast, AuditLog audit, Platform.Notices notices, TimeProvider clock,
        ILoggerFactory logs, CancellationToken ct)
    {
        var log = logs.CreateLogger("Humo.Payfast");
        using var reader = new StreamReader(request.Body);
        var n = PayfastClient.Parse(await reader.ReadToEndAsync(ct));
        var refused = await payfast.VerifyAsync(n, request.HttpContext.Connection.RemoteIpAddress, ct);
        if (refused is not null)
        {
            log.LogWarning("Payfast notification refused: {Reason} (payment {Payment})", refused, n["m_payment_id"]);
            return Results.BadRequest();
        }
        if (!Guid.TryParse(n["m_payment_id"], out var paymentId) || await db.Payments.FirstOrDefaultAsync(p => p.Id == paymentId, ct) is not { } payment)
        {
            log.LogWarning("Payfast notification for an unknown payment {Payment}", n["m_payment_id"]);
            return Results.Ok();
        }
        var pfId = n["pf_payment_id"];
        // Providers retry: once a payment has an outcome, nothing changes it.
        if (payment.Status != "initiated") return Results.Ok();
        if (!decimal.TryParse(n["amount_gross"], NumberStyles.Number, CultureInfo.InvariantCulture, out var gross) || Math.Abs(gross - payment.Amount) > 0.01m)
        {
            log.LogWarning("Payfast notification amount {Gross} doesn't match payment {Payment} ({Amount})", n["amount_gross"], payment.Id, payment.Amount);
            return Results.BadRequest();
        }

        var inv = await db.Invoices.FirstAsync(i => i.Id == payment.InvoiceId, ct);
        var status = n["payment_status"];
        payment.ProviderReference = pfId;
        switch (status)
        {
            case "COMPLETE":
                payment.Status = "verified";
                payment.VerifiedAt = clock.GetUtcNow();
                payment.VerifiedBy = $"Payfast notification {pfId}";
                payment.Verification = "provider-notification";
                payment.Note = "Confirmed by Payfast.";
                var verified = (await db.Payments.Where(p => p.InvoiceId == inv.Id && p.Status == "verified" && p.Id != payment.Id).Select(p => p.Amount).ToListAsync(ct)).Sum() + payment.Amount;
                if (verified + 0.005m >= inv.Total) inv.Status = "paid";
                notices.ToRole(Roles.HumoFinance, null, $"Payment received: {inv.Reference}", $"{CommercialEndpoints.Rand(payment.Amount)} through Payfast.", $"/platform/invoices/{inv.Id}");
                break;
            case "FAILED":
                payment.Status = "failed";
                payment.Note = "Payfast reported the payment failed.";
                break;
            case "CANCELLED":
                payment.Status = "cancelled";
                payment.Note = "Cancelled at Payfast.";
                break;
            default:
                log.LogInformation("Payfast notification with status {Status} for payment {Payment}: nothing to do", status, payment.Id);
                return Results.Ok();
        }
        audit.Record($"Payfast notification: {status} for invoice {inv.Reference} ({CommercialEndpoints.Rand(payment.Amount)}, Payfast {pfId})", "success",
            category: "security", organisationId: inv.OrganisationId, resource: "Payment", resourceId: payment.Id.ToString());
        await db.SaveChangesAsync(ct);
        await notices.SendEmailsAsync(ct);
        return Results.Ok();
    }
}
