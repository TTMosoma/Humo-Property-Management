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
    public DateTimeOffset CreatedAt { get; set; }
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
