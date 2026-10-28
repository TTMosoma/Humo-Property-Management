using System.Globalization;
using System.Text;
using System.Text.Json;
using Humo.Api.Commands;
using Humo.Api.Maintenance;
using Humo.Api.Portfolio;
using Humo.Api.Work;
using Humo.Domain.Access;
using Humo.Domain.Commercial;
using Humo.Domain.Finance;
using Humo.Domain.Maintenance;
using Humo.Infrastructure.Data;
using Humo.Infrastructure.Messaging;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Finance;

/// <summary>One supplier's payment in a batch: their verified bank account as it was when the batch was made.</summary>
public sealed record Payee(string SupplierId, string Name, string Email, string BankName, string BranchCode, string AccountNumber, string AccountType, string AccountHolder,
    decimal Amount, List<string> InvoiceIds, List<string> InvoiceNumbers, string Reference);

/// <summary>A payee as the app shows it: the account masked.</summary>
public sealed record PayeeDto(string SupplierId, string Name, string Account, decimal Amount, string Reference);
public sealed record PaymentBatchDto(string Id, int Version, string Ref, string SchemeId, List<string> InvoiceIds, decimal Total, string CreatedAt, string CreatedBy, string CreatedById,
    string Status, string? ApprovalWorkItemId, string? ReleasedAt, string? ReleasedBy, string? CancelledAt, string? CancelledBy, string? CancelReason, List<PayeeDto> Payees);
public sealed record BatchViewDto(PaymentBatchDto Batch, SchemeDto Scheme, List<InvoiceViewDto> Invoices, WorkItemDto? ApprovalItem);
public sealed record NewBatchRequest(List<string>? InvoiceIds);
public sealed record BatchReleaseRequest(int? ExpectedVersion);
public sealed record BatchCancelRequest(string? Reason, int? ExpectedVersion);
public sealed record BankDetailsRequest(string? BankName, string? BranchCode, string? AccountNumber, string? AccountType, string? AccountHolder);

/// <summary>
/// Supplier payments (slice 3b, D27). Approved invoices of one scheme go into a payment batch; someone other than the
/// preparer approves it in My work; someone other than the preparer releases it with a passkey. Releasing gives the
/// payment file for internet banking, marks the invoices paid and emails each supplier a remittance advice. Humo PM
/// never moves the money itself: the agency pays at its bank. Payments go only to bank accounts someone other than
/// the person who entered them has verified, and a batch is refused if an account changed after it was made.
/// </summary>
public sealed class Payables(HumoDbContext db, TimeProvider clock, MaintenanceService maintenance)
{
    public static readonly string[] Approvers = [Roles.AgencyAdmin, Roles.Finance];
    public static readonly string[] AccountTypes = ["cheque", "savings", "transmission"];

    public DateTimeOffset Now => clock.GetUtcNow();

    public static string Masked(string bank, string number) => number.Length < 4 ? "To be confirmed" : $"{bank} ····{number[^4..]}";

    public static List<Payee> Read(PaymentBatchRow b) => JsonSerializer.Deserialize<List<Payee>>(b.Payees, Json.Options) ?? [];

    public static PaymentBatchDto ToDto(PaymentBatchRow b) => new(b.Id.ToString(), b.Version, b.Ref, b.SchemeId.ToString(),
        [.. Read(b).SelectMany(p => p.InvoiceIds)], b.Total, b.CreatedAt.ToString("O"), b.CreatedBy, b.CreatedById.ToString(), b.Status, b.ApprovalWorkItemId?.ToString(),
        b.ReleasedAt?.ToString("O"), b.ReleasedBy, b.CancelledAt?.ToString("O"), b.CancelledBy, b.CancelReason,
        [.. Read(b).Select(p => new PayeeDto(p.SupplierId, p.Name, Masked(p.BankName, p.AccountNumber), p.Amount, p.Reference))]);

    public async Task<List<BatchViewDto>> ViewsAsync(List<PaymentBatchRow> batches, CancellationToken ct)
    {
        var ids = batches.Select(b => b.Id).ToList();
        var invoices = await db.SupplierInvoices.Where(i => i.BatchId != null && ids.Contains(i.BatchId.Value)).ToListAsync(ct);
        // A cancelled or rejected batch has let its invoices go: show the ones it held.
        var heldIds = batches.SelectMany(b => Read(b).SelectMany(p => p.InvoiceIds)).Select(Guid.Parse).Except(invoices.Select(i => i.Id)).ToList();
        invoices.AddRange(await db.SupplierInvoices.Where(i => heldIds.Contains(i.Id)).ToListAsync(ct));
        var views = (await maintenance.InvoiceViewsAsync(invoices, ct)).ToDictionary(v => v.Invoice.Id);
        var schemeIds = batches.Select(b => b.SchemeId).Distinct().ToList();
        var schemes = (await SchemeEndpoints.ToDtos(await db.Schemes.Where(s => schemeIds.Contains(s.Id)).ToListAsync(ct), db, ct)).ToDictionary(s => s.Id);
        var itemIds = batches.Where(b => b.ApprovalWorkItemId != null).Select(b => b.ApprovalWorkItemId!.Value).ToList();
        var items = await db.WorkItems.Where(w => itemIds.Contains(w.Id)).ToDictionaryAsync(w => w.Id, ct);
        return [.. batches.Select(b => new BatchViewDto(ToDto(b), schemes[b.SchemeId.ToString()],
            [.. Read(b).SelectMany(p => p.InvoiceIds).Where(views.ContainsKey).Select(i => views[i])],
            b.ApprovalWorkItemId is { } w && items.TryGetValue(w, out var item) ? WorkItemEndpoints.ToDto(item) : null))];
    }

    /// <summary>The next batch reference for a scheme: PB-KC-0001.</summary>
    public async Task<string> NextRefAsync(Scheme scheme, CancellationToken ct)
    {
        var prefix = $"PB-{scheme.Code}-";
        var refs = await db.PaymentBatches.Where(b => b.OrganisationId == scheme.OrganisationId && b.Ref.StartsWith(prefix)).Select(b => b.Ref).ToListAsync(ct);
        var next = refs.Select(r => int.TryParse(r.AsSpan(prefix.Length), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0).DefaultIfEmpty(0).Max() + 1;
        return $"{prefix}{next:0000}";
    }

    /// <summary>One payment per supplier, from their verified bank account. References fit a bank statement (20 characters).</summary>
    public static List<Payee> PayeesFor(List<SupplierInvoiceRow> invoices, Dictionary<Guid, SupplierRow> suppliers, string schemeCode, string batchRef) =>
        [.. invoices.GroupBy(i => i.SupplierId).Select(g =>
        {
            var s = suppliers[g.Key];
            var numbers = g.Select(i => i.Number).ToList();
            var reference = Fit(numbers.Count == 1 ? $"{schemeCode} {numbers[0]}" : $"{schemeCode} {batchRef}");
            return new Payee(s.Id.ToString(), s.Name, s.Email, s.BankName, s.BranchCode, s.AccountNumber, s.AccountType, s.AccountHolder,
                Ledger.Round2(g.Sum(i => i.Amount)), [.. g.Select(i => i.Id.ToString())], numbers, reference);
        }).OrderBy(p => p.Name)];

    private static string Fit(string s) => s.Length <= 20 ? s : s[..20];

    /// <summary>Whose bank account isn't the verified one the batch was made with: release is refused.</summary>
    public static List<string> ChangedSince(List<Payee> payees, Dictionary<Guid, SupplierRow> suppliers) =>
        [.. payees.Where(p => !suppliers.TryGetValue(Guid.Parse(p.SupplierId), out var s) || !s.BankVerified || s.BankName != p.BankName || s.BranchCode != p.BranchCode
            || s.AccountNumber != p.AccountNumber || s.AccountType != p.AccountType || s.AccountHolder != p.AccountHolder).Select(p => p.Name)];

    /// <summary>
    /// The payment file for internet banking: one row per supplier. A generic layout (CSV) that the banks' bulk-payment
    /// imports can map; bank-specific layouts come later.
    /// </summary>
    public static byte[] PaymentFile(PaymentBatchRow b)
    {
        var csv = new StringBuilder("Beneficiary name,Bank,Branch code,Account number,Account type,Amount,Beneficiary reference,Own reference\n");
        foreach (var p in Read(b))
            csv.AppendLine(string.Join(',', new[] { p.AccountHolder, p.BankName, p.BranchCode, p.AccountNumber, p.AccountType, p.Amount.ToString("0.00", CultureInfo.InvariantCulture),
                p.Reference, Fit($"{b.Ref} {p.Name}") }.Select(Cell)));
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(csv.ToString())];
    }

    private static string Cell(string? v) => v is null ? "" : v.IndexOfAny([',', '"', '\n']) >= 0 ? $"\"{v.Replace("\"", "\"\"")}\"" : v;

    public static string FileName(PaymentBatchRow b) => $"{b.Ref} payments.csv";

    /// <summary>The remittance advice a supplier gets when their payment is released.</summary>
    public static EmailMessage Remittance(Payee p, PaymentBatchRow b, string schemeName, string agencyName, DateOnly paidOn)
    {
        var lines = string.Join("\n", p.InvoiceNumbers.Select(n => $"  Invoice {n}"));
        return new EmailMessage(p.Email, $"Remittance advice: {BillingRules.Rand(p.Amount)} from {schemeName}",
            $"""
            Hello {p.Name},

            {agencyName} has released a payment of {BillingRules.Rand(p.Amount)} to you from {schemeName}’s trust account on {paidOn:d MMMM yyyy}.

            It pays:
            {lines}

            Into: {Masked(p.BankName, p.AccountNumber)}
            Reference: {p.Reference}

            Payments usually reach your account within two working days. If something doesn’t match, reply to {agencyName} with the reference above.

            Sent by Humo Property Management for {agencyName}
            """);
    }

    /// <summary>Lets a batch's invoices go (rejected or cancelled): they're approved and ready to pay again.</summary>
    public async Task FreeInvoicesAsync(PaymentBatchRow b, string note, string by, CancellationToken ct)
    {
        var ids = Read(b).SelectMany(p => p.InvoiceIds).Select(Guid.Parse).ToList();
        foreach (var inv in await db.SupplierInvoices.Where(i => ids.Contains(i.Id) && i.BatchId == b.Id).ToListAsync(ct))
        {
            inv.Status = "approved";
            inv.BatchId = null;
            inv.Version++;
            await LogOnJobAsync(inv, $"{note}: invoice {inv.Number} is ready to pay again", by, ct);
        }
    }

    public async Task LogOnJobAsync(SupplierInvoiceRow inv, string text, string by, CancellationToken ct)
    {
        if (inv.JobId is not { } jobId || await db.Jobs.FirstOrDefaultAsync(j => j.Id == jobId, ct) is not { } row) return;
        var job = MaintenanceService.Read(row);
        JobRules.Log(job, "payment", text, by, maintenance.NowText);
        job.Version++;
        MaintenanceService.Write(row, job);
    }

    /// <summary>Marks the job paid once its invoice is.</summary>
    public async Task PaidOnJobAsync(SupplierInvoiceRow inv, string text, string by, CancellationToken ct)
    {
        if (inv.JobId is not { } jobId || await db.Jobs.FirstOrDefaultAsync(j => j.Id == jobId, ct) is not { } row) return;
        var job = MaintenanceService.Read(row);
        if (job.Stage == JobStages.Invoiced) job.Stage = JobStages.Paid;
        JobRules.Log(job, "payment", text, by, maintenance.NowText);
        job.Version++;
        MaintenanceService.Write(row, job);
    }

    /// <summary>The agency's other staff who could release this batch (active, with Payables.Release, covering its scheme).</summary>
    public async Task<bool> SomeoneElseCanReleaseAsync(PaymentBatchRow b, Guid me, CancellationToken ct)
    {
        var roles = AccessCatalogue.Roles.Where(r => r.Value.Contains("Payables.Release")).Select(r => r.Key).ToList();
        var assignments = await db.RoleAssignments.AsNoTracking()
            .Where(a => a.OrganisationId == b.OrganisationId && a.Status == AssignmentStatuses.Active && roles.Contains(a.Role) && a.UserId != me).ToListAsync(ct);
        var users = assignments.Where(a => a.ScopeType == ScopeTypes.Organisation || a.SchemeIds.Contains(b.SchemeId.ToString())).Select(a => a.UserId).Distinct().ToList();
        return await db.Users.AsNoTracking().AnyAsync(u => users.Contains(u.Id) && u.Status == IdentityStatuses.Active, ct);
    }
}

/// <summary>A payment batch decided in My work: approved, it can be released; rejected, its invoices are ready to pay again.</summary>
public sealed class PaymentBatchApprovalHandler(HumoDbContext db, Payables payables) : IApprovalHandler
{
    public string Type => "payment-batch-approval";

    public async Task<string?> RefuseAsync(WorkItemRow item, Actor actor, bool approve, CancellationToken ct)
    {
        if (!approve || await db.PaymentBatches.FirstOrDefaultAsync(b => b.Id == item.SourceId, ct) is not { } batch) return null;
        // Maker and checker (D27): whoever prepared the batch doesn't approve it.
        return batch.CreatedById == actor.Human.Id ? "You prepared this payment batch: someone else approves it." : null;
    }

    public async Task DecidedAsync(WorkItemRow item, Actor actor, bool approve, string? comment, CancellationToken ct)
    {
        if (await db.PaymentBatches.FirstOrDefaultAsync(b => b.Id == item.SourceId, ct) is not { Status: "awaiting-approval" } batch) return;
        batch.Status = approve ? "approved" : "rejected";
        batch.Version++;
        if (!approve) await payables.FreeInvoicesAsync(batch, $"Payment batch {batch.Ref} rejected by {actor.Human.Name}{(comment is null ? "" : $" (“{comment}”)")}", actor.Human.Name, ct);
    }
}

/// <summary>
/// A supplier's new bank account, verified in My work by someone other than the person who entered it (D27): approved,
/// payments to the supplier can go into it; rejected, they stay held until the details are entered again.
/// </summary>
public sealed class BankDetailsVerificationHandler(HumoDbContext db, TimeProvider clock) : IApprovalHandler
{
    public string Type => "bank-details-verification";

    /// <summary>Bank details always need the passkey, whatever the amount; never an SMS code (D26).</summary>
    public bool NeedsPasskey => true;

    public async Task<string?> RefuseAsync(WorkItemRow item, Actor actor, bool approve, CancellationToken ct)
    {
        if (!approve || await db.Suppliers.FirstOrDefaultAsync(s => s.Id == item.SourceId, ct) is not { } supplier) return null;
        return supplier.BankChangedById == actor.Human.Id ? "You entered these bank details: someone else verifies them." : null;
    }

    public async Task DecidedAsync(WorkItemRow item, Actor actor, bool approve, string? comment, CancellationToken ct)
    {
        if (await db.Suppliers.FirstOrDefaultAsync(s => s.Id == item.SourceId && s.BankWorkItemId == item.Id, ct) is not { } supplier) return;
        supplier.BankWorkItemId = null;
        supplier.BankVerified = approve;
        supplier.BankVerifiedBy = approve ? actor.Human.Name : null;
        supplier.BankVerifiedAt = approve ? clock.GetUtcNow() : null;
        if (!approve) supplier.BankAccount = "Rejected: enter the details again";
        supplier.Version++;
    }
}
