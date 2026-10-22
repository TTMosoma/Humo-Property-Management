using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Commercial;
using Humo.Domain.Commercial;
using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Finance;

public sealed record InvoiceLineRequest(string? Description, decimal Quantity, decimal UnitPrice);
/// <summary>The owner is named by the unit (its levy account) or by the account itself.</summary>
public sealed record IssueInvoiceRequest(string? UnitId, string? AccountId, DateOnly? Date, DateOnly? DueOn, List<InvoiceLineRequest>? Lines);
public sealed record InvoicePaymentRequest(decimal Amount, DateOnly? Date, string? Reference);

public sealed record InvoiceLineDto(string Description, decimal Quantity, decimal UnitPrice, decimal Amount);
public sealed record InvoicePaymentDto(string Date, decimal Amount, string? Reference, string RecordedBy);
public sealed record OwnerInvoiceDto(string Id, string Number, string AccountId, string AccountNo, string SchemeId, string Date, string DueOn,
    List<InvoiceLineDto> Lines, decimal Total, decimal Paid, decimal Outstanding, string Status, List<InvoicePaymentDto> Payments, string? EmailedAt, int Version);

/// <summary>
/// Basic invoicing (D17, the Essentials package): an agency issues an invoice to an owner for one of their levy accounts.
/// Issuing posts a charge to the account's ledger, so the owner's statement shows it; recording a payment posts a credit.
/// Invoices are numbered per agency, INV-0001 onwards. Writing needs the invoicing feature and the billing permissions.
/// </summary>
public static class OwnerInvoiceEndpoints
{
    public const string Feature = "invoicing-basic";

    public static void MapOwnerInvoices(this IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/owner-invoices").RequireAuthorization();
        g.MapGet("", List);
        g.MapGet("/{id:guid}", Get);
        g.MapPost("", Issue);
        g.MapPost("/{id:guid}/payments", RecordPayment);
        g.MapPost("/{id:guid}/send", Send);
    }

    private static async Task<IResult> List(string? schemeIds, CurrentActor current, HumoDbContext db, Commercial.CommercialRecords commercial, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Billing.View")) return Problems.Policy("forbidden", "Role does not have this permission");
        if (actor.OrganisationId is not { } org || !await commercial.EntitledAsync(org, Feature, ct)) return Problems.Policy("not-entitled", "Not included in the agency’s plan");
        var wanted = (schemeIds ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(v => Guid.TryParse(v, out var g) ? g : Guid.Empty).Where(g => g != Guid.Empty).ToHashSet();
        var invoices = await db.OwnerInvoices.AsNoTracking().Where(i => i.OrganisationId == org).OrderByDescending(i => i.Number).ToListAsync(ct);
        var visible = invoices.Where(i => actor.CoversScheme(i.SchemeId) && (wanted.Count == 0 || wanted.Contains(i.SchemeId))).ToList();
        var numbers = await AccountNumbersAsync(db, visible, ct);
        return Results.Ok(visible.Select(i => Dto(i, numbers.GetValueOrDefault(i.AccountId, ""))).ToList());
    }

    private static async Task<IResult> Get(Guid id, CurrentActor current, HumoDbContext db, Commercial.CommercialRecords commercial, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (!actor.Can("Billing.View")) return Problems.Policy("forbidden", "Role does not have this permission");
        if (actor.OrganisationId is not { } org || !await commercial.EntitledAsync(org, Feature, ct)) return Problems.Policy("not-entitled", "Not included in the agency’s plan");
        var invoice = await db.OwnerInvoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id && i.OrganisationId == org, ct);
        if (invoice is null || !actor.CoversScheme(invoice.SchemeId)) return Problems.NotFound();
        return Results.Ok(Dto(invoice, (await AccountNumbersAsync(db, [invoice], ct)).GetValueOrDefault(invoice.AccountId, "")));
    }

    /// <summary>Issues an invoice: it's numbered, and its total is charged to the owner's account.</summary>
    private static async Task<IResult> Issue(IssueInvoiceRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, AccountLedger ledger, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        if (actor.OrganisationId is not { } org) return Problems.NotFound();
        var errors = new Dictionary<string, string>();
        var account = Guid.TryParse(body.UnitId, out var unitId) ? await db.LevyAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.UnitId == unitId, ct)
            : Guid.TryParse(body.AccountId, out var accountId) ? await db.LevyAccounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == accountId, ct) : null;
        var scheme = account is null ? null : await db.Schemes.AsNoTracking().FirstOrDefaultAsync(s => s.Id == account.SchemeId && s.OrganisationId == org, ct);
        if (account is null || scheme is null || !actor.CoversScheme(account.SchemeId)) errors["accountId"] = "Choose the owner’s account to invoice.";
        var lines = (body.Lines ?? []).Select(l => new InvoiceLineDto((l.Description ?? "").Trim(), l.Quantity, Ledger.Round2(l.UnitPrice), Ledger.Round2(l.Quantity * l.UnitPrice))).ToList();
        if (lines.Count == 0) errors["lines"] = "Add at least one line.";
        if (lines.Any(l => l.Description.Length == 0)) errors["lines"] = "Every line needs a description.";
        if (lines.Any(l => l.Quantity <= 0 || l.UnitPrice < 0)) errors["lines"] = "Quantities must be more than zero, and prices can’t be negative.";
        var total = lines.Sum(l => l.Amount);
        if (lines.Count > 0 && total <= 0) errors["lines"] = "The invoice total must be more than zero.";
        var date = body.Date ?? DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var dueOn = body.DueOn ?? date.AddDays(30);
        if (dueOn < date) errors["dueOn"] = "The due date is before the invoice date.";
        if (errors.Count > 0) return Problems.Validation(errors);

        return await commands.RunAsync(new CommandSpec($"Issued an invoice to {account!.AccountNo}", "Billing.Run")
        {
            Resource = "Owner invoice",
            ResourceId = account.AccountNo,
            SchemeId = account.SchemeId,
            Category = "finance",
            Feature = Feature,
        }, async writer =>
        {
            var number = await NextNumberAsync(db, org, ct);
            var invoice = new OwnerInvoice
            {
                Id = Guid.CreateVersion7(), OrganisationId = org, SchemeId = account!.SchemeId, AccountId = account.Id, Number = number, Date = date, DueOn = dueOn,
                Lines = JsonSerializer.Serialize(lines, Json.Options), Total = total, Paid = 0, Status = "issued", IssuedBy = writer.Human.Name, IssuedAt = clock.GetUtcNow(),
            };
            db.OwnerInvoices.Add(invoice);
            var tracked = await db.LevyAccounts.FirstAsync(a => a.Id == account.Id, ct);
            await ledger.PostAsync(tracked, date, TransactionTypes.Adjustment, $"Invoice {number}: {Summary(lines)}", total, writer.Human.Name, number, ct: ct);
            return Results.Ok(new { id = invoice.Id.ToString(), number });
        }, ct);
    }

    /// <summary>Records a payment against an invoice: a credit to the account, up to what's still owed.</summary>
    private static async Task<IResult> RecordPayment(Guid id, InvoicePaymentRequest body, CurrentActor current, CommandRunner commands, HumoDbContext db, AccountLedger ledger, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var invoice = await db.OwnerInvoices.FirstOrDefaultAsync(i => i.Id == id && i.OrganisationId == actor.OrganisationId, ct);
        if (invoice is null || !actor.CoversScheme(invoice.SchemeId)) return Problems.NotFound();
        var outstanding = invoice.Total - invoice.Paid;
        var date = body.Date ?? DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var errors = new Dictionary<string, string>();
        if (body.Amount <= 0) errors["amount"] = "The payment must be more than zero.";
        else if (body.Amount > outstanding) errors["amount"] = $"Only {outstanding:N2} is still owed on {invoice.Number}.";
        if (invoice.Status == "paid") errors["id"] = "This invoice is paid in full.";
        if (errors.Count > 0) return Problems.Validation(errors);

        return await commands.RunAsync(new CommandSpec($"Recorded a payment of {body.Amount:N2} for {invoice.Number}", "Receipts.Allocate")
        {
            Resource = "Owner invoice",
            ResourceId = invoice.Number,
            SchemeId = invoice.SchemeId,
            Category = "finance",
            Feature = Feature,
        }, async writer =>
        {
            var account = await db.LevyAccounts.FirstAsync(a => a.Id == invoice.AccountId, ct);
            var amount = Ledger.Round2(body.Amount);
            var reference = string.IsNullOrWhiteSpace(body.Reference) ? invoice.Number : body.Reference.Trim();
            await ledger.PostAsync(account, date, TransactionTypes.Payment, $"Payment for {invoice.Number}", -amount, writer.Human.Name, reference, ct: ct);
            var payments = JsonSerializer.Deserialize<List<InvoicePaymentDto>>(invoice.Payments, Json.Options) ?? [];
            payments.Add(new InvoicePaymentDto(date.ToString("yyyy-MM-dd"), amount, reference, writer.Human.Name));
            invoice.Payments = JsonSerializer.Serialize(payments, Json.Options);
            invoice.Paid = Ledger.Round2(invoice.Paid + amount);
            invoice.Status = invoice.Paid >= invoice.Total ? "paid" : "issued";
            invoice.Version++;
            return Results.NoContent();
        }, ct);
    }

    /// <summary>Emails the invoice to the owner on record for the unit (the current owner's email address).</summary>
    private static async Task<IResult> Send(Guid id, CurrentActor current, CommandRunner commands, HumoDbContext db, IEmailSender email, TimeProvider clock, CancellationToken ct)
    {
        if (await current.GetAsync(ct) is not { } actor) return Results.Unauthorized();
        var invoice = await db.OwnerInvoices.FirstOrDefaultAsync(i => i.Id == id && i.OrganisationId == actor.OrganisationId, ct);
        if (invoice is null || !actor.CoversScheme(invoice.SchemeId)) return Problems.NotFound();
        var account = await db.LevyAccounts.AsNoTracking().FirstAsync(a => a.Id == invoice.AccountId, ct);
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var owner = account.UnitId is { } unit
            ? await (from r in db.Relationships.AsNoTracking()
                     join p in db.People.AsNoTracking() on r.PersonId equals p.Id
                     where r.Type == "owner" && r.UnitId == unit && (r.Until == null || r.Until >= today) && p.Email != ""
                     select new { p.Email, p.DisplayName }).FirstOrDefaultAsync(ct)
            : null;
        if (owner is null) return Problems.Validation(new() { ["email"] = "The owner of this account has no email address on record." });

        var lines = JsonSerializer.Deserialize<List<InvoiceLineDto>>(invoice.Lines, Json.Options) ?? [];
        var text = $"Hello {owner.DisplayName},\n\nInvoice {invoice.Number} for account {account.AccountNo} is attached as a summary below.\n\n"
            + string.Join("\n", lines.Select(l => $"  {l.Description}: {l.Quantity} × {l.UnitPrice:N2} = {l.Amount:N2}"))
            + $"\n\nTotal: {invoice.Total:N2}\nOutstanding: {invoice.Total - invoice.Paid:N2}\nDue: {invoice.DueOn:yyyy-MM-dd}\n\nPlease pay with the reference {invoice.Number}.";
        return await commands.RunAsync(new CommandSpec($"Emailed invoice {invoice.Number}", "Billing.Run")
        {
            Resource = "Owner invoice",
            ResourceId = invoice.Number,
            SchemeId = invoice.SchemeId,
            Category = "finance",
            Feature = Feature,
        }, async _ =>
        {
            await email.SendAsync(new EmailMessage(owner.Email, $"Invoice {invoice.Number}", text), ct);
            invoice.EmailedAt = clock.GetUtcNow();
            return Results.NoContent();
        }, ct);
    }

    /// <summary>The next number for an agency: one more than the highest so far.</summary>
    private static async Task<string> NextNumberAsync(HumoDbContext db, Guid org, CancellationToken ct)
    {
        var numbers = await db.OwnerInvoices.AsNoTracking().Where(i => i.OrganisationId == org).Select(i => i.Number).ToListAsync(ct);
        var highest = numbers.Select(n => int.TryParse(n.AsSpan(4), out var v) ? v : 0).DefaultIfEmpty(0).Max();
        return $"INV-{highest + 1:0000}";
    }

    private static string Summary(List<InvoiceLineDto> lines) => string.Join("; ", lines.Select(l => l.Description));

    private static async Task<Dictionary<Guid, string>> AccountNumbersAsync(HumoDbContext db, IEnumerable<OwnerInvoice> invoices, CancellationToken ct)
    {
        var ids = invoices.Select(i => i.AccountId).Distinct().ToList();
        return await db.LevyAccounts.AsNoTracking().Where(a => ids.Contains(a.Id)).ToDictionaryAsync(a => a.Id, a => a.AccountNo, ct);
    }

    private static OwnerInvoiceDto Dto(OwnerInvoice i, string accountNo) =>
        new(i.Id.ToString(), i.Number, i.AccountId.ToString(), accountNo, i.SchemeId.ToString(), i.Date.ToString("yyyy-MM-dd"), i.DueOn.ToString("yyyy-MM-dd"),
            JsonSerializer.Deserialize<List<InvoiceLineDto>>(i.Lines, Json.Options) ?? [], i.Total, i.Paid, i.Total - i.Paid, i.Status,
            JsonSerializer.Deserialize<List<InvoicePaymentDto>>(i.Payments, Json.Options) ?? [], i.EmailedAt?.ToString("O"), i.Version);
}
