import { Role } from './role';

/**
 * One way a person takes part in Humo: a role, within an agency, optionally
 * limited to schemes or a unit. A person can hold several memberships
 * (e.g. trustee of Kingfisher Court AND owner of Unit 12) and switches between them.
 */
export interface Membership {
  id: string;
  role: Role;
  /** Null for the System Administrator, who works across all agencies. */
  agencyId: string | null;
  /** Schemes this membership covers. Empty means "every scheme in the agency". */
  schemeIds: string[];
  /** For owners and tenants: the unit owned or occupied, e.g. "Unit 42". */
  unitLabel?: string;
  /** Short description shown in the context switcher, e.g. "Chairperson · Kingfisher Court". */
  label: string;
}

/**
 * A signed-in user in the prototype. There is no authentication yet:
 * the prototype toolbar switches between these personas to review each role.
 */
export interface Persona {
  id: string;
  name: string;
  initials: string;
  email: string;
  /** Matches Scheme.portfolioManagerId / work item assignees for agency staff. */
  staffId?: string;
  memberships: Membership[];
}
