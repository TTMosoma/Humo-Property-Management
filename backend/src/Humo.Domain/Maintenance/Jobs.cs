using System.Text.Json.Serialization;
using Humo.Domain.Finance;

namespace Humo.Domain.Maintenance;

// The shapes match frontend/humo-web/src/app/domain/models/job.ts and supplier.ts (camelCase on the wire).

public sealed class JobPhoto
{
    public string Id { get; set; } = "";
    public string Caption { get; set; } = "";
    public string TakenAt { get; set; } = "";
    public string By { get; set; } = "";
    /// <summary>report or completion.</summary>
    public string Stage { get; set; } = "report";
}

public sealed class JobQuote
{
    public string Id { get; set; } = "";
    public string SupplierId { get; set; } = "";
    public decimal Amount { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? ReceivedAt { get; set; }
    /// <summary>requested, received or declined.</summary>
    public string Status { get; set; } = "requested";
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? ValidUntil { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Notes { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? GuaranteeMonths { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] public bool Recommended { get; set; }
}

public sealed class JobEvent
{
    public string Id { get; set; } = "";
    public string At { get; set; } = "";
    /// <summary>stage, comment, quote, approval, message, invoice, payment or photo.</summary>
    public string Kind { get; set; } = "";
    public string Text { get; set; } = "";
    public string By { get; set; } = "";
}

public sealed record ReportedBy(string Name, string Role, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PersonId = null);

public sealed class JobApproval
{
    /// <summary>pending, approved or rejected.</summary>
    public string Status { get; set; } = "pending";
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? WorkItemId { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? DecidedBy { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? DecidedAt { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Comment { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? WithinDelegation { get; set; }
}

public sealed record WorkOrder(string IssuedAt, string ScheduledFor, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AccessNotes = null);
public sealed record JobCompletion(string CompletedAt, string Notes);
public sealed record JobVerification(string At, string By, string Outcome, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Comment = null);

/// <summary>One record carries a maintenance problem from report to payment (review finding F16).</summary>
public sealed class Job
{
    public string Id { get; set; } = "";
    public int Version { get; set; } = 1;
    /// <summary>"MR-1042".</summary>
    public string Ref { get; set; } = "";
    public string SchemeId { get; set; } = "";
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? UnitId { get; set; }
    public string Location { get; set; } = "";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "Building";
    public string Priority { get; set; } = "normal";
    public string Stage { get; set; } = JobStages.Reported;
    public ReportedBy ReportedBy { get; set; } = new("", "staff");
    public string ReportedAt { get; set; } = "";
    public string? AssigneeId { get; set; }
    public List<JobPhoto> Photos { get; set; } = [];
    public List<JobQuote> Quotes { get; set; } = [];
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public JobApproval? Approval { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? SupplierId { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public WorkOrder? WorkOrder { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public JobCompletion? Completion { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public JobVerification? Verification { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? InvoiceId { get; set; }
    public string BudgetCategory { get; set; } = "";
    /// <summary>Newest first.</summary>
    public List<JobEvent> Events { get; set; } = [];
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? DueAt { get; set; }
}

/// <summary>Every change to a job is a named command. Which fields matter depends on <see cref="Type"/>.</summary>
public sealed record JobAction(
    string Type, string? AssigneeId = null, string? Priority = null, string? Category = null, List<string>? SupplierIds = null, string? QuoteId = null, decimal? Amount = null,
    int? GuaranteeMonths = null, string? Notes = null, string? ScheduledFor = null, string? AccessNotes = null, bool? OverrideVetting = null, string? Outcome = null,
    string? Comment = null, bool? OnBehalf = null, string? InvoiceNo = null, string? Text = null, string? Reason = null);

public static class JobStages
{
    public const string Reported = "reported", Quoting = "quoting", Approval = "approval", Approved = "approved", Scheduled = "scheduled", InProgress = "in-progress",
        Completed = "completed", Verified = "verified", Invoiced = "invoiced", Paid = "paid", Closed = "closed", Cancelled = "cancelled";

    public static readonly IReadOnlyDictionary<string, string> Labels = new Dictionary<string, string>
    {
        [Reported] = "Reported", [Quoting] = "Quotes", [Approval] = "Approval", [Approved] = "Work order", [Scheduled] = "Scheduled", [InProgress] = "In progress",
        [Completed] = "Completed", [Verified] = "Verified", [Invoiced] = "Invoice", [Paid] = "Paid", [Closed] = "Closed", [Cancelled] = "Cancelled",
    };

    /// <summary>Finished: nothing more happens to it.</summary>
    public static bool Done(string stage) => stage is Closed or Cancelled;
}

/// <summary>A supplier's vetting document. Missing documents have no file.</summary>
public sealed record SupplierDocument(string Type, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Expires, bool OnFile);

/// <summary>
/// The job rules (docs/02, review findings F16 and F18): the stages a job moves through, which action fits which stage,
/// the delegated authority for quotes, and the vetting a work order needs. The same rules as the app's simulation.
/// </summary>
public static class JobRules
{
    /// <summary>Agency staff approve quotes up to this; above it the trustees decide.</summary>
    public const decimal DelegatedLimit = 5_000;

    public static readonly string[] Trades =
        ["Plumbing", "Electrical", "Roofing & waterproofing", "Painting", "Security", "Gate automation", "Lifts", "Gardens", "Pools", "Pest control", "Building", "Fire equipment"];

    public static readonly string[] Priorities = ["urgent", "high", "normal", "low"];

    public static readonly string[] VettingDocuments =
        ["COIDA letter of good standing", "Public liability insurance", "Tax compliance (SARS PIN)", "B-BBEE certificate", "Bank confirmation letter"];

    /// <summary>Actions that need the advanced maintenance feature (quotes, approvals, work orders, verification, invoices).</summary>
    public static readonly string[] Advanced = ["request-quotes", "record-quote", "send-for-approval", "approve-within-delegation", "issue-work-order", "start-work", "verify", "capture-invoice"];

    /// <summary>valid, expiring (within 30 days), expired or missing.</summary>
    public static string DocStatus(SupplierDocument d, DateOnly today)
    {
        if (!d.OnFile) return "missing";
        if (d.Expires is null || !DateOnly.TryParse(d.Expires[..Math.Min(10, d.Expires.Length)], out var e)) return "valid";
        var days = e.DayNumber - today.DayNumber;
        return days < 0 ? "expired" : days < 30 ? "expiring" : "valid";
    }

    /// <summary>The worst of the documents that matter for site work (B-BBEE doesn't).</summary>
    public static string Compliance(IEnumerable<SupplierDocument> docs, DateOnly today)
    {
        var statuses = docs.Where(d => d.Type != "B-BBEE certificate").Select(d => DocStatus(d, today)).ToList();
        return new[] { "missing", "expired", "expiring", "valid" }.FirstOrDefault(statuses.Contains) ?? "valid";
    }

    /// <summary>
    /// Field → message; empty when the action may go ahead. <paramref name="supplierProblems"/>: for a work order, the chosen
    /// supplier's missing or expired documents (it then needs an explicit override), or why they can't take work (on hold).
    /// </summary>
    public static Dictionary<string, string> Check(Job job, JobAction a, Func<string, string?> supplierBlock, IReadOnlyList<string> supplierProblems, DateOnly today)
    {
        var e = new Dictionary<string, string>();
        void StageIs(string what, params string[] stages)
        {
            if (!stages.Contains(job.Stage)) e["stage"] = $"{what} isn’t possible now: the job is at “{JobStages.Labels[job.Stage]}”.";
        }
        if (JobStages.Done(job.Stage) && a.Type != "comment") return new() { ["stage"] = $"The job is {JobStages.Labels[job.Stage].ToLowerInvariant()}." };
        var quote = a.QuoteId is null ? null : job.Quotes.FirstOrDefault(q => q.Id == a.QuoteId);
        switch (a.Type)
        {
            case "triage":
                if (string.IsNullOrWhiteSpace(a.AssigneeId)) e["assigneeId"] = "Who looks after it?";
                if (!Priorities.Contains(a.Priority)) e["priority"] = "Choose a priority.";
                if (!Trades.Contains(a.Category)) e["category"] = "Choose a category.";
                break;
            case "request-quotes":
                StageIs("Asking for quotes", JobStages.Reported, JobStages.Quoting);
                if (a.SupplierIds is not { Count: > 0 }) e["supplierIds"] = "Choose who to ask.";
                else if (a.SupplierIds.Select(supplierBlock).FirstOrDefault(x => x is not null) is { } why) e["supplierIds"] = why;
                break;
            case "record-quote":
                StageIs("Recording a quote", JobStages.Quoting);
                if (quote is null) e["quoteId"] = "That quote request isn’t on this job.";
                if (!(a.Amount > 0)) e["amount"] = "Enter the quoted amount.";
                if (a.GuaranteeMonths is < 0 or > 120) e["guaranteeMonths"] = "Months of guarantee, 0 to 120.";
                break;
            case "send-for-approval":
            case "approve-within-delegation":
                StageIs(a.Type == "send-for-approval" ? "Sending for approval" : "Approving", JobStages.Quoting);
                if (quote is not { Status: "received" }) e["quoteId"] = "Choose a quote you’ve received.";
                else if (a.Type == "approve-within-delegation" && quote.Amount > DelegatedLimit)
                    e["quoteId"] = $"Above the delegated limit of {BillingRules.Rand(DelegatedLimit)}: send it for the trustees’ approval.";
                break;
            case "issue-work-order":
                StageIs("A work order", JobStages.Approved);
                if (!DateTimeOffset.TryParse(a.ScheduledFor, out var when)) e["scheduledFor"] = "When will they come?";
                else if (DateOnly.FromDateTime(when.UtcDateTime) < today.AddDays(-1)) e["scheduledFor"] = "That date has passed.";
                if (job.SupplierId is { } s && supplierBlock(s) is { } blocked) e["supplierId"] = blocked;
                else if (supplierProblems.Count > 0 && a.OverrideVetting != true)
                    e["overrideVetting"] = $"Their {string.Join(" and ", supplierProblems)}: confirm you’ll proceed anyway (it’s recorded on the job).";
                break;
            case "start-work":
                StageIs("Starting work", JobStages.Scheduled);
                break;
            case "complete":
                StageIs("Completing it", JobStages.Reported, JobStages.Approved, JobStages.Scheduled, JobStages.InProgress);
                if ((a.Notes ?? "").Trim().Length < 3) e["notes"] = "What was done?";
                break;
            case "verify":
                StageIs("Confirming it’s fixed", JobStages.Completed);
                if (a.Outcome is not ("fixed" or "not-fixed")) e["outcome"] = "Fixed, or not fixed.";
                break;
            case "capture-invoice":
                StageIs("Capturing the invoice", JobStages.Verified, JobStages.Completed);
                if (job.SupplierId is null) e["supplierId"] = "There’s no supplier on this job to invoice.";
                if (!(a.Amount > 0)) e["amount"] = "Enter the invoice amount.";
                if ((a.InvoiceNo ?? "").Trim().Length < 2) e["invoiceNo"] = "The supplier’s invoice number.";
                break;
            case "close":
                StageIs("Closing it", JobStages.Completed, JobStages.Verified, JobStages.Paid);
                if (job.Stage == JobStages.Completed && job.SupplierId is not null) e["stage"] = "Confirm it’s fixed and capture the supplier’s invoice first.";
                break;
            case "comment":
                if (string.IsNullOrWhiteSpace(a.Text)) e["text"] = "Write a comment.";
                break;
            case "cancel":
                if (job.Stage is JobStages.Invoiced or JobStages.Paid) e["stage"] = "There’s an invoice on it: it can’t be cancelled.";
                if ((a.Reason ?? "").Trim().Length < 3) e["reason"] = "Say why, for the audit log.";
                break;
            case "award-network-quote":
                e["type"] = "Humo Contractor quote requests aren’t on Humo’s API yet: ask your suppliers for quotes on the job.";
                break;
            default:
                e["type"] = "That isn’t something a job does.";
                break;
        }
        return e;
    }

    public static void Log(Job job, string kind, string text, string by, string at) =>
        job.Events.Insert(0, new JobEvent { Id = $"{job.Ref}-e{job.Events.Count + 1}-{Guid.NewGuid():N}"[..Math.Min(40, job.Ref.Length + 20)], At = at, Kind = kind, Text = text, By = by });
}
