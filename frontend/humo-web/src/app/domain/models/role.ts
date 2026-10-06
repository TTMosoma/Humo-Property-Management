/** The roles Humo is designed around. One app, one shell — navigation and access vary by role. */
export type Role =
  | 'system-admin'
  | 'agency-admin'
  | 'portfolio-manager'
  | 'finance'
  | 'trustee'
  | 'owner'
  | 'tenant';

export const ROLE_LABELS: Record<Role, string> = {
  'system-admin': 'System Administrator',
  'agency-admin': 'Agency Administrator',
  'portfolio-manager': 'Portfolio Manager',
  finance: 'Financial / Accounts',
  trustee: 'Trustee',
  owner: 'Owner',
  tenant: 'Tenant',
};

/** Convenient role groups used by route access rules and navigation. */
export const AGENCY_STAFF: readonly Role[] = ['agency-admin', 'portfolio-manager', 'finance'];
export const STAFF_AND_TRUSTEE: readonly Role[] = [...AGENCY_STAFF, 'trustee'];
export const RESIDENTS: readonly Role[] = ['owner', 'tenant'];
export const EVERYONE: readonly Role[] = [
  'system-admin',
  ...AGENCY_STAFF,
  'trustee',
  ...RESIDENTS,
];
