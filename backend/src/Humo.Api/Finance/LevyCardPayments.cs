using System.Globalization;
using System.Text.RegularExpressions;
using Humo.Api.Audit;
using Humo.Api.Commands;
using Humo.Api.Commercial;
using Humo.Api.Portfolio;
using Humo.Api.Settings;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Payments;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Humo.Api.Finance;

public sealed record SchemePayfastDto(string MerchantId, string? LinkedBy, string? LinkedAt);
public sealed record LinkPayfastRequest(string? MerchantId, string? MerchantKey, string? Passphrase);
public sealed record UnlinkPayfastRequest(string? Reason);
/// <summary>How the holder can pay: the trust account and reference for EFT, and whether card payment is on for the scheme.</summary>
public sealed record PaymentOptionsDto(TrustAccountDto? TrustAccount, string Reference, decimal Due, string? DueBy, bool Card, bool Sandbox);

/// <summary>
/// Owners pay their levy by card (D25). Each scheme links its own Payfast merchant, which pays out to the scheme's
/// trust account: the money never passes through Humo. The owner pays the balance on Payfast's page; only Payfast's
/// verified notification counts, and it adds an allocated receipt and the payment line. Payfast's fee is the scheme's
/// bank charge: the owner is credited the full amount.
/// </summary>
public static partial class LevyCardPayments
{
    public const string NotificationPath = "/payments/notifications/payfast/levies";
    private const string Purpose = "Humo.SchemePayfast.v1";

    public static void MapLevyCardPayments(this IEndpointRouteBuilder api)
    {
        api.MapPut("/settings/trust-accounts/{schemeId:guid}/payfast", Link).RequireAuthorization();
        api.MapPost("/settings/trust-accounts/{schemeId:guid}/payfast/remove", Unlink).RequireAuthorization();
        api.MapGet("/accounts/{id:guid}/payment-options", Options).RequireAuthorization();
        api.MapPost("/accounts/{id:guid}/card-checkout", Checkout).RequireAuthorization();
        api.MapPost(NotificationPath, Notify).AllowAnonymous().DisableAntiforgery();
    }

    internal static SchemePayfastDto? ToDto(TrustAccountRow? t) =>
        t?.PayfastMerchantId is { } id ? new SchemePayfastDto(id, t.PayfastLinkedBy, t.PayfastLinkedAt?.ToString("O")) : null;

    private static PayfastMerchant Merchant(string merchantId, TrustAccountRow t, IDataProtectionProvider protection) =>
        new(merchantId, t.PayfastMerchantKey ?? "", t.PayfastPassphrase is { } p ? protection.CreateProtector(Purpose).Unprotect(p) : null);

    [GeneratedRegex(@"^\d{5,12}$")]
    private static partial Regex MerchantIdPattern();

    [GeneratedRegex(@"^[A-Za-z0-9]{8,32}$")]
    private static partial Regex MerchantKeyPattern();

    /// <summary>Links the scheme's Payfast merchant: who owners' card payments go to. A fresh passkey, always, like the trust account itself.</summary>
    private static async Task<IResult> Link(Guid schemeId, LinkPayfastRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, IDataProtectionProvider protection,
        TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(s => s.Id == schemeId, ct) is not { } scheme) return Problems.NotFound();
        var row = await db.TrustAccounts.FirstOrDefaultAsync(t => t.SchemeId == schemeId, ct);
        var id = (body.MerchantId ?? "").Trim();
        var key = (body.MerchantKey ?? "").Trim();
        var passphrase = (body.Passphrase ?? "").Trim();
        return await commands.RunAsync(new CommandSpec($"Linked Payfast merchant {id} for card payments to {scheme.Name}", "Organisation.Manage")
        {
            Resource = "Scheme",
            ResourceId = schemeId.ToString(),
            SchemeId = schemeId,
            StepUp = true,
            Category = "security",
            Validate = () =>
            {
                if (row is not { AccountNumber.Length: > 0 }) return new() { ["merchantId"] = "Add the scheme’s trust account first: Payfast pays out to it." };
                var e = new Dictionary<string, string>();
                if (!MerchantIdPattern().IsMatch(id)) e["merchantId"] = "The merchant ID from Payfast (Settings › Integration): digits only.";
                if (!MerchantKeyPattern().IsMatch(key)) e["merchantKey"] = "The merchant key from Payfast (Settings › Integration).";
                if (passphrase.Length is < 8 or > 100) e["passphrase"] = "The salt passphrase set in Payfast (Settings › Integration), 8 characters or more.";
                return e;
            },
        }, actor =>
        {
            row!.PayfastMerchantId = id;
            row.PayfastMerchantKey = key;
            row.PayfastPassphrase = protection.CreateProtector(Purpose).Protect(passphrase);
            row.PayfastLinkedBy = actor.Human.Name;
            row.PayfastLinkedAt = clock.GetUtcNow();
            row.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    /// <summary>Card payments off for the scheme: owners pay by EFT. Payments already started still count when Payfast confirms them.</summary>
    private static async Task<IResult> Unlink(Guid schemeId, UnlinkPayfastRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        if (await SchemeEndpoints.Visible(me, db).FirstOrDefaultAsync(s => s.Id == schemeId, ct) is not { } scheme) return Problems.NotFound();
        var row = await db.TrustAccounts.FirstOrDefaultAsync(t => t.SchemeId == schemeId, ct);
        var reason = (body.Reason ?? "").Trim();
        return await commands.RunAsync(new CommandSpec($"Turned off card payments for {scheme.Name} — {reason}", "Organisation.Manage")
        {
            Resource = "Scheme",
            ResourceId = schemeId.ToString(),
            SchemeId = schemeId,
            StepUp = true,
            Category = "security",
            Validate = () => row?.PayfastMerchantId is null ? new() { ["reason"] = "Card payments aren’t on for this scheme." }
                : reason.Length < 5 ? new() { ["reason"] = "Say why, in a few words. It goes in the audit log." } : [],
        }, _ =>
        {
            // The passphrase stays (encrypted) so notifications for checkouts already started can still be checked.
            row!.PayfastMerchantId = null;
            row.Version++;
            return Task.FromResult(Results.NoContent());
        }, ct);
    }

    private static bool IsHolder(Actor actor, LevyAccount account) =>
        actor.User.PersonId is { } person && account.HolderPersonId?.ToString() == person;

    /// <summary>The due date of the latest month with charges: the agency's due day (Settings › Billing rules) in that month.</summary>
    private static async Task<string?> DueByAsync(HumoDbContext db, LevyAccount account, Guid organisationId, CancellationToken ct)
    {
        var latest = await db.Ledger.Where(e => e.AccountId == account.Id && e.Amount > 0).OrderByDescending(e => e.Date).Select(e => (DateOnly?)e.Date).FirstOrDefaultAsync(ct);
        if (latest is not { } d) return null;
        var dueDay = await db.AgencySettings.Where(s => s.OrganisationId == organisationId).Select(s => (int?)s.DueDay).FirstOrDefaultAsync(ct) ?? 7;
        return new DateOnly(d.Year, d.Month, Math.Clamp(dueDay, 1, 28)).ToString("yyyy-MM-dd");
    }

    private static async Task<IResult> Options(Guid id, CurrentActor current, HumoDbContext db, IPayfast payfast, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (await AccountEndpoints.Readable(actor, db, id, ct) is not { } account) return Problems.NotFound();
        var scheme = await db.Schemes.FirstAsync(s => s.Id == account.SchemeId, ct);
        var trust = await db.TrustAccounts.AsNoTracking().FirstOrDefaultAsync(t => t.SchemeId == account.SchemeId, ct);
        var due = Ledger.Round2(await db.Ledger.Where(e => e.AccountId == id).SumAsync(e => e.Amount, ct));
        return Results.Ok(new PaymentOptionsDto(trust is { AccountNumber.Length: > 0 } ? SettingsEndpoints.ToDto(trust) : null, account.AccountNo, due,
            due > 0 ? await DueByAsync(db, account, scheme.OrganisationId, ct) : null, trust?.PayfastMerchantId is not null && due > 0 && IsHolder(actor, account), payfast.Sandbox));
    }

    /// <summary>The holder starts paying their balance by card. Starting a checkout is not a payment.</summary>
    private static async Task<IResult> Checkout(Guid id, CurrentActor current, CommandRunner commands, HumoDbContext db, IPayfast payfast, IDataProtectionProvider protection,
        IOptions<AppOptions> app, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } me) return Results.Unauthorized();
        // Only the account holder pays by card here; staff record payments as receipts.
        if (await AccountEndpoints.Readable(me, db, id, ct) is not { } account || !IsHolder(me, account)) return Problems.NotFound();
        var scheme = await db.Schemes.FirstAsync(s => s.Id == account.SchemeId, ct);
        var trust = await db.TrustAccounts.AsNoTracking().FirstOrDefaultAsync(t => t.SchemeId == account.SchemeId, ct);
        var due = Ledger.Round2(await db.Ledger.Where(e => e.AccountId == id).SumAsync(e => e.Amount, ct));
        var paymentId = Guid.CreateVersion7();
        var site = app.Value.PublicUrl.TrimEnd('/');

        return await commands.RunAsync(new CommandSpec($"Started a card payment of {CommercialEndpoints.Rand(due)} on {account.AccountNo}", "Account.ViewOwn")
        {
            Resource = "Account",
            ResourceId = id.ToString(),
            SchemeId = account.SchemeId,
            StepUp = false,
            Validate = () =>
                trust?.PayfastMerchantId is null ? new() { ["accountId"] = "Card payments aren’t set up for this scheme. Pay by EFT, using your account number as the reference." }
                : due <= 0 ? new() { ["accountId"] = "There’s nothing to pay." }
                : [],
        }, actor =>
        {
            db.LevyCardPayments.Add(new LevyCardPayment
            {
                Id = paymentId, OrganisationId = scheme.OrganisationId, SchemeId = scheme.Id, AccountId = account.Id, MerchantId = trust!.PayfastMerchantId!, Amount = due,
                StartedBy = actor.Human.Name, CreatedAt = clock.GetUtcNow(),
            });
            var checkout = payfast.Checkout(Merchant(trust.PayfastMerchantId!, trust, protection), paymentId.ToString(), due, $"{scheme.Name} levy {account.AccountNo}", $"Unit levy account {account.AccountNo}",
                actor.Human.Email, $"{site}/my/account?payment=returned", $"{site}/my/account?payment=cancelled", $"{site}/api{NotificationPath}", account.AccountNo);
            return Task.FromResult(Results.Ok(new CheckoutSessionDto(paymentId.ToString(), paymentId.ToString(), null, payfast.Sandbox, new CheckoutFormDto(checkout.Action, checkout.Fields))));
        }, ct);
    }

    /// <summary>
    /// Payfast's ITN for a scheme's merchant: checked with that scheme's own passphrase. COMPLETE for the right amount
    /// adds an allocated receipt and credits the account; FAILED or CANCELLED records that. A repeat changes nothing.
    /// </summary>
    private static async Task<IResult> Notify(HttpRequest request, HumoDbContext db, IPayfast payfast, IDataProtectionProvider protection, AccountLedger ledger, AuditLog audit,
        TimeProvider clock, ILoggerFactory logs, CreditControl credit, Platform.Notices notices, CancellationToken ct)
    {
        var log = logs.CreateLogger("Humo.Payfast");
        using var reader = new StreamReader(request.Body);
        var n = PayfastClient.Parse(await reader.ReadToEndAsync(ct));
        if (!Guid.TryParse(n["m_payment_id"], out var paymentId) || await db.LevyCardPayments.FirstOrDefaultAsync(p => p.Id == paymentId, ct) is not { } payment)
        {
            log.LogWarning("Payfast levy notification for an unknown payment {Payment}", n["m_payment_id"]);
            return Results.Ok();
        }
        var trust = await db.TrustAccounts.FirstAsync(t => t.SchemeId == payment.SchemeId, ct);
        // Checked against the merchant the checkout went to: its passphrase is kept even after card payments are turned off.
        var refused = await payfast.VerifyAsync(n, request.HttpContext.Connection.RemoteIpAddress, Merchant(payment.MerchantId, trust, protection), ct);
        if (refused is not null)
        {
            log.LogWarning("Payfast levy notification refused: {Reason} (payment {Payment})", refused, payment.Id);
            return Results.BadRequest();
        }
        if (payment.Status != "initiated") return Results.Ok();
        if (!decimal.TryParse(n["amount_gross"], NumberStyles.Number, CultureInfo.InvariantCulture, out var gross) || Math.Abs(gross - payment.Amount) > 0.01m)
        {
            log.LogWarning("Payfast levy notification amount {Gross} doesn't match payment {Payment} ({Amount})", n["amount_gross"], payment.Id, payment.Amount);
            return Results.BadRequest();
        }

        var account = await db.LevyAccounts.FirstAsync(a => a.Id == payment.AccountId, ct);
        var status = n["payment_status"];
        var pfId = n["pf_payment_id"] ?? "";
        payment.ProviderReference = pfId;
        switch (status)
        {
            case "COMPLETE":
                var payer = account.HolderPersonId is { } holder ? await db.People.Where(p => p.Id == holder).Select(p => p.DisplayName).FirstOrDefaultAsync(ct) : null;
                var receipt = new Receipt
                {
                    Id = Guid.CreateVersion7(), SchemeId = payment.SchemeId, BankAccount = "Payfast (card)", Date = ledger.Today, Amount = payment.Amount,
                    Reference = $"{account.AccountNo} Payfast {pfId}".Trim(), Payer = payer ?? "", Status = "allocated", AllocatedBy = "Payfast", AutoMatched = true, Source = "payfast",
                    CapturedBy = "Payfast", CreatedAt = clock.GetUtcNow(),
                };
                db.Receipts.Add(receipt);
                db.ReceiptAllocations.Add(new ReceiptAllocation { ReceiptId = receipt.Id, AccountId = account.Id, Amount = payment.Amount });
                await ledger.PostAsync(account, receipt.Date, TransactionTypes.Payment, "Card payment received — thank you", -payment.Amount, "Payfast", receipt.Reference, receipt.Id, ct);
                payment.Status = "complete";
                payment.CompletedAt = clock.GetUtcNow();
                payment.ReceiptId = receipt.Id;
                break;
            case "FAILED":
                payment.Status = "failed";
                break;
            case "CANCELLED":
                payment.Status = "cancelled";
                break;
            default:
                log.LogInformation("Payfast levy notification with status {Status} for payment {Payment}: nothing to do", status, payment.Id);
                return Results.Ok();
        }
        audit.Record($"Payfast notification: {status} for a card payment of {CommercialEndpoints.Rand(payment.Amount)} on {account.AccountNo} (Payfast {pfId})", "success",
            category: "security", organisationId: payment.OrganisationId, schemeId: payment.SchemeId, resource: "Account", resourceId: account.Id.ToString(), system: "Payfast");
        // D43: a card payment that clears the arrears ends the account's collection, as any other payment does.
        if (status == "COMPLETE") await credit.SettleAsync(account, false, ct);
        await db.SaveChangesAsync(ct);
        await notices.SendEmailsAsync(ct);
        return Results.Ok();
    }
}
