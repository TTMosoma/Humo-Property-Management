import { Permission } from './permission';
import { Role } from './role';

/**
 *   Identity (one per human)
 *     → OrganisationMembership (belongs to an organisation, with a status)
 *       → RoleAssignment (a role, and the scope it applies to)
 *
 * "Role determines what someone can do. Assignment determines what they can see."
 * An identity can hold several assignments (e.g. Agency Administrator AND
 * Trustee of Kingfisher Court) and switches between them — it never needs a
 * second account. Nothing here is deleted: memberships and assignments end.
 */

/**
 * Where an assignment applies — always explicit, never "an empty list means everything".
 * - platform:     Humo internal roles, across every organisation
 * - organisation: every scheme in the organisation
 * - schemes:      the listed schemes only
 * - unit:         one unit (owners and tenants); `schemeIds` holds its scheme
 * - party:        a Humo Contractor business, not tied to one organisation
 * Room for later: portfolio.
 */
export type ScopeType = 'platform' | 'organisation' | 'schemes' | 'unit' | 'party';

export interface AssignmentScope {
  type: ScopeType;
  /** Null for platform and party scopes. */
  organisationId: string | null;
  /** The schemes covered: for `schemes`, the list; for `unit`, the unit's scheme; otherwise empty. */
  schemeIds: string[];
  unitId?: string;
  partyId?: string;
}

export type AssignmentStatus = 'active' | 'ended';

export interface RoleAssignment {
  id: string;
  role: Role;
  scope: AssignmentScope;
  /** Short description shown in the role switcher, e.g. "Chairperson · Kingfisher Court". */
  label: string;
  /** Individually granted permissions on top of the role's defaults (e.g. System.Impersonate). */
  grants?: Permission[];
  status: AssignmentStatus;
  /** Who granted it and when (shown in Users & access; recorded in the audit log). */
  grantedBy?: string;
  grantedAt?: string;
  /** Temporary assignments (e.g. covering for a colleague) end on their own. */
  validUntil?: string;
  endedBy?: string;
  endedAt?: string;
}

export type MembershipStatus = 'active' | 'suspended' | 'ended';

/** Belonging to an organisation. Suspending it pauses every assignment in that organisation. */
export interface OrganisationMembership {
  organisationId: string;
  status: MembershipStatus;
  since: string;
  endedAt?: string;
}

/** Customer identities belong to organisations (or to none, for residents and contractors); Humo identities to Humo. */
export type IdentityKind = 'customer' | 'humo';

/** Invited → Active → Suspended → Deactivated. Credentials are the identity provider's concern, not this record's. */
export type IdentityStatus = 'invited' | 'active' | 'suspended' | 'deactivated';

export const IDENTITY_STATUS_LABELS: Record<IdentityStatus, string> = {
  invited: 'Invited',
  active: 'Active',
  suspended: 'Suspended',
  deactivated: 'Deactivated',
};

/**
 * A person known to Humo — exactly one per human, however many roles they hold.
 * Authentication proves the identity; the active assignment sets the role and scope.
 */
export interface Identity {
  id: string;
  name: string;
  initials: string;
  email: string;
  kind: IdentityKind;
  status: IdentityStatus;
  /** Job title, for agency staff (e.g. "Senior Accountant"). */
  title?: string;
  /** Id that work items, jobs and schemes use to refer to agency staff. */
  staffId?: string;
  /** For owners, tenants and trustees: their record in the People directory. */
  personId?: string;
  memberships: OrganisationMembership[];
  /** Every assignment, including ended ones (shown as history). */
  assignments: RoleAssignment[];
  /** Prototype only: offered in the prototype's "Sign in as" list. */
  demo?: boolean;
}

/** Assignments that are in force today. */
export function activeAssignments(identity: Identity, now = new Date()): RoleAssignment[] {
  return identity.assignments.filter(
    (a) =>
      a.status === 'active' &&
      (!a.validUntil || new Date(a.validUntil) > now) &&
      (a.scope.organisationId === null ||
        identity.memberships.some((m) => m.organisationId === a.scope.organisationId && m.status === 'active')),
  );
}

/** Does the assignment cover every scheme in its organisation? */
export function coversAllSchemes(a: RoleAssignment): boolean {
  return a.scope.type === 'organisation';
}
