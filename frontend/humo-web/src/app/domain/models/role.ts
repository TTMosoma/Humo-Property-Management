/**
 * Roles (profiles) a Humo identity can operate under. One person, one identity;
 * each role they hold is a separate assignment with its own scope.
 *
 * Customer roles are granted by the customer's Agency Administrator.
 * Humo roles are internal to the Humo company and are granted only by a
 * Humo System Administrator — they never appear in customer-facing pickers.
 */
export type CustomerRole =
  | 'agency-admin'
  | 'portfolio-manager'
  | 'finance'
  | 'operations'
  | 'trustee'
  | 'owner'
  | 'tenant'
  | 'supplier';

export type HumoRole = 'system-admin' | 'humo-account-manager' | 'humo-support' | 'humo-executive';

export type Role = CustomerRole | HumoRole;

export const ROLE_LABELS: Record<Role, string> = {
  'agency-admin': 'Agency Administrator',
  'portfolio-manager': 'Portfolio Manager',
  finance: 'Finance User',
  operations: 'Operations / Maintenance',
  trustee: 'Trustee',
  owner: 'Owner',
  tenant: 'Tenant',
  supplier: 'Supplier / Contractor',
  'system-admin': 'Humo System Administrator',
  'humo-account-manager': 'Humo Account Manager',
  'humo-support': 'Humo Support',
  'humo-executive': 'Humo Executive',
};

/** Who a role belongs to. Drives grouping in pickers and the subtle role accent in the shell. */
export type RoleFamily = 'agency' | 'governance' | 'resident' | 'supplier' | 'humo';

export interface RoleMeta {
  role: Role;
  family: RoleFamily;
  icon: string;
  /** One line: what this role is for. */
  summary: string;
  /** What a person in this role can see (assignment determines where). */
  scopeKind: 'agency' | 'schemes' | 'unit' | 'supplier' | 'platform';
  /** The role that may grant this one. */
  grantedBy: Role;
  /** Granting this role is a privileged change: it requires step-up verification. */
  privileged: boolean;
  /** Not yet designed as an experience in the prototype. */
  experiencePlanned?: boolean;
}

export const ROLE_META: Record<Role, RoleMeta> = {
  'agency-admin': {
    role: 'agency-admin', family: 'agency', icon: 'key-outline', scopeKind: 'agency', grantedBy: 'agency-admin', privileged: true,
    summary: 'Runs the agency on Humo: people, access, settings and every scheme.',
  },
  'portfolio-manager': {
    role: 'portfolio-manager', family: 'agency', icon: 'briefcase-outline', scopeKind: 'schemes', grantedBy: 'agency-admin', privileged: false,
    summary: 'Manages assigned schemes day to day: maintenance, trustees, owners.',
  },
  finance: {
    role: 'finance', family: 'agency', icon: 'wallet-outline', scopeKind: 'schemes', grantedBy: 'agency-admin', privileged: true,
    summary: 'Receipts, levies, supplier payments and trust accounts.',
  },
  operations: {
    role: 'operations', family: 'agency', icon: 'construct-outline', scopeKind: 'schemes', grantedBy: 'agency-admin', privileged: false,
    summary: 'Runs maintenance: triage, suppliers, work orders and site visits.',
  },
  trustee: {
    role: 'trustee', family: 'governance', icon: 'ribbon-outline', scopeKind: 'schemes', grantedBy: 'agency-admin', privileged: false,
    summary: 'Governs one scheme: approvals above delegated authority, budgets, meetings.',
  },
  owner: {
    role: 'owner', family: 'resident', icon: 'home-outline', scopeKind: 'unit', grantedBy: 'agency-admin', privileged: false,
    summary: 'Their own units: account, statements, requests and notices.',
  },
  tenant: {
    role: 'tenant', family: 'resident', icon: 'key-outline', scopeKind: 'unit', grantedBy: 'agency-admin', privileged: false,
    summary: 'The unit they live in: maintenance requests and notices.',
  },
  supplier: {
    role: 'supplier', family: 'supplier', icon: 'hammer-outline', scopeKind: 'supplier', grantedBy: 'agency-admin', privileged: false,
    summary: 'Their own work orders, quotes and invoices with this agency.',
    experiencePlanned: true,
  },
  'system-admin': {
    role: 'system-admin', family: 'humo', icon: 'shield-outline', scopeKind: 'platform', grantedBy: 'system-admin', privileged: true,
    summary: 'Operates the Humo platform. Impersonation is a separate, individual grant.',
  },
  'humo-account-manager': {
    role: 'humo-account-manager', family: 'humo', icon: 'people-circle-outline', scopeKind: 'platform', grantedBy: 'system-admin', privileged: false,
    summary: 'Looks after customer agencies: onboarding, plans and renewals.',
  },
  'humo-support': {
    role: 'humo-support', family: 'humo', icon: 'help-buoy-outline', scopeKind: 'platform', grantedBy: 'system-admin', privileged: false,
    summary: 'Helps customers. Sees agency setup, not their financial records.',
  },
  'humo-executive': {
    role: 'humo-executive', family: 'humo', icon: 'stats-chart-outline', scopeKind: 'platform', grantedBy: 'system-admin', privileged: false,
    summary: 'Platform-level reporting. No access to customer records.',
  },
};

export const CUSTOMER_ROLES: readonly CustomerRole[] = [
  'agency-admin',
  'portfolio-manager',
  'finance',
  'operations',
  'trustee',
  'owner',
  'tenant',
  'supplier',
];
export const HUMO_ROLES: readonly HumoRole[] = ['system-admin', 'humo-account-manager', 'humo-support', 'humo-executive'];

export function isHumoRole(role: Role): role is HumoRole {
  return (HUMO_ROLES as readonly Role[]).includes(role);
}

/** Convenient role groups used by route access rules and navigation. */
export const AGENCY_STAFF: readonly Role[] = ['agency-admin', 'portfolio-manager', 'finance', 'operations'];
/** Staff who work with money (levies, receipts, payables, accounts). Operations works with jobs, not ledgers. */
export const FINANCE_STAFF: readonly Role[] = ['agency-admin', 'portfolio-manager', 'finance'];
export const STAFF_AND_TRUSTEE: readonly Role[] = [...AGENCY_STAFF, 'trustee'];
export const RESIDENTS: readonly Role[] = ['owner', 'tenant'];
export const EVERYONE: readonly Role[] = [...CUSTOMER_ROLES, ...HUMO_ROLES];
