import { Permission } from './permission';
import { Role } from './role';

/**
 * One role a person holds, and where it applies.
 *
 * "Role determines what someone can do. Assignment determines what they can see."
 * An identity can hold several assignments (e.g. Agency Administrator AND
 * Trustee of Kingfisher Court) and switches between them — it never needs a
 * second account.
 */
export interface RoleAssignment {
  id: string;
  role: Role;
  /** Null for Humo internal roles, which work across all agencies. */
  agencyId: string | null;
  /** Schemes this assignment covers. Empty means "every scheme in the agency". */
  schemeIds: string[];
  /** For contractors and suppliers: the Humo Contractor business they act for. Not tied to one agency. */
  partyId?: string;
  /** For owners and tenants: the unit owned or occupied, e.g. "Unit 42". */
  unitLabel?: string;
  /** Short description shown in the role switcher, e.g. "Chairperson · Kingfisher Court". */
  label: string;
  /** Individually granted permissions on top of the role's defaults (e.g. System.Impersonate). */
  grants?: Permission[];
  /** Who granted it and when (shown in Users & access; recorded in the audit log). */
  grantedBy?: string;
  grantedAt?: string;
}

/** Customer identities belong to an agency (or to no one, for residents); Humo identities to Humo. */
export type IdentityKind = 'customer' | 'humo';

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
  /** Matches Scheme.portfolioManagerId / work item assignees for agency staff. */
  staffId?: string;
  /** For owners, tenants and trustees: their record in the People directory. */
  personId?: string;
  memberships: RoleAssignment[];
  /** Prototype only: available in the prototype toolbar's "View as" list. */
  demo?: boolean;
}

/** @deprecated Use RoleAssignment. Kept so existing feature code reads naturally during the migration. */
export type Membership = RoleAssignment;
/** @deprecated Use Identity. */
export type Persona = Identity;
