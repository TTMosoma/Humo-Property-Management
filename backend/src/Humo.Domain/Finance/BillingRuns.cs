using System.Globalization;

namespace Humo.Domain.Finance;

// The shapes match frontend/humo-web/src/app/domain/models/billing.ts (camelCase on the wire).

public sealed class Charge
{
    /// <summary>levy, special-levy, utility or interest.</summary>
    public string Kind { get; set; } = "levy";
    public string Description { get; set; } = "";
    public decimal Amount { get; set; }
}

public sealed class BillingLine
{
    public string AccountId { get; set; } = "";
    public string AccountNo { get; set; } = "";
    public string UnitNumber { get; set; } = "";
    public string HolderName { get; set; } = "";
    public List<Charge> Charges { get; set; } = [];
    public decimal Total { get; set; }
    public bool Excluded { get; set; }
}

public sealed class BillingException
{
    public string Id { get; set; } = "";
    public string AccountId { get; set; } = "";
    public string AccountNo { get; set; } = "";
    /// <summary>meter-missing, unusual-reading, levy-changed, arrangement, handed-over, large-credit or no-holder.</summary>
    public string Kind { get; set; } = "";
    public string Detail { get; set; } = "";
    /// <summary>The decisions that make sense for this kind; the first is the usual one.</summary>
    public List<string> Options { get; set; } = [];
    public string? Decision { get; set; }
    public string? DecidedBy { get; set; }
    public string? Note { get; set; }
}

public sealed class BillingEvent
{
    public string Id { get; set; } = "";
    public string At { get; set; } = "";
    /// <summary>stage, exception, approval, posting, statements or comment.</summary>
    public string Kind { get; set; } = "";
    public string Text { get; set; } = "";
    public string By { get; set; } = "";
}

public sealed record RunApproval(string DecidedAt, string DecidedBy, string? Comment);
public sealed record RunPosted(string At, string By, int Accounts, decimal Total);
public sealed record RunCancelled(string At, string By, string Reason);

/// <summary>One month's charges for one scheme (docs/11 §1): prepared, checked and approved before anything reaches an account.</summary>
public sealed class BillingRun
{
    public string Id { get; set; } = "";
    public int Version { get; set; } = 1;
    /// <summary>"BR-KC-2611".</summary>
    public string Ref { get; set; } = "";
    public string SchemeId { get; set; } = "";
    /// <summary>"2026-11".</summary>
    public string Period { get; set; } = "";
    /// <summary>preview, awaiting-approval, approved, posted, sent or cancelled.</summary>
    public string Stage { get; set; } = "preview";
    public string CreatedAt { get; set; } = "";
    public string CreatedBy { get; set; } = "";
    /// <summary>Who prepared it (an identity id): they can't also approve it (segregation of duties).</summary>
    public string CreatedById { get; set; } = "";
    public List<BillingLine> Lines { get; set; } = [];
    public List<BillingException> Exceptions { get; set; } = [];
    public decimal? PreviousTotal { get; set; }
    public string? ApprovalWorkItemId { get; set; }
    public RunApproval? Approval { get; set; }
    public RunPosted? Posted { get; set; }
    public RunCancelled? Cancelled { get; set; }
    public List<BillingEvent> Events { get; set; } = [];
}

/// <summary>Everything about one account the run needs.</summary>
public sealed record AccountForBilling(string AccountId, string AccountNo, string UnitNumber, string? HolderName, decimal MonthlyLevy, decimal? LastLevy, decimal Balance,
    Ageing Ageing, string Status, Water? Water);

/// <summary>This month's water for a unit: from its meter, or the 3-month estimate when there's no reading.</summary>
public sealed record Water(Charge Charge, bool Estimated, string? Unusual);

public sealed record BillingAction(string Type, string? ExceptionId = null, string? Decision = null, string? Note = null, string? Reason = null, string? Text = null);

/// <summary>
/// The billing run's rules, as the prototype's billing store states them (docs/11 §1): the charges per account,
/// the exceptions a person must decide, and what each stage allows. Pure: the API stores and posts.
/// </summary>
public static class BillingRules
{
    public static readonly string[] Open = ["preview", "awaiting-approval", "approved"];
    /// <summary>A consumption above this many times the unit's usual is flagged.</summary>
    public const decimal UnusualFactor = 3;

    private static readonly Dictionary<string, string> ExceptionLabels = new()
    {
        ["meter-missing"] = "No meter reading", ["unusual-reading"] = "Unusual meter reading", ["levy-changed"] = "Levy changed", ["arrangement"] = "Payment arrangement",
        ["handed-over"] = "With the attorney", ["large-credit"] = "Large credit balance", ["no-holder"] = "No owner on record",
    };

    private static readonly Dictionary<string, string> DecisionLabels = new()
    {
        ["include"] = "Bill as calculated", ["exclude"] = "Leave out of this run", ["estimate"] = "Bill an estimate (3-month average)",
        ["no-interest"] = "Bill, but no interest", ["acknowledge"] = "Noted — bill as calculated",
    };

    public static string Rand(decimal n) => "R" + n.ToString(n == Math.Floor(n) ? "#,0" : "#,0.00", new NumberFormatInfo { NumberGroupSeparator = " ", NumberDecimalSeparator = "," });

    public static string MonthName(string period) => CultureInfo.InvariantCulture.DateTimeFormat.GetMonthName(int.Parse(period[5..7], CultureInfo.InvariantCulture));

    public static string NextPeriod(string period)
    {
        var d = new DateOnly(int.Parse(period[..4], CultureInfo.InvariantCulture), int.Parse(period[5..7], CultureInfo.InvariantCulture), 1).AddMonths(1);
        return $"{d.Year:D4}-{d.Month:D2}";
    }

    public static decimal Total(BillingRun run) => Ledger.Round2(run.Lines.Where(l => !l.Excluded).Sum(l => l.Total));

    public static List<BillingException> OpenExceptions(BillingRun run) => run.Exceptions.Where(e => e.Decision is null).ToList();

    /// <summary>Water: consumption × rate from this month's reading and the last; without a reading, the usual consumption, flagged.</summary>
    public static Water WaterCharge(string unitNumber, string period, decimal ratePerKl, decimal? reading, decimal? previous, decimal? usual)
    {
        var month = MonthName(period);
        if (reading is { } now && previous is { } before)
        {
            var used = Ledger.Round2(now - before);
            var unusual = usual is > 0 && used > UnusualFactor * usual
                ? $"Unit {unitNumber} used {used} kl, more than {UnusualFactor}× its usual {usual} kl. Check the reading ({before} → {now}) before billing it."
                : null;
            return new Water(new Charge { Kind = "utility", Description = $"Water — {month}: {used} kl at {Rand(ratePerKl)}/kl", Amount = Ledger.Round2(used * ratePerKl) }, false, unusual);
        }
        var est = usual ?? 0;
        return new Water(new Charge { Kind = "utility", Description = $"Water — {month} (estimated: {est} kl at {Rand(ratePerKl)}/kl)", Amount = Ledger.Round2(est * ratePerKl) }, true, null);
    }

    /// <summary>Each account's charges for the period and the exceptions to decide. Interest is on what's overdue (30 days and older).</summary>
    public static (List<BillingLine> Lines, List<BillingException> Exceptions) Prepare(IEnumerable<AccountForBilling> accounts, string period, decimal interestPercentPerMonth)
    {
        var month = MonthName(period);
        var lines = new List<BillingLine>();
        var exceptions = new List<BillingException>();
        foreach (var a in accounts)
        {
            var charges = new List<Charge> { new() { Kind = "levy", Description = $"Levy — {month}", Amount = a.MonthlyLevy } };
            if (a.Water is { } w) charges.Add(w.Charge);
            var overdue = a.Ageing.Overdue;
            if (overdue > 0 && interestPercentPerMonth > 0)
                charges.Add(new Charge { Kind = "interest", Description = $"Interest on arrears ({interestPercentPerMonth.ToString("0.##", CultureInfo.InvariantCulture)}% per month)", Amount = Ledger.Round2(overdue * interestPercentPerMonth / 100) });
            var line = new BillingLine { AccountId = a.AccountId, AccountNo = a.AccountNo, UnitNumber = a.UnitNumber, HolderName = a.HolderName ?? "—", Charges = charges, Total = Ledger.Round2(charges.Sum(c => c.Amount)) };
            lines.Add(line);
            void Add(string kind, string detail, params string[] options) =>
                exceptions.Add(new BillingException { Id = $"{a.AccountId}-{kind}", AccountId = a.AccountId, AccountNo = a.AccountNo, Kind = kind, Detail = detail, Options = [.. options] });
            if (a.HolderName is null) Add("no-holder", "No current owner on the account: there’s nobody to bill.", "exclude");
            if (a.Water is { Estimated: true } est) Add("meter-missing", $"No water meter reading for unit {a.UnitNumber}. The 3-month average is {Rand(est.Charge.Amount)}.", "estimate", "exclude");
            if (a.Water?.Unusual is { } unusual) Add("unusual-reading", unusual, "include", "exclude");
            if (a.LastLevy is { } last && Math.Abs(last - a.MonthlyLevy) > 0.005m) Add("levy-changed", $"Levy changes from {Rand(last)} to {Rand(a.MonthlyLevy)}. Check the trustees approved it.", "include", "exclude");
            if (a.Status == AccountStatuses.Arrangement)
                Add("arrangement", $"On a payment arrangement: interest of {Rand(charges.FirstOrDefault(c => c.Kind == "interest")?.Amount ?? 0)} is usually suspended while it’s kept.", "no-interest", "include");
            if (a.Status == AccountStatuses.HandedOver) Add("handed-over", "With the scheme’s attorney: the statement is copied to them.", "acknowledge", "exclude");
            if (a.MonthlyLevy > 0 && a.Balance < -3 * a.MonthlyLevy) Add("large-credit", $"In credit by {Rand(-a.Balance)}: more than three months’ charges. Consider a refund.", "acknowledge");
        }
        return (lines, exceptions);
    }

    /// <summary>What an action needs (field → message; empty when it's allowed).</summary>
    public static Dictionary<string, string> Check(BillingRun run, BillingAction action)
    {
        var e = new Dictionary<string, string>();
        var locked = run.Stage is "posted" or "sent";
        switch (action.Type)
        {
            case "decide":
                var x = run.Exceptions.FirstOrDefault(i => i.Id == action.ExceptionId);
                if (run.Stage != "preview") e["decision"] = locked ? "This run is posted and locked. Correct an account with a journal adjustment." : "Decisions are made before the run goes for approval.";
                else if (x is null || action.Decision is null || !x.Options.Contains(action.Decision)) e["decision"] = "Choose one of the options for this exception.";
                break;
            case "send-for-approval":
                if (run.Stage != "preview") e["stage"] = "Only a run being prepared can go for approval.";
                var open = OpenExceptions(run).Count;
                if (open > 0) e["exceptions"] = $"{open} exception{(open == 1 ? "" : "s")} still need{(open == 1 ? "s" : "")} a decision.";
                if (!run.Lines.Any(l => !l.Excluded)) e["lines"] = "Nothing would be billed.";
                break;
            case "post":
                if (run.Stage != "approved") e["stage"] = run.Stage == "awaiting-approval" ? "The run is still with the approvers." : "Only an approved run can be posted.";
                break;
            case "send-statements":
                e["stage"] = "Statements are sent with slice 2c.";
                break;
            case "cancel":
                if (locked) e["stage"] = "A posted run can’t be cancelled. Correct accounts with journal adjustments.";
                else if (run.Stage == "cancelled") e["stage"] = "It’s already cancelled.";
                if ((action.Reason ?? "").Trim().Length < 5) e["reason"] = "Give a short reason for the audit log.";
                break;
            case "comment":
                if (string.IsNullOrWhiteSpace(action.Text)) e["text"] = "Write a comment.";
                break;
            default:
                e["type"] = "That isn’t something a billing run does.";
                break;
        }
        return e;
    }

    /// <summary>Records a decision and re-derives the line from all of its account's decisions.</summary>
    public static void Decide(BillingRun run, BillingException x, string decision, string by, string? note, string at)
    {
        x.Decision = decision;
        x.DecidedBy = by;
        x.Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        var line = run.Lines.First(l => l.AccountId == x.AccountId);
        var decisions = run.Exceptions.Where(e => e.AccountId == x.AccountId && e.Decision is not null).Select(e => e.Decision).ToList();
        line.Excluded = decisions.Contains("exclude");
        if (decisions.Contains("no-interest")) line.Charges.RemoveAll(c => c.Kind == "interest");
        line.Total = Ledger.Round2(line.Charges.Sum(c => c.Amount));
        Log(run, "exception", $"{x.AccountNo} · {ExceptionLabels[x.Kind]}: {DecisionLabels[decision]}{(x.Note is null ? "" : $" ({x.Note})")}", by, at);
    }

    public static void Log(BillingRun run, string kind, string text, string by, string at) =>
        run.Events.Insert(0, new BillingEvent { Id = Guid.NewGuid().ToString("N")[..12], At = at, Kind = kind, Text = text, By = by });
}
