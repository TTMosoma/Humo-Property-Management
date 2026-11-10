using System.Text.Json;
using Humo.Api.Commands;
using Humo.Domain.Access;
using Humo.Infrastructure.Data;

namespace Humo.Api.Work;

/// <summary>
/// Which work items a role may see, within the schemes it can read. The API applies this, so hiding them on a
/// screen protects nothing by itself; the app's AttentionService applies the same rule for the simulation.
/// </summary>
public static class WorkItemAccess
{
    public const string RuleBreach = "rule-breach";

    /// <summary>Tasks that stand for real work on a record. Each closes itself when that step is taken, so ticking one off could only say the work was done when it wasn't.</summary>
    public static readonly string[] ClosedByTheirOwnStep = ["debtor-follow-up", "maintenance-triage", RuleBreach];

    private static readonly string[] FinanceTypes = ["receipt-allocation", "debtor-follow-up", "invoice-approval", "payment-batch-approval", "billing-run-approval", "account-correction"];
    private static readonly string[] OperationsTypes = ["maintenance-triage", "maintenance-overdue", "document-expiry"];
    private static readonly string[] NotForPortfolioManagers = ["receipt-allocation", "payment-batch-approval", "bank-details-verification", "billing-run-approval"];

    /// <param name="approverRoles">Who can decide it, when that's been worked out for this request (D24 adds the trustees).</param>
    public static bool CanSee(Actor actor, WorkItemRow w, IReadOnlyCollection<string>? approverRoles = null)
    {
        var role = actor.Assignment.Role;
        var mine = w.AssigneeId == actor.User.Id.ToString();
        var decides = w.Kind == "approval" && (approverRoles ?? JsonSerializer.Deserialize<List<string>>(w.ApproverRoles) ?? []).Contains(role);
        // D32: conduct records stay with those who enforce the rules, even if a task was assigned elsewhere.
        if (w.Type == RuleBreach && !actor.Can("Rules.Enforce")) return false;
        return role switch
        {
            Roles.AgencyAdmin => true,
            Roles.PortfolioManager => !NotForPortfolioManagers.Contains(w.Type),
            Roles.Finance => FinanceTypes.Contains(w.Type) || decides || mine,
            Roles.Operations => OperationsTypes.Contains(w.Type) || decides || mine,
            Roles.Trustee => decides || mine,
            _ => false,
        };
    }
}
