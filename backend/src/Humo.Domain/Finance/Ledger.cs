namespace Humo.Domain.Finance;

/// <summary>A ledger line as the rules need it: charges are positive, payments and credits negative.</summary>
public sealed record LedgerLine(DateOnly Date, decimal Amount);

public sealed record Ageing(decimal Current, decimal D30, decimal D60, decimal D90, decimal D120)
{
    public static readonly Ageing None = new(0, 0, 0, 0, 0);
    public decimal Overdue => D30 + D60 + D90 + D120;
}

public static class AccountStatuses
{
    public const string UpToDate = "up-to-date";
    public const string InCredit = "in-credit";
    public const string Arrears = "arrears";
    public const string Arrangement = "arrangement";
    public const string HandedOver = "handed-over";
}

public static class TransactionTypes
{
    public const string Levy = "levy";
    public const string SpecialLevy = "special-levy";
    public const string Utility = "utility";
    public const string Interest = "interest";
    public const string Payment = "payment";
    public const string Adjustment = "adjustment";
    /// <summary>The balance brought forward from the agency's previous system (data migration).</summary>
    public const string Opening = "opening";
}

/// <summary>
/// The levy account's arithmetic (docs/11 §3). Ageing comes from the actual transactions, not an
/// estimate: payments and credits settle the oldest charges first, and what's left of each charge is
/// aged by how long ago it was raised (current under 30 days, then 30, 60, 90 and 120+).
/// </summary>
public static class Ledger
{
    public static decimal Round2(decimal n) => Math.Round(n, 2, MidpointRounding.AwayFromZero);

    public static decimal Balance(IEnumerable<LedgerLine> lines) => Round2(lines.Sum(l => l.Amount));

    public static Ageing Age(IEnumerable<LedgerLine> lines, DateOnly today)
    {
        var ordered = lines.OrderBy(l => l.Date).ToList();
        var credit = -ordered.Where(l => l.Amount < 0).Sum(l => l.Amount);
        decimal current = 0, d30 = 0, d60 = 0, d90 = 0, d120 = 0;
        foreach (var charge in ordered.Where(l => l.Amount > 0))
        {
            // Oldest first: credits settle what's been owed longest.
            var settled = Math.Min(credit, charge.Amount);
            credit -= settled;
            var open = charge.Amount - settled;
            if (open <= 0) continue;
            var days = today.DayNumber - charge.Date.DayNumber;
            if (days < 30) current += open;
            else if (days < 60) d30 += open;
            else if (days < 90) d60 += open;
            else if (days < 120) d90 += open;
            else d120 += open;
        }
        return new Ageing(Round2(current), Round2(d30), Round2(d60), Round2(d90), Round2(d120));
    }

    /// <summary>Arrangements and hand-overs are decisions, not arithmetic: they stay until credit control changes them or the account is paid up.</summary>
    public static string Status(decimal balance, Ageing ageing, string? kept = null)
    {
        if (kept is AccountStatuses.Arrangement or AccountStatuses.HandedOver && balance > 0) return kept;
        if (balance < 0) return AccountStatuses.InCredit;
        return ageing.Overdue > 0 ? AccountStatuses.Arrears : AccountStatuses.UpToDate;
    }
}
