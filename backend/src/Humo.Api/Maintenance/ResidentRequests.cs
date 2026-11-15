using System.Globalization;
using Humo.Domain.Maintenance;
using Humo.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace Humo.Api.Maintenance;

/// <summary>
/// A resident's own requests: what they're told as the job moves on, and what they may see of it.
///
/// They hear (in the bell) when it's being arranged, booked, done, sent back to the supplier, and cancelled or closed.
/// Booked, done and cancelled or closed also go by email, as their notification preferences allow: those are the ones that
/// ask something of them or end it. They see the request, its photos, the booking and a plain history, never the quotes,
/// prices, approvals, invoices, staff notes or the supplier's contact and bank details.
/// </summary>
public static class ResidentRequests
{
    public const string Link = "/my/requests";

    /// <summary>The job as its resident may see it.</summary>
    public static Job ForResident(Job job) => new()
    {
        Id = job.Id,
        Version = job.Version,
        Ref = job.Ref,
        SchemeId = job.SchemeId,
        UnitId = job.UnitId,
        Location = job.Location,
        Title = job.Title,
        Description = job.Description,
        Category = job.Category,
        Priority = job.Priority,
        Stage = job.Stage,
        ReportedBy = job.ReportedBy,
        ReportedAt = job.ReportedAt,
        // What was reported and what was done, not photos taken for the agency along the way.
        Photos = [.. job.Photos.Where(p => p.Stage is "report" or "completion")],
        SupplierId = job.SupplierId,
        WorkOrder = job.WorkOrder is { } w ? new WorkOrder(w.IssuedAt, w.ScheduledFor, w.AccessNotes) : null,
        Completion = job.Completion,
        Verification = job.Verification,
        Events = History(job),
    };

    /// <summary>The supplier as a resident may see them: their name and trade, nothing to contact or pay them with.</summary>
    public static SupplierDto? ForResident(SupplierDto? s) => s is null ? null : s with
    {
        PartyId = null, ContactName = "", Phone = "", Email = "", BankAccount = "", BankVerified = false, BbbeeLevel = null, SchemeIds = [], Documents = [],
        BankChange = null, BankVerifiedBy = null, BankVerifiedAt = null,
    };

    /// <summary>The cancellation reason staff gave, which the resident is shown.</summary>
    public static string? CancelReason(Job job) =>
        job.Events.FirstOrDefault(e => e.Kind == "stage" && e.Text.StartsWith("Cancelled: ", StringComparison.Ordinal))?.Text["Cancelled: ".Length..];

    /// <summary>A plain history of the request, newest first, from what was recorded (never the staff's own lines).</summary>
    public static List<JobEvent> History(Job job)
    {
        var lines = new List<JobEvent>();
        void Add(string? at, string text)
        {
            if (!string.IsNullOrEmpty(at)) lines.Add(new JobEvent { Id = $"{job.Ref}-h{lines.Count + 1}", At = at, Kind = "stage", Text = text, By = "" });
        }

        Add(job.ReportedAt, "Reported");
        var arranging = job.Events.Where(e => e.Kind is "quote" or "approval").MinBy(e => e.At);
        Add(arranging?.At, "The managing agent is arranging a supplier");
        if (job.WorkOrder is { } w) Add(w.IssuedAt, $"Booked for {Day(w.ScheduledFor)}");
        Add(job.Events.Where(e => e.Kind == "stage" && e.Text.StartsWith("Supplier on site", StringComparison.Ordinal)).MinBy(e => e.At)?.At, "The supplier is working on it");
        if (job.Completion is { } c) Add(c.CompletedAt, "The supplier says it’s done");
        if (job.Verification is { } v) Add(v.At, v.Outcome == "fixed" ? "Confirmed fixed" : "Reported as not fixed: the supplier is coming back");
        if (job.Stage == JobStages.Cancelled)
            Add(job.Events.Where(e => e.Kind == "stage" && e.Text.StartsWith("Cancelled: ", StringComparison.Ordinal)).MaxBy(e => e.At)?.At, $"Cancelled: {CancelReason(job)}");
        if (job.Stage == JobStages.Closed) Add(job.Events.Where(e => e.Kind == "stage" && e.Text == "Job closed").MaxBy(e => e.At)?.At, "Closed");
        // By time, not as text (the dates aren't all written with the same offset); at the same moment, the later step first.
        return [.. lines.Select((l, i) => (l, i))
            .OrderByDescending(x => DateTimeOffset.TryParse(x.l.At, CultureInfo.InvariantCulture, out var t) ? t : DateTimeOffset.MinValue).ThenByDescending(x => x.i)
            .Select(x => x.l)];
    }

    /// <summary>
    /// After a staff action on a job: the resident who reported it hears about the step it reached. The caller saves; the
    /// emails go after the save, with the other notices. Returns what they were told, or null when nobody was (no step for
    /// them, or they have no sign-in).
    /// </summary>
    public static async Task<string?> TellAsync(HumoDbContext db, Platform.Notices notices, Job job, string before, JobAction a, string supplier, Guid actorId, CancellationToken ct)
    {
        if (job.ReportedBy.Role == "staff" || !Guid.TryParse(job.ReportedBy.PersonId, out var personId)) return null;

        (string Title, string Detail, bool Email)? message = a.Type switch
        {
            // The first sign that someone is dealing with it.
            _ when before == JobStages.Reported && job.Stage is JobStages.Quoting or JobStages.Approval or JobStages.Approved =>
                ($"Your request {job.Ref} is being arranged", $"{job.Title}: the managing agent is arranging a supplier.", false),
            "issue-work-order" when job.WorkOrder is { } w =>
                ($"Booked: {job.Title}", $"{supplier} is booked for {Day(w.ScheduledFor)}.{(w.AccessNotes is { } n ? $" Access: {n}" : "")}", true),
            "complete" =>
                ($"Was it fixed? {job.Title}", $"{supplier} says the work on {job.Ref} is done. Let us know whether it’s fixed, in My requests.", true),
            "verify" when a.Outcome == "not-fixed" =>
                ($"Sent back to the supplier: {job.Title}", $"We’ve asked {supplier} to come back to {job.Ref}.", false),
            "cancel" =>
                ($"Cancelled: {job.Title}", $"{job.Ref} was cancelled: {a.Reason!.Trim()}. If it still needs fixing, report it again or send a message.", true),
            // Closed without the resident confirming it: they're told it's finished. Once they've confirmed, they know.
            "close" when job.Verification is null =>
                ($"Closed: {job.Title}", $"The managing agent closed {job.Ref}. If it still needs fixing, report it again or send a message.", true),
            _ => null,
        };
        if (message is not { } m) return null;

        var people = await db.Users.AsNoTracking()
            .Where(u => u.PersonId == personId.ToString() && u.Status == Humo.Domain.Access.IdentityStatuses.Active).Select(u => u.Id).ToListAsync(ct);
        foreach (var user in people)
        {
            var prefs = await db.PersonalPreferences.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == user, ct);
            var byEmail = m.Email && (prefs?.Work ?? "email,portal").Split(',').Contains("email");
            notices.ToPerson(user, actorId, m.Title, m.Detail, Link, sendEmail: byEmail, kind: "maintenance");
        }
        return people.Count == 0 ? null : $"“{m.Title}”";
    }

    /// <summary>"Thursday 20 November", in South African time.</summary>
    private static string Day(string iso) =>
        DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, out var d) ? d.ToOffset(TimeSpan.FromHours(2)).ToString("dddd d MMMM", CultureInfo.InvariantCulture) : iso;
}
