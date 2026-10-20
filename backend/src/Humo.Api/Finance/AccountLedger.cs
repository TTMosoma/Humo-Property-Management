using Humo.Domain.Finance;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Finance;

/// <summary>
/// Writes to levy accounts (docs/11 §3). Every change is a ledger line; the account's balance, ageing and
/// status are worked out again from its ledger in the same save, so they can't drift from it.
/// </summary>
public sealed class AccountLedger(HumoDbContext db, TimeProvider clock)
{
    public DateOnly Today => DateOnly.FromDateTime(clock.GetUtcNow().ToOffset(TimeSpan.FromHours(2)).DateTime);

    /// <summary>Adds a line (the caller saves) and brings the account up to date.</summary>
    public async Task PostAsync(LevyAccount account, DateOnly date, string type, string description, decimal amount, string by, string? reference = null, Guid? receiptId = null,
        CancellationToken ct = default)
    {
        db.Ledger.Add(new LedgerEntry
        {
            Id = Guid.CreateVersion7(), AccountId = account.Id, Date = date, Type = type, Description = description, Reference = reference,
            Amount = Ledger.Round2(amount), ReceiptId = receiptId, CreatedAt = clock.GetUtcNow(), CreatedBy = by,
        });
        await RecalculateAsync(account, ct);
    }

    /// <summary>Balance, ageing and status from the ledger, counting lines added or removed in this unit of work.</summary>
    public async Task RecalculateAsync(LevyAccount account, CancellationToken ct = default)
    {
        var saved = await db.Ledger.Where(e => e.AccountId == account.Id).ToListAsync(ct);
        var lines = saved.Where(e => db.Entry(e).State != EntityState.Deleted)
            .Concat(db.Ledger.Local.Where(e => e.AccountId == account.Id && db.Entry(e).State == EntityState.Added))
            .Select(e => new LedgerLine(e.Date, e.Amount)).ToList();
        Apply(account, lines, Today);
    }

    public static void Apply(LevyAccount account, List<LedgerLine> lines, DateOnly today)
    {
        var ageing = Ledger.Age(lines, today);
        account.Balance = Ledger.Balance(lines);
        (account.AgeingCurrent, account.AgeingD30, account.AgeingD60, account.AgeingD90, account.AgeingD120) = (ageing.Current, ageing.D30, ageing.D60, ageing.D90, ageing.D120);
        account.Status = Ledger.Status(account.Balance, ageing, account.Status);
    }

    /// <summary>Every account in these schemes, aged as of today (charges move from current to 30 days and on as time passes).</summary>
    public async Task<int> RefreshAsync(IEnumerable<Guid>? schemeIds, CancellationToken ct)
    {
        var ids = schemeIds?.ToList();
        var accounts = await db.LevyAccounts.Where(a => ids == null || ids.Contains(a.SchemeId)).ToListAsync(ct);
        var accountIds = accounts.Select(a => a.Id).ToList();
        var lines = (await db.Ledger.Where(e => accountIds.Contains(e.AccountId)).Select(e => new { e.AccountId, e.Date, e.Amount }).ToListAsync(ct))
            .ToLookup(e => e.AccountId, e => new LedgerLine(e.Date, e.Amount));
        foreach (var a in accounts) Apply(a, lines[a.Id].ToList(), Today);
        await db.SaveChangesAsync(ct);
        return accounts.Count;
    }
}
