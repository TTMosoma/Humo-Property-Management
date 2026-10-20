namespace Humo.Domain.Finance;

// The shapes match frontend/humo-web/src/app/domain/models/collections.ts (camelCase on the wire).

public sealed record AccountAgeing(decimal Current, decimal D30, decimal D60, decimal D90, decimal D120);
public sealed record LetterTemplateRef(string TemplateId, int Version);

/// <summary>A letter sent at a step: frozen with the amount, ageing, pay-by date and template version at the time.</summary>
public sealed record CollectionLetter(string Kind, decimal Amount, AccountAgeing Ageing, string DueBy, string Channel, LetterTemplateRef Template);

public sealed class CollectionStep
{
    public string Id { get; set; } = "";
    public string At { get; set; } = "";
    public string By { get; set; } = "";
    public string Text { get; set; } = "";
    public string Stage { get; set; } = "";
    public CollectionLetter? Letter { get; set; }
}

public sealed record PaymentArrangement(decimal Instalment, int Day, int Months, string StartedAt, int Missed);
public sealed record CaseDispute(string Reason, string At, string By);
public sealed record DemandApproval(string WorkItemId, string Status, string? DecidedBy = null, string? DecidedAt = null);

/// <summary>One per account in arrears: its stage, every step taken, the arrangement or dispute, and the trustees' approval of a letter of demand.</summary>
public sealed class CollectionCase
{
    public string AccountId { get; set; } = "";
    public int Version { get; set; }
    public string SchemeId { get; set; } = "";
    public string Stage { get; set; } = CollectionStages.NotStarted;
    /// <summary>The stage before an arrangement or dispute, to return to.</summary>
    public string? PreviousStage { get; set; }
    /// <summary>Newest first.</summary>
    public List<CollectionStep> Steps { get; set; } = [];
    public PaymentArrangement? Arrangement { get; set; }
    public CaseDispute? Dispute { get; set; }
    public DemandApproval? DemandApproval { get; set; }
    public string? FollowUpWorkItemId { get; set; }
}

/// <summary>What someone does to a case. Which fields matter depends on <see cref="Type"/>.</summary>
public sealed record CollectionAction(
    string Type, string? Kind = null, string? Channel = null, string? Attorney = null, decimal? Instalment = null, int? Day = null, int? Months = null,
    string? Reason = null, string? Outcome = null, string? Note = null, string? Text = null);

public sealed record NextAction(string Label, string DueAt, bool Overdue);

public static class CollectionStages
{
    public const string NotStarted = "not-started";
    public const string Reminder = "reminder";
    public const string FinalDemand = "final-demand";
    public const string LetterOfDemand = "letter-of-demand";
    public const string HandedOver = "handed-over";
    public const string Arrangement = "arrangement";
    public const string Disputed = "disputed";

    public static readonly IReadOnlyDictionary<string, string> Labels = new Dictionary<string, string>
    {
        [NotStarted] = "Not started", [Reminder] = "Reminder sent", [FinalDemand] = "Final demand sent", [LetterOfDemand] = "Letter of demand sent",
        [HandedOver] = "Handed over", [Arrangement] = "Payment arrangement", [Disputed] = "Disputed",
    };
}

/// <summary>
/// Credit control (docs/11 §2): arrears chased as a process. Letters go in order (reminder, final demand,
/// letter of demand) and only while something is overdue; a letter of demand needs the trustees first;
/// hand-over only after one. The same rules as the app's simulation (collections-store.ts).
/// </summary>
public static class CreditControlRules
{
    public static readonly IReadOnlyDictionary<string, string> LetterNames = new Dictionary<string, string>
    {
        [CollectionStages.Reminder] = "Reminder", [CollectionStages.FinalDemand] = "Final demand", [CollectionStages.LetterOfDemand] = "Letter of demand",
    };

    public static readonly string[] Channels = ["email", "post", "sms"];

    /// <summary>Which letter each stage allows next (a letter of demand also needs the trustees).</summary>
    private static readonly Dictionary<string, string> NextLetter = new() { [CollectionStages.NotStarted] = CollectionStages.Reminder, [CollectionStages.Reminder] = CollectionStages.FinalDemand };

    public static decimal Overdue(AccountAgeing a) => Ledger.Round2(a.D30 + a.D60 + a.D90 + a.D120);

    public static int DaysInArrears(AccountAgeing a) => a.D120 > 0 ? 120 : a.D90 > 0 ? 90 : a.D60 > 0 ? 60 : a.D30 > 0 ? 30 : 0;

    /// <summary>Field → message; empty when the action may go ahead.</summary>
    public static Dictionary<string, string> Check(CollectionCase c, AccountAgeing ageing, CollectionAction? action)
    {
        var e = new Dictionary<string, string>();
        void StageIs(string what, params string[] stages)
        {
            if (!stages.Contains(c.Stage)) e["stage"] = $"{what} isn’t the next step: the account is at “{CollectionStages.Labels[c.Stage]}”.";
        }
        var overdue = Overdue(ageing);
        switch (action?.Type)
        {
            case "send-letter":
                if (action.Kind is not { } kind || !LetterNames.ContainsKey(kind)) e["kind"] = "A reminder, final demand or letter of demand.";
                else if (overdue <= 0) e["stage"] = "Nothing is overdue on this account.";
                else if (kind == CollectionStages.LetterOfDemand)
                {
                    StageIs("A letter of demand", CollectionStages.FinalDemand);
                    if (c.DemandApproval?.Status != "approved") e["approval"] = "A letter of demand needs the trustees’ approval first.";
                }
                else if (NextLetter.GetValueOrDefault(c.Stage) != kind)
                    e["stage"] = $"A {LetterNames[kind].ToLowerInvariant()} isn’t the next step: the account is at “{CollectionStages.Labels[c.Stage]}”.";
                if (!Channels.Contains(action.Channel)) e["channel"] = "By email, SMS or post.";
                break;
            case "request-demand-approval":
                StageIs("Asking for a letter of demand", CollectionStages.FinalDemand);
                if (c.DemandApproval?.Status == "pending") e["approval"] = "The trustees already have it.";
                if (c.DemandApproval?.Status == "approved") e["approval"] = "Already approved: send the letter.";
                break;
            case "hand-over":
                StageIs("Handing over", CollectionStages.LetterOfDemand);
                if (string.IsNullOrWhiteSpace(action.Attorney)) e["attorney"] = "Which attorney?";
                break;
            case "arrangement":
                StageIs("An arrangement", CollectionStages.NotStarted, CollectionStages.Reminder, CollectionStages.FinalDemand, CollectionStages.LetterOfDemand, CollectionStages.Disputed);
                if (!(action.Instalment > 0)) e["instalment"] = "Enter the monthly instalment.";
                if (action.Day is not (>= 1 and <= 28)) e["day"] = "A day from 1 to 28.";
                if (action.Months is not (>= 1 and <= 24)) e["months"] = "Between 1 and 24 months.";
                if (!e.ContainsKey("instalment") && !e.ContainsKey("months") && action.Instalment!.Value * action.Months!.Value < overdue)
                    e["instalment"] = $"{BillingRules.Rand(action.Instalment.Value)} × {action.Months} months doesn’t clear the {BillingRules.Rand(overdue)} overdue (on top of the monthly levy).";
                break;
            case "missed-instalment":
                StageIs("Recording a missed instalment", CollectionStages.Arrangement);
                break;
            case "dispute":
                if ((action.Reason ?? "").Trim().Length < 10) e["reason"] = "Say what the owner disputes.";
                if (c.Stage == CollectionStages.Disputed) e["stage"] = "Already marked as disputed.";
                break;
            case "resolve-dispute":
                StageIs("Resolving a dispute", CollectionStages.Disputed);
                if (action.Outcome is not ("resume" or "written-off-in-part")) e["outcome"] = "Collection resumes, or part was written off by journal.";
                if ((action.Note ?? "").Trim().Length < 5) e["note"] = "Record how it was resolved.";
                break;
            case "note":
                if (string.IsNullOrWhiteSpace(action.Text)) e["text"] = "Write a note.";
                break;
            default:
                e["type"] = "That isn’t something credit control does.";
                break;
        }
        return e;
    }

    /// <summary>The next step and when it's due. <paramref name="stepDays"/>: days between letters (Settings › Billing configuration).</summary>
    public static NextAction? Next(CollectionCase c, int stepDays, DateTimeOffset now)
    {
        var last = c.Steps.FirstOrDefault() is { } s ? DateTimeOffset.Parse(s.At, System.Globalization.CultureInfo.InvariantCulture) : now;
        NextAction Due(string label, DateTimeOffset at) => new(label, at.ToString("O"), at < now);
        switch (c.Stage)
        {
            case CollectionStages.NotStarted:
                // In arrears since the last billing run: remind today.
                return Due("Send a reminder", new DateTimeOffset(now.ToOffset(Sa).Date.AddHours(23).AddMinutes(59), Sa));
            case CollectionStages.Reminder:
                return Due("Send a final demand", last.AddDays(stepDays));
            case CollectionStages.FinalDemand:
                return c.DemandApproval?.Status switch
                {
                    "pending" => Due("Waiting for the trustees to approve a letter of demand", last.AddDays(stepDays + 3)),
                    "approved" => Due("Send the letter of demand", (c.DemandApproval.DecidedAt is { } d ? DateTimeOffset.Parse(d, System.Globalization.CultureInfo.InvariantCulture) : last).AddDays(2)),
                    _ => Due("Ask the trustees to approve a letter of demand", last.AddDays(stepDays)),
                };
            case CollectionStages.LetterOfDemand:
                return Due("Hand the account to the attorney", last.AddDays(stepDays));
            case CollectionStages.HandedOver:
                return Due("Check progress with the attorney", last.AddDays(30));
            case CollectionStages.Arrangement:
            {
                var ar = c.Arrangement!;
                var today = now.ToOffset(Sa);
                var month = new DateTimeOffset(today.Year, today.Month, 1, 12, 0, 0, Sa).AddMonths(today.Day > ar.Day ? 1 : 0);
                return Due($"Check the {BillingRules.Rand(ar.Instalment)} instalment on the {Ordinal(ar.Day)}", month.AddDays(ar.Day - 1));
            }
            case CollectionStages.Disputed:
                return Due("Resolve the dispute", (c.Dispute is { } x ? DateTimeOffset.Parse(x.At, System.Globalization.CultureInfo.InvariantCulture) : last).AddDays(stepDays));
            default:
                return null;
        }
    }

    public static readonly TimeSpan Sa = TimeSpan.FromHours(2);

    /// <summary>1 → "1st", 22 → "22nd".</summary>
    public static string Ordinal(int n) => $"{n}{(n % 10 == 1 && n != 11 ? "st" : n % 10 == 2 && n != 12 ? "nd" : n % 10 == 3 && n != 13 ? "rd" : "th")}";

    public static void Log(CollectionCase c, string stage, string text, string by, string at, CollectionLetter? letter = null) =>
        c.Steps.Insert(0, new CollectionStep { Id = $"cs-{Guid.NewGuid():N}"[..15], At = at, By = by, Text = text, Stage = stage, Letter = letter });
}
