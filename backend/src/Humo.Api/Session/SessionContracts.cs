namespace Humo.Api.Session;

// JSON shapes the frontend reads (frontend/humo-web/src/app/domain: CurrentSession, Identity,
// RoleAssignment, Organisation). Property names serialise in camelCase.

public sealed record AssignmentScopeDto(string Type, string? OrganisationId, IReadOnlyList<string> SchemeIds, string? UnitId);

public sealed record RoleAssignmentDto(
    string Id,
    int Version,
    string Role,
    AssignmentScopeDto Scope,
    string Label,
    IReadOnlyList<string>? Grants,
    string Status,
    string? GrantedBy,
    DateTimeOffset? GrantedAt,
    DateTimeOffset? ValidUntil,
    string? EndedBy,
    DateTimeOffset? EndedAt);

public sealed record MembershipDto(string OrganisationId, string Status, DateTimeOffset Since, DateTimeOffset? EndedAt);

public sealed record IdentityDto(
    string Id,
    int Version,
    string Name,
    string Initials,
    string Email,
    string Kind,
    string Status,
    string? SuspendedFrom,
    string? Title,
    string? PersonId,
    IReadOnlyList<MembershipDto> Memberships,
    IReadOnlyList<RoleAssignmentDto> Assignments);

public sealed record OrganisationDto(string Id, int Version, string Kind, string Status, string Name, string ShortName, string City, string Province, int SchemeCount, int UnitCount);

/// <summary>GET /me: who's signed in, which role is active and what it may do. The client never computes this itself.</summary>
public sealed record CurrentSessionDto(
    bool SignedIn,
    string? Blocked,
    IdentityDto Actor,
    IdentityDto Identity,
    IReadOnlyList<RoleAssignmentDto> Assignments,
    string ActiveAssignmentId,
    IReadOnlyList<string> Permissions,
    IReadOnlyList<string> PagePermissions,
    IReadOnlyList<string> ActorPermissions,
    OrganisationDto? Organisation,
    object? Subscription,
    object? Entitlements,
    object? Impersonation);
