using Humo.Domain.Finance;

namespace Humo.Api.Tests;

/// <summary>The levy account's arithmetic and the bank-statement reading rules (docs/11 §3, docs/22 §1).</summary>
public sealed class LedgerRulesTests
{
    private static readonly DateOnly Today = new(2026, 10, 20);

    private static LedgerLine L(int daysAgo, decimal amount) => new(Today.AddDays(-daysAgo), amount);

    [Fact]
    public void Payments_settle_the_oldest_charges_first_and_what_is_left_ages_by_when_it_was_charged()
    {
        // R1 000 levies 130, 100, 70, 40 and 10 days ago; R1 500 paid.
        var lines = new[] { L(130, 1000), L(100, 1000), L(70, 1000), L(40, 1000), L(10, 1000), L(5, -1500) };
        Assert.Equal(3500, Ledger.Balance(lines));
        Assert.Equal(new Ageing(1000, 1000, 1000, 500, 0), Ledger.Age(lines, Today));
        Assert.Equal(AccountStatuses.Arrears, Ledger.Status(3500, Ledger.Age(lines, Today)));
    }

    [Fact]
    public void Current_charges_are_up_to_date_a_credit_balance_is_in_credit_and_decisions_stay_until_paid_up()
    {
        Assert.Equal(AccountStatuses.UpToDate, Ledger.Status(1000, Ledger.Age([L(5, 1000)], Today)));
        Assert.Equal(AccountStatuses.InCredit, Ledger.Status(-200, Ledger.Age([L(5, 1000), L(1, -1200)], Today)));
        Assert.Equal(AccountStatuses.Arrangement, Ledger.Status(800, Ageing.None, AccountStatuses.Arrangement));
        Assert.Equal(AccountStatuses.UpToDate, Ledger.Status(0, Ageing.None, AccountStatuses.HandedOver));
    }

    [Fact]
    public void Reads_South_African_and_international_amounts_and_dates()
    {
        Assert.Equal(1234.5m, BankStatement.ParseAmount("R 1 234,50"));
        Assert.Equal(1234.5m, BankStatement.ParseAmount("1,234.50"));
        Assert.Equal(-500m, BankStatement.ParseAmount("(500.00)"));
        Assert.Equal(-75m, BankStatement.ParseAmount("-75"));
        Assert.Null(BankStatement.ParseAmount("abc"));
        Assert.Equal("2026-10-07", BankStatement.ParseDate("07/10/2026", "dd/mm/yyyy"));
        Assert.Equal("2026-10-07", BankStatement.ParseDate("10/07/2026", "mm/dd/yyyy"));
        Assert.Equal("2026-10-07", BankStatement.ParseDate("2026-10-07", "yyyy-mm-dd"));
        Assert.Null(BankStatement.ParseDate("31/02/2026", "dd/mm/yyyy"));
    }

    [Fact]
    public void Parses_quoted_fields_semicolons_and_credit_and_debit_columns()
    {
        var rows = BankStatement.ParseCsv("Date;Description;Credit;Debit\n07/10/2026;\"KC042; levy\";2950,00;\n08/10/2026;Bank fees;;45,00\n");
        Assert.Equal("KC042; levy", rows[1][1]);
        var lines = BankStatement.Read(rows, new StatementMapping("Date", "dd/mm/yyyy", null, "Credit", "Debit", "Description", null));
        Assert.Equal([("credit", 2950m), ("debit", -45m)], lines.Select(l => (l.Kind, l.Amount!.Value)));
        Assert.Contains("date", BankStatement.MappingProblems(rows[0], new StatementMapping("Posting date", "dd/mm/yyyy", "Amount", null, null, "Description", null)).Keys);
    }

    [Fact]
    public void Matching_gives_reasons_a_remembered_payer_wins_and_names_match_as_whole_words()
    {
        var a1 = Guid.NewGuid();
        var a2 = Guid.NewGuid();
        var candidates = new[]
        {
            new MatchCandidate(a1, "KC-042", "42", 1850, 1850, [("Sipho", "Khumalo", "Sipho Khumalo")], null),
            new MatchCandidate(a2, "KC-012", "12", 2400, 0, [("Anele", "Nel", "Anele Nel")], ("Mokoena", "Thabo Mokoena")),
        };
        var byRef = ReceiptMatching.Match("KC042 OCT LEVY", "S KHUMALO", 1850, "KC", candidates, []);
        Assert.Equal(a1, byRef[0].AccountId);
        Assert.Contains("Reference mentions Unit 42", byRef[0].Reasons);
        Assert.Contains("Amount equals the monthly levy", byRef[0].Reasons);
        Assert.Equal(99, byRef[0].Confidence);

        // "Nel" isn't found inside "Anele"; the tenant's name is a weaker match.
        var tenant = ReceiptMatching.Match("RENT", "T MOKOENA", 2400, "KC", candidates, []);
        Assert.Contains("Payer matches the tenant (Thabo Mokoena), not the owner", Assert.Single(tenant).Reasons);

        var remembered = ReceiptMatching.Match("ACME HOLDINGS", "ACME", 1, "KC", candidates, [("ACME", a2)]);
        Assert.Equal((a2, "Remembered payer rule “ACME”"), (remembered[0].AccountId, remembered[0].Reasons[0]));
    }
}
