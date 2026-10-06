import { Role } from './role';

/**
 * A signed-in user in the prototype. There is no authentication yet:
 * the prototype toolbar switches between these personas to review each role.
 */
export interface Persona {
  id: string;
  name: string;
  initials: string;
  role: Role;
  /** Job title or relationship, e.g. "Chairperson · Kingfisher Court". */
  subtitle: string;
  email: string;
  /** Null for the System Administrator, who works across all agencies. */
  agencyId: string | null;
  /** Schemes the persona is linked to. Empty means "all schemes in the agency". */
  schemeIds: string[];
  /** For owners and tenants: the unit they own or occupy. */
  unitLabel?: string;
}
