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
    public decimal Balance { get; set; }
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

/// <summary>A one-time sign-in link: only a hash of the token is stored. Used once, then dead.</summary>
public sealed class SignInLink
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? UsedAt { get; set; }
}
