using Humo.Domain.Access;
using Microsoft.AspNetCore.Identity;

namespace Humo.Infrastructure.Data;

/// <summary>
/// A person known to Humo: exactly one per human, however many roles they hold.
/// ASP.NET Core Identity keeps the email, passkeys and security stamp; Humo adds
/// the name, kind and status. No passwords: sign-in is by passkey or a one-time link (D14).
/// </summary>
public sealed class HumoUser : IdentityUser<Guid>
{
    public string Name { get; set; } = "";
    public string Kind { get; set; } = IdentityKinds.Customer;
    public string Status { get; set; } = IdentityStatuses.Invited;
    /// <summary>While suspended: the status a restore returns to.</summary>
    public string? SuspendedFrom { get; set; }
    public string? Title { get; set; }
    /// <summary>For owners, tenants and trustees: their People record.</summary>
    public string? PersonId { get; set; }
    /// <summary>Optimistic concurrency, as the frontend's <c>version</c>.</summary>
    public int Version { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; }

    public List<Membership> Memberships { get; set; } = [];
    public List<RoleAssignment> Assignments { get; set; } = [];
}

public sealed class Organisation
{
    public Guid Id { get; set; }
    public int Version { get; set; } = 1;
    public string Kind { get; set; } = "managing-agency";
    public string Status { get; set; } = OrganisationStatuses.Onboarding;
    public string Name { get; set; } = "";
    public string ShortName { get; set; } = "";
    public string City { get; set; } = "";
    public string Province { get; set; } = "";
    /// <summary>The Humo Account Manager who looks after this customer (D11).</summary>
    public Guid? AccountManagerId { get; set; }
    /// <summary>The package chosen for the trial when the account was opened (the subscription itself arrives with the commercial slice).</summary>
    public string? TrialPackageId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    /// <summary>Approving this amount or more needs a fresh passkey (doc 03). The agency's administrators set it; R50 000 by default.</summary>
    public decimal ApprovalStepUpAmount { get; set; } = 50_000;
    /// <summary>Interest on arrears, percent per month, on what's 30 days and older (2% by default: common sectional-title practice, within the scheme's rules).</summary>
    public decimal InterestPercentPerMonth { get; set; } = 2;
}

/// <summary>A request to open a new customer account (doc 21). The organisation exists only once approved or activated.</summary>
public sealed class AccountRequest
{
    public Guid Id { get; set; }
    /// <summary>"AR-1004".</summary>
    public string Ref { get; set; } = "";
    public int Version { get; set; } = 1;
    public string Name { get; set; } = "";
    public string ShortName { get; set; } = "";
    public string City { get; set; } = "";
    public string Province { get; set; } = "";
    public string PackageId { get; set; } = "";
    public Guid AccountManagerId { get; set; }
    public string AccountManager { get; set; } = "";
    public string? Notes { get; set; }
    /// <summary>pending, approved or rejected.</summary>
    public string Status { get; set; } = "pending";
    /// <summary>approval or delegated: decided by the server from the submitter's grants and the policy.</summary>
    public string Route { get; set; } = "approval";
    /// <summary>The policy in force when it was submitted.</summary>
    public string Policy { get; set; } = "";
    public Guid RequestedById { get; set; }
    public string RequestedBy { get; set; } = "";
    public DateTimeOffset RequestedAt { get; set; }
    public Guid? DecidedById { get; set; }
    public string? DecidedBy { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? Reason { get; set; }
    public Guid? OrganisationId { get; set; }
}

/// <summary>A platform setting with its history kept in the audit log (e.g. the account-creation policy).</summary>
public sealed class PlatformSetting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public int Version { get; set; } = 1;
    public string? UpdatedBy { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

/// <summary>An in-app notification (the bell): to one person, or to everyone holding a role. The actor never gets their own.</summary>
public sealed class Notice
{
    public Guid Id { get; set; }
    public string Kind { get; set; } = "platform";
    public string Title { get; set; } = "";
    public string Detail { get; set; } = "";
    public string Link { get; set; } = "";
    public Guid? ToIdentityId { get; set; }
    public string? ToRole { get; set; }
    public Guid? OrganisationId { get; set; }
    public Guid? ActorId { get; set; }
    public DateTimeOffset At { get; set; }
}

/// <summary>A request to make someone a System Administrator, waiting for a second System Administrator (doc 16).</summary>
public sealed class PendingHumoGrant
{
    public Guid Id { get; set; }
    public Guid IdentityId { get; set; }
    public string IdentityName { get; set; } = "";
    public string Role { get; set; } = "";
    public string Label { get; set; } = "";
    public string Reason { get; set; } = "";
    public Guid RequestedById { get; set; }
    public string RequestedBy { get; set; } = "";
    public DateTimeOffset RequestedAt { get; set; }
}

/// <summary>Who has read which notice.</summary>
public sealed class NoticeRead
{
    public Guid NoticeId { get; set; }
    public Guid IdentityId { get; set; }
    public DateTimeOffset At { get; set; }
}

/// <summary>A sectional-title scheme, HOA or share block that an organisation manages (doc 24 §4).</summary>
public sealed class Scheme
{
    public Guid Id { get; set; }
    public int Version { get; set; } = 1;
    public Guid OrganisationId { get; set; }
    public string Name { get; set; } = "";
    /// <summary>2–4 capital letters; starts every account number (KC → KC-042). Unique in the organisation.</summary>
    public string Code { get; set; } = "";
    public string Type { get; set; } = "Sectional Title";
    public string Status { get; set; } = "onboarding";
    public string Suburb { get; set; } = "";
    public string City { get; set; } = "";
    public string Province { get; set; } = "";
    /// <summary>The fewest trustees the board should have (the scheme's rules; 3 by default).</summary>
    public int TrusteeMinimum { get; set; } = 3;
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>A section (sectional title), erf (HOA) or share block in a scheme (doc 24 §5).</summary>
public sealed class Unit
{
    public Guid Id { get; set; }
    public int Version { get; set; } = 1;
    public Guid SchemeId { get; set; }
    /// <summary>As people say it: "42", "12B". Part of the account number, so it never changes.</summary>
    public string Number { get; set; } = "";
    /// <summary>The levy account number and payment reference, e.g. KC-042.</summary>
    public string AccountNo { get; set; } = "";
    public string? Block { get; set; }
    public int? Floor { get; set; }
    public string Description { get; set; } = "";
    public decimal SizeM2 { get; set; }
    /// <summary>Participation quota (%), which determines the share of levies.</summary>
    public decimal ParticipationQuota { get; set; }
    public decimal MonthlyLevy { get; set; }
    public string Occupancy { get; set; } = "owner-occupied";
    public List<string> ParkingBays { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>
/// Each unit's levy account. Opened with the unit; the current owner holds it. Balances,
/// charges and payments arrive with the billing slice; until then a new account owes nothing.
/// </summary>
public sealed class LevyAccount
{
    public Guid Id { get; set; }
    public Guid UnitId { get; set; }
    public Guid SchemeId { get; set; }
    public string AccountNo { get; set; } = "";
    public Guid? HolderPersonId { get; set; }
    /// <summary>From the ledger: kept in step on every ledger write (and refreshed daily, as charges age).</summary>
    public decimal Balance { get; set; }
    public decimal AgeingCurrent { get; set; }
    public decimal AgeingD30 { get; set; }
    public decimal AgeingD60 { get; set; }
    public decimal AgeingD90 { get; set; }
    public decimal AgeingD120 { get; set; }
    public string Status { get; set; } = "up-to-date";
    public bool DebitOrder { get; set; }
    public string StatementBy { get; set; } = "email";
}

/// <summary>A person in an organisation's directory. Owner, tenant and trustee are relationships, not kinds of person (D1).</summary>
public sealed class Person
{
    public Guid Id { get; set; }
    public int Version { get; set; } = 1;
    public Guid OrganisationId { get; set; }
    public string FirstName { get; set; } = "";
    public string LastName { get; set; } = "";
    /// <summary>individual, company or trust.</summary>
    public string Kind { get; set; } = "individual";
    public string DisplayName { get; set; } = "";
    public string Initials { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    public string PreferredChannel { get; set; } = "email";
    public string? PostalAddress { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Owner or tenant of a unit, or trustee of a scheme. Ended on a date; the history stays.</summary>
public sealed class Relationship
{
    public Guid Id { get; set; }
    public Guid PersonId { get; set; }
    /// <summary>owner, tenant or trustee.</summary>
    public string Type { get; set; } = "owner";
    public Guid SchemeId { get; set; }
    public Guid? UnitId { get; set; }
    /// <summary>Trustees: Chairperson, Treasurer, Trustee.</summary>
    public string? Portfolio { get; set; }
    public DateOnly Since { get; set; }
    /// <summary>Tenants: lease end. Trustees: the day they left the board.</summary>
    public DateOnly? Until { get; set; }
    /// <summary>Trustees: elected, co-opted or before-humo.</summary>
    public string? AppointmentHow { get; set; }
    public string? ResolutionRef { get; set; }
    public string? EndReason { get; set; }
}

/// <summary>Belonging to an organisation, with a status. Ended, never deleted.</summary>
public sealed class Membership
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid OrganisationId { get; set; }
    public string Status { get; set; } = MembershipStatuses.Active;
    public DateTimeOffset Since { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
}

/// <summary>A role, and where it applies. Ended, never deleted.</summary>
public sealed class RoleAssignment
{
    public Guid Id { get; set; }
    public int Version { get; set; } = 1;
    public Guid UserId { get; set; }
    public string Role { get; set; } = "";
    public string ScopeType { get; set; } = ScopeTypes.Organisation;
    /// <summary>Null for the platform scope.</summary>
    public Guid? OrganisationId { get; set; }
    public List<string> SchemeIds { get; set; } = [];
    public string? UnitId { get; set; }
    public string Label { get; set; } = "";
    /// <summary>Individually granted permissions on top of the role's (e.g. System.Impersonate).</summary>
    public List<string> Grants { get; set; } = [];
    public string Status { get; set; } = AssignmentStatuses.Active;
    public string? GrantedBy { get; set; }
    public DateTimeOffset? GrantedAt { get; set; }
    public DateTimeOffset? ValidUntil { get; set; }
    public string? EndedBy { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
}

/// <summary>
/// One audit record: every success and refusal (doc 24 C9). Append-only: the
/// application never updates or deletes these rows.
/// </summary>
public sealed class AuditEntry
{
    public long Id { get; set; }
    public DateTimeOffset At { get; set; }
    public string Category { get; set; } = "activity";
    public Guid? ActorId { get; set; }
    public string ActorName { get; set; } = "";
    /// <summary>The impersonated identity, when there is one.</summary>
    public Guid? ActingAsId { get; set; }
    public string? ActingAsName { get; set; }
    /// <summary>Set while impersonating: observe or act, the reason code and any note or ticket.</summary>
    public string? ImpersonationMode { get; set; }
    public string? ImpersonationReason { get; set; }
    public string? ImpersonationNote { get; set; }
    public Guid? SchemeId { get; set; }
    public string? Role { get; set; }
    public Guid? OrganisationId { get; set; }
    public string Action { get; set; } = "";
    public string? Resource { get; set; }
    public string? ResourceId { get; set; }
    public string Result { get; set; } = "success";
    public string? Reason { get; set; }
    public string? StepUpMethod { get; set; }
    public string? Ip { get; set; }
    public string? UserAgent { get; set; }
}

/// <summary>
/// Humo staff viewing the app as a customer (doc 24 §8): only with the individual System.Impersonate
/// grant, only of a customer identity, Observe (read-only) or Act (fresh step-up). Ended, never deleted.
/// </summary>
public sealed class ImpersonationSession
{
    public Guid Id { get; set; }
    public Guid ActorId { get; set; }
    public Guid TargetId { get; set; }
    public Guid TargetAssignmentId { get; set; }
    /// <summary>observe or act.</summary>
    public string Mode { get; set; } = "observe";
    /// <summary>support, bug, security, data-correction or other.</summary>
    public string Reason { get; set; } = "support";
    public string? Note { get; set; }
    public string? Ticket { get; set; }
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? EndedAt { get; set; }
}

/// <summary>A one-time sign-in link: only a hash of the token is stored. Used once, then dead.</summary>
/// <summary>
/// A secure link to one issued document for one person (docs/18 R-1): it opens with a one-time code sent to them,
/// with no Humo PM account. Only hashes of the link, the code and the viewing grant are stored.
/// </summary>
public sealed class DocumentLink
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Guid SchemeId { get; set; }
    /// <summary>"statement".</summary>
    public string Kind { get; set; } = "statement";
    public Guid DocumentId { get; set; }
    public Guid PersonId { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string? CodeHash { get; set; }
    public DateTimeOffset? CodeExpiresAt { get; set; }
    public int CodeAttempts { get; set; }
    public DateTimeOffset? CodeSentAt { get; set; }
    /// <summary>Codes sent on <see cref="CodesDay"/> (South African date), to cap them per day.</summary>
    public int CodesToday { get; set; }
    public string? CodesDay { get; set; }
    public string? GrantHash { get; set; }
    public DateTimeOffset? GrantExpiresAt { get; set; }
    public DateTimeOffset? FirstOpenedAt { get; set; }
    public DateTimeOffset? LastOpenedAt { get; set; }
    public int Opens { get; set; }
}

public sealed class SignInLink
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string TokenHash { get; set; } = "";
    /// <summary>The six-digit code shown on the screen that asked for the link (hashed with the link's id). The link only works with it.</summary>
    public string CodeHash { get; set; } = "";
    public int CodeAttempts { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
}

/// <summary>
/// A signed-in session, kept on the server so it can end early (sign-out, a revoked session, a paused person) and so
/// the idle and absolute limits are enforced here, not left to the cookie (docs/17, the session policy).
/// </summary>
public sealed class UserSession
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    /// <summary>"passkey" or "link": how the person signed in.</summary>
    public string Method { get; set; } = "";
    /// <summary>Signed in with a passkey on a browser the person marked as their own. Trusted browsers stay signed in across restarts.</summary>
    public bool Trusted { get; set; }
    public string Device { get; set; } = "";
    public string Ip { get; set; } = "";
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset LastActiveAt { get; set; }
    /// <summary>Set by the sign-in method and the active role (admin roles are shorter).</summary>
    public int IdleMinutes { get; set; }
    public DateTimeOffset AbsoluteExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}

/// <summary>
/// A browser the person has answered the "is this your own computer?" question for. Its cookie holds a random token;
/// only the token's hash is kept. Trusted means "my own"; false means "shared". Either answer is asked once.
/// </summary>
public sealed class TrustedBrowser
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string TokenHash { get; set; } = "";
    public bool Trusted { get; set; }
    public string Label { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
}

/// <summary>
/// A customer's subscription (docs/04, docs/23): its commercial status, trials and feature overrides.
/// Which package and add-ons are in force comes from the agreement's dated lines, and the contract
/// value from its recurring charges.
/// </summary>
public sealed class Subscription
{
    public Guid OrganisationId { get; set; }
    public int Version { get; set; } = 1;
    /// <summary>trial, active, past-due, suspended or cancelled.</summary>
    public string Status { get; set; } = "trial";
    public DateTimeOffset StartedAt { get; set; }
    public int Seats { get; set; } = 5;
    /// <summary>Trials and goodwill grants: JSON, as the frontend's <c>FeatureOverride[]</c>.</summary>
    public string Overrides { get; set; } = "[]";
}

/// <summary>What the customer agreed to pay (docs/23 §2): one JSON document, as the frontend's <c>CommercialAgreement</c>.</summary>
public sealed class Agreement
{
    public Guid OrganisationId { get; set; }
    public int Version { get; set; } = 1;
    public string Document { get; set; } = "{}";
}

/// <summary>A customer asking Humo about an add-on or package (Plan &amp; features, or a nudge).</summary>
public sealed class UpgradeRequest
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public string? AddOn { get; set; }
    public string? Package { get; set; }
    public string? Feature { get; set; }
    public string? Note { get; set; }
    /// <summary>nudge or plan-page.</summary>
    public string Source { get; set; } = "plan-page";
    public string RequestedBy { get; set; } = "";
    public Guid RequestedById { get; set; }
    public DateTimeOffset At { get; set; }
    /// <summary>new, in-progress, done or declined.</summary>
    public string Status { get; set; } = "new";
}

/// <summary>
/// Humo's invoice to a customer (docs/23 §6): a snapshot of the lines and prices that applied,
/// never recalculated. Paid only when verified payments cover it; overdue is worked out from the due date.
/// </summary>
public sealed class Invoice
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    /// <summary>Unique, and the reference the customer pays with: HPM-{customer}-{yyyymm}.</summary>
    public string Reference { get; set; } = "";
    public string PeriodStart { get; set; } = "";
    public string IssuedOn { get; set; } = "";
    public string DueOn { get; set; } = "";
    public decimal Total { get; set; }
    /// <summary>issued, paid or void.</summary>
    public string Status { get; set; } = "issued";
    /// <summary>The invoice as issued: JSON, as the frontend's <c>HumoInvoice</c>.</summary>
    public string Document { get; set; } = "{}";
    public DateTimeOffset IssuedAt { get; set; }
    public string IssuedBy { get; set; } = "";
    /// <summary>Overdue reminders sent (1, 7 and 14 days after the due date), and the last one's date.</summary>
    public int RemindersSent { get; set; }
    public string? LastReminderOn { get; set; }
}

/// <summary>A payment against an invoice. Separate from the billing preference: this says what happened with one payment.</summary>
public sealed class Payment
{
    public Guid Id { get; set; }
    public Guid InvoiceId { get; set; }
    public Guid OrganisationId { get; set; }
    public string Method { get; set; } = "manual-eft";
    /// <summary>initiated, pending-verification, verified, failed or cancelled.</summary>
    public string Status { get; set; } = "pending-verification";
    public decimal Amount { get; set; }
    public string Provider { get; set; } = "Manual EFT";
    /// <summary>The provider's reference, or the bank statement line that verified a manual EFT.</summary>
    public string? ProviderReference { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? VerifiedAt { get; set; }
    public string? VerifiedBy { get; set; }
    /// <summary>provider-notification or bank-reconciliation.</summary>
    public string? Verification { get; set; }
    public string? Note { get; set; }
}

/// <summary>
/// One line on a levy account (docs/11 §3): charges positive, payments and credits negative. Never edited or
/// deleted: a correction is another line (a journal adjustment, or reversing an allocation removes its payment line).
/// </summary>
public sealed class LedgerEntry
{
    public Guid Id { get; set; }
    public Guid AccountId { get; set; }
    public DateOnly Date { get; set; }
    /// <summary>levy, special-levy, utility, interest, payment, adjustment or opening.</summary>
    public string Type { get; set; } = "";
    public string Description { get; set; } = "";
    public string? Reference { get; set; }
    public decimal Amount { get; set; }
    /// <summary>Payments: the receipt they came from.</summary>
    public Guid? ReceiptId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string CreatedBy { get; set; } = "";
}

/// <summary>Money that reached a scheme's trust account (docs/22 §1): captured, imported from a bank statement, or from a bank feed later.</summary>
public sealed class Receipt
{
    public Guid Id { get; set; }
    public int Version { get; set; } = 1;
    public Guid SchemeId { get; set; }
    public string BankAccount { get; set; } = "";
    public DateOnly Date { get; set; }
    public decimal Amount { get; set; }
    /// <summary>Exactly as it appears on the bank statement.</summary>
    public string Reference { get; set; } = "";
    public string Payer { get; set; } = "";
    /// <summary>unallocated, allocated or suspense.</summary>
    public string Status { get; set; } = "unallocated";
    public string? AllocatedBy { get; set; }
    public bool AutoMatched { get; set; }
    /// <summary>captured, statement-import or bank-feed.</summary>
    public string Source { get; set; } = "captured";
    public Guid? ImportBatchId { get; set; }
    public string CapturedBy { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public List<ReceiptAllocation> Allocations { get; set; } = [];
}

public sealed class ReceiptAllocation
{
    public Guid ReceiptId { get; set; }
    public Guid AccountId { get; set; }
    public decimal Amount { get; set; }
}

/// <summary>"Remember this payer": a reference or payer name that means this account.</summary>
public sealed class PayerRule
{
    public Guid Id { get; set; }
    public Guid SchemeId { get; set; }
    public string Pattern { get; set; } = "";
    public Guid AccountId { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>A scheme's bank-statement column mapping, remembered after an import (JSON, as the frontend's <c>StatementMapping</c>).</summary>
public sealed class StatementMappingSetting
{
    public Guid SchemeId { get; set; }
    public string Mapping { get; set; } = "{}";
}

/// <summary>A finished bank-statement import, kept for the record.</summary>
public sealed class StatementImport
{
    public Guid Id { get; set; }
    public Guid SchemeId { get; set; }
    public string BankAccount { get; set; } = "";
    public string FileName { get; set; } = "";
    public DateTimeOffset At { get; set; }
    public string By { get; set; } = "";
    public int Imported { get; set; }
    public int Duplicates { get; set; }
    public int Debits { get; set; }
    public int Invalid { get; set; }
    public decimal Total { get; set; }
}

/// <summary>A billing run (docs/11 §1): key columns for queries; the run itself as JSON, as the frontend's <c>BillingRun</c>.</summary>
public sealed class BillingRunRow
{
    public Guid Id { get; set; }
    public int Version { get; set; } = 1;
    /// <summary>"BR-KC-2611": unique, so a period is never run twice.</summary>
    public string Ref { get; set; } = "";
    public Guid SchemeId { get; set; }
    public string Period { get; set; } = "";
    public string Stage { get; set; } = "preview";
    public string Document { get; set; } = "{}";
}

/// <summary>
/// The Attention model on the API: an approval or task, in an organisation and usually a scheme. Approvals name
/// the roles that decide them; the record the work is about moves on when it's decided.
/// </summary>
public sealed class WorkItemRow
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Guid? SchemeId { get; set; }
    public string Ref { get; set; } = "";
    /// <summary>task, approval or message.</summary>
    public string Kind { get; set; } = "task";
    public string Type { get; set; } = "";
    public string Title { get; set; } = "";
    public string Detail { get; set; } = "";
    public decimal? Amount { get; set; }
    public int? Count { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset DueAt { get; set; }
    public string? AssigneeId { get; set; }
    /// <summary>JSON list of roles.</summary>
    public string ApproverRoles { get; set; } = "[]";
    /// <summary>JSON list of evidence lines.</summary>
    public string Evidence { get; set; } = "[]";
    /// <summary>open, done, approved or rejected.</summary>
    public string Status { get; set; } = "open";
    public string? DecidedBy { get; set; }
    public Guid? DecidedById { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? Comment { get; set; }
    public string Route { get; set; } = "";
    /// <summary>The record it's about, e.g. the billing run's id.</summary>
    public Guid? SourceId { get; set; }
}

/// <summary>A scheme that recovers water from owners, at one flat rate per kilolitre (docs/22 §2). No row: it doesn't.</summary>
public sealed class WaterSetting
{
    public Guid SchemeId { get; set; }
    public decimal RatePerKl { get; set; }
    public int Version { get; set; } = 1;
    public string? UpdatedBy { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

/// <summary>A water meter's running total (kl) for a billing month.</summary>
public sealed class MeterReading
{
    public Guid Id { get; set; }
    public Guid UnitId { get; set; }
    public Guid SchemeId { get; set; }
    public string Period { get; set; } = "";
    public decimal Reading { get; set; }
    public DateOnly ReadOn { get; set; }
    public string CapturedBy { get; set; } = "";
    public DateTimeOffset CapturedAt { get; set; }
}

/// <summary>How a scheme's levies are set (D13): manual (entered per unit) or budget (derived from the approved budget). No row: manual.</summary>
public sealed class LevySetting
{
    public Guid SchemeId { get; set; }
    public string Method { get; set; } = "manual";
    public int Version { get; set; } = 1;
    public string? UpdatedBy { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

/// <summary>An agency's own settings (Settings › Agency, Billing configuration, Notifications). No row: the defaults.</summary>
public sealed class AgencySetting
{
    public Guid OrganisationId { get; set; }
    public int Version { get; set; } = 1;
    public string RegistrationNumber { get; set; } = "";
    public string? VatNumber { get; set; }
    /// <summary>PPRA Fidelity Fund certificate number.</summary>
    public string? FfcNumber { get; set; }
    public string Address { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
    /// <summary>Day of the month the next month's runs are prepared (1–28).</summary>
    public int BillingDay { get; set; } = 25;
    /// <summary>Day of the month levies are due (1–28): the due date on statements.</summary>
    public int DueDay { get; set; } = 7;
    public int StepDays { get; set; } = 14;
    public int AgmMonths { get; set; } = 4;
    /// <summary>The agency's notification rules as JSON; null: Humo's defaults.</summary>
    public string? NotificationsJson { get; set; }
    public string? UpdatedBy { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

/// <summary>An organisation's document settings: default template per type, contact details, footer and branding (D9, D12).</summary>
public sealed class DocumentSetting
{
    public Guid OrganisationId { get; set; }
    public int Version { get; set; } = 1;
    /// <summary>Document type → template id, as JSON.</summary>
    public string DefaultsJson { get; set; } = "{}";
    public string ContactEmail { get; set; } = "";
    public string ContactPhone { get; set; } = "";
    public string? FooterText { get; set; }
    /// <summary>AgencyBranding as JSON; null: none set.</summary>
    public string? BrandingJson { get; set; }
    /// <summary>D9: <c>link</c> (a secure link to the resident portal, the default) or <c>attachment</c> (the PDF attached).</summary>
    public string StatementDelivery { get; set; } = "link";
}

/// <summary>A scheme's trust bank account, as statements and letters show it. Changing it needs a fresh passkey.</summary>
public sealed class TrustAccountRow
{
    public Guid SchemeId { get; set; }
    public int Version { get; set; } = 1;
    public string Bank { get; set; } = "";
    public string AccountName { get; set; } = "";
    public string AccountNumber { get; set; } = "";
    public string BranchCode { get; set; } = "";
    /// <summary>The bank's confirmation is on file.</summary>
    public bool Verified { get; set; }
    public string? UpdatedBy { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

/// <summary>
/// An issued levy statement (D7): the data snapshot it was drawn from, its SHA-256, and the PDF.
/// Never changed after issue: a correction is a journal on the account and shows on the next statement.
/// </summary>
public sealed class IssuedStatement
{
    public Guid Id { get; set; }
    public Guid AccountId { get; set; }
    public Guid SchemeId { get; set; }
    public Guid OrganisationId { get; set; }
    /// <summary>"2026-10".</summary>
    public string Period { get; set; } = "";
    public string TemplateId { get; set; } = "";
    public int TemplateVersion { get; set; }
    /// <summary>Everything the document shows, as JSON: the statement view, design, branding, contact details and agency name.</summary>
    public string Snapshot { get; set; } = "";
    /// <summary>SHA-256 of the snapshot, hex.</summary>
    public string SnapshotSha256 { get; set; } = "";
    /// <summary>The rendered PDF; null until rendered (straight after issue, or on first download if that failed).</summary>
    public byte[]? Pdf { get; set; }
    public string? PdfSha256 { get; set; }
    public DateTimeOffset IssuedAt { get; set; }
    public string IssuedBy { get; set; } = "";
    /// <summary>The billing run that issued it, if any.</summary>
    public Guid? BillingRunId { get; set; }
    /// <summary>How it went out last: email, portal or post.</summary>
    public string? SentBy { get; set; }
    public DateTimeOffset? SentAt { get; set; }
}

/// <summary>A person's own notification preferences (Settings › My profile). No row: the defaults.</summary>
public sealed class PersonalPreference
{
    public Guid UserId { get; set; }
    public int Version { get; set; } = 1;
    /// <summary>Channels, comma-separated.</summary>
    public string Work { get; set; } = "email,portal";
    /// <summary>none, daily or weekly.</summary>
    public string Digest { get; set; } = "daily";
    public string? QuietFrom { get; set; }
    public string? QuietTo { get; set; }
}

/// <summary>An account's collection case (docs/11 §2): stage and version as columns, the case itself as JSON (Humo.Domain.Finance.CollectionCase).</summary>
public sealed class CollectionCaseRow
{
    public Guid AccountId { get; set; }
    public Guid OrganisationId { get; set; }
    public Guid SchemeId { get; set; }
    public string Stage { get; set; } = "not-started";
    public int Version { get; set; }
    public string Json { get; set; } = "{}";
}

/// <summary>A reminder, final demand or letter of demand as sent (D7, like statements): the snapshot it's drawn from, its hash and the PDF.</summary>
public sealed class IssuedLetter
{
    public Guid Id { get; set; }
    public Guid AccountId { get; set; }
    public Guid SchemeId { get; set; }
    public Guid OrganisationId { get; set; }
    /// <summary>The case step it was sent at.</summary>
    public string StepId { get; set; } = "";
    /// <summary>reminder, final-demand or letter-of-demand.</summary>
    public string Kind { get; set; } = "";
    /// <summary>email, sms or post.</summary>
    public string Channel { get; set; } = "";
    public string TemplateId { get; set; } = "";
    public int TemplateVersion { get; set; }
    public string Snapshot { get; set; } = "";
    public string SnapshotSha256 { get; set; } = "";
    public byte[]? Pdf { get; set; }
    public string? PdfSha256 { get; set; }
    public DateTimeOffset IssuedAt { get; set; }
    public string IssuedBy { get; set; } = "";
    /// <summary>When the email or SMS went out; null for post (the agency prints and posts it) or until delivered.</summary>
    public DateTimeOffset? DeliveredAt { get; set; }
}

/// <summary>
/// One record in Communications › Sent (docs/18 R-5): everything Humo PM sent for an organisation (statements,
/// collection letters, reminders; composed messages and notices when they reach the API), with a delivery per person.
/// </summary>
public sealed class SentMessageRow
{
    public Guid Id { get; set; }
    public int Version { get; set; } = 1;
    /// <summary>"MSG-2041": unique within the organisation.</summary>
    public string Ref { get; set; } = "";
    public Guid OrganisationId { get; set; }
    public Guid SchemeId { get; set; }
    /// <summary>message, notice, letter, statement, reminder or reply.</summary>
    public string Kind { get; set; } = "";
    public string Subject { get; set; } = "";
    /// <summary>The text with merge fields; each delivery keeps its own values.</summary>
    public string Body { get; set; } = "";
    /// <summary>JSON list of channels.</summary>
    public string Channels { get; set; } = "[]";
    public string AudienceLabel { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public string SentBy { get; set; } = "";
    public DateTimeOffset SendAt { get; set; }
    public string? SourceLabel { get; set; }
    public string? SourceRoute { get; set; }
    /// <summary>JSON list of people the send couldn't reach, with the reason.</summary>
    public string Skipped { get; set; } = "[]";
    /// <summary>The message template it was written from, if any.</summary>
    public Guid? TemplateId { get; set; }
    /// <summary>A scheduled send that was cancelled before it went out.</summary>
    public DateTimeOffset? CancelledAt { get; set; }
    public string? CancelledBy { get; set; }
}

/// <summary>An agency's message template (Communications › Templates): Humo's starter templates, editable, and the agency's own.</summary>
public sealed class MessageTemplateRow
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public int Version { get; set; } = 1;
    /// <summary>For Humo's starter templates: which one ("reminder", "statement", …).</summary>
    public string? BuiltInKey { get; set; }
    public string Name { get; set; } = "";
    /// <summary>levies, collections, maintenance, meetings or general.</summary>
    public string Category { get; set; } = "general";
    public string Subject { get; set; } = "";
    public string Body { get; set; } = "";
    /// <summary>JSON list of the channels it's written for.</summary>
    public string Channels { get; set; } = "[]";
    public DateTimeOffset UpdatedAt { get; set; }
    public string UpdatedBy { get; set; } = "";
    public bool Archived { get; set; }
}

/// <summary>A notice to a scheme's people ("Water off on Thursday"): in the resident portal, and sent by the agency's notification rule for new notices.</summary>
public sealed class NoticeRow
{
    public Guid Id { get; set; }
    public int Version { get; set; } = 1;
    /// <summary>"NTC-KC-12".</summary>
    public string Ref { get; set; } = "";
    public Guid OrganisationId { get; set; }
    public Guid SchemeId { get; set; }
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    /// <summary>residents, owners or trustees.</summary>
    public string Audience { get; set; } = "residents";
    public string Category { get; set; } = "general";
    public DateTimeOffset PublishedAt { get; set; }
    public string PublishedBy { get; set; } = "";
    public bool Pinned { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
    /// <summary>JSON list of the channels it went out by.</summary>
    public string SentBy { get; set; } = "[]";
    public int Recipients { get; set; }
    public DateTimeOffset? WithdrawnAt { get; set; }
    public string? WithdrawnBy { get; set; }
    public string? WithdrawnReason { get; set; }
    /// <summary>Its record in Sent, so opening it in the portal can mark the person's delivery as read.</summary>
    public Guid? SentMessageId { get; set; }
}

/// <summary>An Inbox conversation with an owner, tenant or trustee: the messages as JSON, newest last.</summary>
public sealed class ConversationRow
{
    public Guid Id { get; set; }
    public int Version { get; set; } = 1;
    /// <summary>"CV-1001", per organisation.</summary>
    public string Ref { get; set; } = "";
    public Guid OrganisationId { get; set; }
    public Guid SchemeId { get; set; }
    public Guid PersonId { get; set; }
    public Guid? UnitId { get; set; }
    public string Subject { get; set; } = "";
    /// <summary>open (needs a reply), waiting (for them) or closed.</summary>
    public string Status { get; set; } = "open";
    public string? AssigneeId { get; set; }
    /// <summary>The open My work item while it needs a reply.</summary>
    public Guid? WorkItemId { get; set; }
    public string Messages { get; set; } = "[]";
    /// <summary>Tasks (and later jobs) it was turned into, as JSON.</summary>
    public string Links { get; set; } = "[]";
    public DateTimeOffset LastAt { get; set; }
}

/// <summary>A sent message's delivery to one person, with its result as the email server or SMS provider reported it.</summary>
public sealed class DeliveryRow
{
    public Guid Id { get; set; }
    public Guid SentMessageId { get; set; }
    public Guid PersonId { get; set; }
    public string Name { get; set; } = "";
    public string? UnitLabel { get; set; }
    /// <summary>email, sms, whatsapp, portal or push.</summary>
    public string Channel { get; set; } = "";
    /// <summary>Email address, phone number or "Resident portal".</summary>
    public string Address { get; set; } = "";
    /// <summary>scheduled, queued, delivered, read, failed or bounced.</summary>
    public string Status { get; set; } = "queued";
    public DateTimeOffset At { get; set; }
    public string? Error { get; set; }
    /// <summary>The merge values used for this person, as JSON.</summary>
    public string Values { get; set; } = "{}";
    /// <summary>The issued statement or letter this delivery carries, so its result can be recorded and a failure retried.</summary>
    public Guid? DocumentId { get; set; }
    /// <summary>The provider's id for the message (SMSSouthAfrica's event id).</summary>
    public string? ProviderMessageId { get; set; }
}

/// <summary>An organisation's messages in one calendar month (SA time) on one channel. A new month starts from zero.</summary>
public sealed class MessageUsageRow
{
    public Guid OrganisationId { get; set; }
    /// <summary>"2026-10".</summary>
    public string Period { get; set; } = "";
    /// <summary>sms or whatsapp.</summary>
    public string Channel { get; set; } = "";
    /// <summary>What counts against the allowance: SMS parts, WhatsApp messages.</summary>
    public int Units { get; set; }
    /// <summary>Messages sent (an SMS of three parts is one message, three units).</summary>
    public int Messages { get; set; }
}

/// <summary>The agency's relationship with a contractor: vetting, contact, bank details for payment, the schemes they serve.</summary>
public sealed class SupplierRow
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public int Version { get; set; } = 1;
    /// <summary>The Humo Contractor business, when the business is on Humo.</summary>
    public string? PartyId { get; set; }
    public string Name { get; set; } = "";
    /// <summary>JSON list of trades.</summary>
    public string Trades { get; set; } = "[]";
    public string ContactName { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Email { get; set; } = "";
    /// <summary>Masked for display; changing it needs a fresh passkey and holds payments until verified.</summary>
    public string BankAccount { get; set; } = "To be confirmed";
    public bool BankVerified { get; set; }
    public int? BbbeeLevel { get; set; }
    /// <summary>JSON list of scheme ids.</summary>
    public string SchemeIds { get; set; } = "[]";
    /// <summary>JSON list of vetting documents.</summary>
    public string Documents { get; set; } = "[]";
    /// <summary>active, on-hold or archived.</summary>
    public string Status { get; set; } = "active";
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>A maintenance job: key columns for finding it, the job itself as JSON (Humo.Domain.Maintenance.Job).</summary>
public sealed class JobRow
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Guid SchemeId { get; set; }
    /// <summary>"MR-1001", per organisation.</summary>
    public string Ref { get; set; } = "";
    public string Stage { get; set; } = "reported";
    public Guid? UnitId { get; set; }
    public Guid? SupplierId { get; set; }
    public Guid? ReportedByPersonId { get; set; }
    public string Title { get; set; } = "";
    public int Version { get; set; } = 1;
    public DateTimeOffset ReportedAt { get; set; }
    public string Json { get; set; } = "{}";
}

/// <summary>A supplier's invoice for a job (or a contract), checked against the approved quote before it's paid.</summary>
public sealed class SupplierInvoiceRow
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Guid SchemeId { get; set; }
    public Guid SupplierId { get; set; }
    public Guid? JobId { get; set; }
    /// <summary>The supplier's own invoice number.</summary>
    public string Number { get; set; } = "";
    public string Description { get; set; } = "";
    public decimal Amount { get; set; }
    /// <summary>The approved quote, for the match.</summary>
    public decimal? ApprovedAmount { get; set; }
    public DateTimeOffset ReceivedAt { get; set; }
    public DateOnly DueOn { get; set; }
    /// <summary>awaiting-approval, approved, rejected, in-batch or paid.</summary>
    public string Status { get; set; } = "awaiting-approval";
    public Guid? ApprovalWorkItemId { get; set; }
    public Guid? BatchId { get; set; }
    public DateTimeOffset? PaidAt { get; set; }
    public int Version { get; set; } = 1;
}

/// <summary>
/// A file uploaded to a scheme (docs/18 R-11). The content lives in <c>Files:Root</c> under <see cref="StorageKey"/>; the
/// record keeps what the file is, who put it there, and that it was checked for malware before it was stored.
/// </summary>
public sealed class UploadedFile
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Guid SchemeId { get; set; }
    public string Name { get; set; } = "";
    public string ContentType { get; set; } = "application/pdf";
    public long SizeBytes { get; set; }
    public string Sha256 { get; set; } = "";
    public string StorageKey { get; set; } = "";
    /// <summary>"clean": the only state a stored file is in. Infected files are refused before they're stored.</summary>
    public string ScanResult { get; set; } = "clean";
    public string UploadedBy { get; set; } = "";
    public DateTimeOffset UploadedAt { get; set; }
}

/// <summary>
/// A document in the library (docs/18 R-11). Its file is an <see cref="UploadedFile"/>. Its scheme, category, visibility
/// and expiry are what the library filters and what Compliance reads. Edits and archiving are versioned.
/// </summary>
public sealed class LibraryDocument
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Guid SchemeId { get; set; }
    public Guid FileId { get; set; }
    /// <summary>What it's uploaded on: "scheme", "unit" or "job" (the record's own Id is <see cref="RecordId"/>; a scheme's is null).</summary>
    public string RecordKind { get; set; } = "scheme";
    public Guid? RecordId { get; set; }
    public string Title { get; set; } = "";
    public string Category { get; set; } = "other";
    public string Visibility { get; set; } = "staff";
    public DateOnly? ExpiresOn { get; set; }
    public string? Notes { get; set; }
    public int Version { get; set; }
    public string UploadedBy { get; set; } = "";
    public DateTimeOffset UploadedAt { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }
    public string? ArchivedBy { get; set; }
    public string? ArchiveReason { get; set; }
}

/// <summary>
/// An invoice an agency issues to an owner for one of their levy accounts (Essentials, D17). Issuing it posts a charge to the
/// account's ledger; each payment recorded posts a credit. Numbers run per agency, INV-0001 onwards.
/// </summary>
public sealed class OwnerInvoice
{
    public Guid Id { get; set; }
    public Guid OrganisationId { get; set; }
    public Guid SchemeId { get; set; }
    public Guid AccountId { get; set; }
    public string Number { get; set; } = "";
    public DateOnly Date { get; set; }
    public DateOnly DueOn { get; set; }
    /// <summary>The lines: description, quantity, unit price and amount (JSON).</summary>
    public string Lines { get; set; } = "[]";
    public decimal Total { get; set; }
    public decimal Paid { get; set; }
    /// <summary>"issued" until it's paid in full, then "paid".</summary>
    public string Status { get; set; } = "issued";
    /// <summary>Payments recorded against it (JSON): date, amount, reference and who recorded it.</summary>
    public string Payments { get; set; } = "[]";
    public int Version { get; set; } = 1;
    public string IssuedBy { get; set; } = "";
    public DateTimeOffset IssuedAt { get; set; }
    public DateTimeOffset? EmailedAt { get; set; }
}

