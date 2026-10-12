import { PackageId } from './entitlement';
import { OrganisationStatus } from './organisation';

/**
 * A request to open a new customer account (docs/21).
 *
 * The organisation itself only exists once the request is approved, or
 * activated under delegated authority. It then starts in the normal
 * `onboarding` status, so a pending or rejected request can never look like a
 * customer. Activating an organisation creates no users: its first
 * administrator is still invited, accepts and sets up a passkey as usual.
 */
export type AccountRequestStatus = 'pending' | 'approved' | 'rejected';

export const ACCOUNT_REQUEST_STATUS_LABELS: Record<AccountRequestStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

/**
 * How a request was (or will be) decided. The server picks it from the
 * submitter's permissions and the policy in force, never from the client.
 * - approval: a System Administrator approves or rejects it.
 * - delegated: an Account Manager with Platform.Customers.ActivateWithoutApproval activated it.
 */
export type AccountActivationRoute = 'approval' | 'delegated';

export const ACCOUNT_ROUTE_LABELS: Record<AccountActivationRoute, string> = {
  approval: 'Approval required',
  delegated: 'Delegated activation',
};

/**
 * The account-creation policy (System Administrators, Platform.Config.Manage).
 * - delegation-allowed (default): new accounts need approval, except from
 *   Account Managers individually granted delegated activation.
 * - approval-for-all: every new account needs approval; delegated activation
 *   is paused for everyone, without removing anyone's grant.
 * Neither setting grants anything to anyone. A change applies to new
 * requests only: waiting requests stay waiting.
 */
export type AccountApprovalPolicy = 'delegation-allowed' | 'approval-for-all';

export const ACCOUNT_POLICY_LABELS: Record<AccountApprovalPolicy, string> = {
  'delegation-allowed': 'Approval required, except for Account Managers with delegated activation',
  'approval-for-all': 'Approval required for every new account (delegated activation paused)',
};

export interface AccountPolicySetting {
  policy: AccountApprovalPolicy;
  version: number;
  updatedBy?: string;
  updatedAt?: string;
}

/** What's captured when the account is requested (the organisation and its trial). */
export interface NewAccountDetails {
  /** Registered name. */
  name: string;
  /** The name people use. */
  shortName: string;
  city: string;
  province: string;
  packageId: PackageId;
  /** The Humo Account Manager who'll look after them (identity id). */
  accountManagerId: string;
  /** Anything the approver should know. */
  notes?: string;
}

export interface AccountRequest {
  id: string;
  /** "AR-1004" */
  ref: string;
  /** Concurrency token. */
  version: number;
  details: NewAccountDetails;
  accountManager: string;
  status: AccountRequestStatus;
  route: AccountActivationRoute;
  /** The policy in force when it was submitted. */
  policy: AccountApprovalPolicy;
  requestedById: string;
  requestedBy: string;
  requestedAt: string;
  /** Approved, rejected or activated by (for delegated activation: the submitter). */
  decidedById?: string;
  decidedBy?: string;
  decidedAt?: string;
  /** Required when rejected. */
  reason?: string;
  /** Set once the organisation exists (approved or delegated). */
  organisationId?: string;
}

/** A request with its organisation's current lifecycle, for the oversight view. */
export interface AccountRequestView {
  request: AccountRequest;
  /** The organisation's status now, once it exists (normally onboarding, then active). */
  organisationStatus?: OrganisationStatus;
}

export interface AccountSubmission {
  requestId: string;
  ref: string;
  /** pending: waiting for a System Administrator. activated: the organisation exists (onboarding). */
  outcome: 'pending' | 'activated';
  organisationId?: string;
}

export type AccountDecision = { type: 'approve' } | { type: 'reject'; reason: string };
