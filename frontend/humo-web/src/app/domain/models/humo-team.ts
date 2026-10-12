import { Identity, RoleAssignment } from './identity';
import { HumoRole } from './role';

/**
 * Platform › Humo team: Humo's own staff (System Administrators, Account
 * Managers, Support, Executives). They work across every Humo product, so
 * they're managed on the platform, never in a customer's settings.
 *
 * Only System Administrators change the team, each change with a fresh
 * step-up and a reason. Nobody changes their own access; the last System
 * Administrator can't be removed; a new System Administrator needs a second
 * System Administrator's approval.
 */

/** Humo staff sign in with their Humo work address. */
export const HUMO_EMAIL_DOMAIN = 'humo.example';

export interface HumoCustomerRef {
  organisationId: string;
  name: string;
}

/** A request to make someone a System Administrator, waiting for a second System Administrator. */
export interface PendingHumoGrant {
  id: string;
  identityId: string;
  identityName: string;
  role: HumoRole;
  label: string;
  reason: string;
  requestedById: string;
  requestedBy: string;
  requestedAt: string;
}

export interface HumoTeamMember {
  identity: Identity;
  /** Humo roles in force. */
  roles: RoleAssignment[];
  /** Ended roles, newest first. */
  formerRoles: RoleAssignment[];
  /** Individually granted System.Impersonate (on their System Administrator role). */
  canImpersonate: boolean;
  /** Individually granted Platform.Customers.ActivateWithoutApproval (on their Account Manager role). */
  canActivateWithoutApproval: boolean;
  /** Customers they look after as Account Manager. */
  customers: HumoCustomerRef[];
  pending?: PendingHumoGrant;
  /** When they last signed in (from their sessions), if known. */
  lastActiveAt?: string;
}

export interface NewHumoMember {
  name: string;
  email: string;
  title?: string;
  role: HumoRole;
  /** e.g. "Customer support", "Gauteng & KZN accounts". */
  label: string;
  reason: string;
}

export type HumoTeamAction =
  | { type: 'grant-role'; role: HumoRole; label: string; reason: string }
  | { type: 'end-role'; assignmentId: string; reason: string }
  | { type: 'set-impersonation'; allowed: boolean; reason: string }
  /** Delegated account activation: an Account Manager may activate new customer accounts without a separate approval. */
  | { type: 'set-delegated-activation'; allowed: boolean; reason: string }
  | { type: 'set-customers'; organisationIds: string[]; reason: string }
  | { type: 'suspend'; reason: string }
  | { type: 'restore'; reason: string }
  /** Leaves Humo: every role ends, sessions end, customers move to `reassignTo`. */
  | { type: 'offboard'; reason: string; reassignTo?: string }
  | { type: 'approve-grant'; grantId: string }
  | { type: 'decline-grant'; grantId: string; reason: string };
