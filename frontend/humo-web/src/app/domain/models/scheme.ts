export type SchemeType = 'Sectional Title' | 'Home Owners Association' | 'Share Block';

/**
 * Prospect → Onboarding → Active → Closed → Archived. Schemes are never deleted:
 * a scheme the agency stops managing is closed, and archived once its records are settled.
 */
export type SchemeStatus = 'prospect' | 'onboarding' | 'active' | 'closed' | 'archived';

export const SCHEME_STATUS_LABELS: Record<SchemeStatus, string> = {
  prospect: 'Prospect',
  onboarding: 'Onboarding',
  active: 'Active',
  closed: 'Closed',
  archived: 'Archived',
};

/** A staff member as other records show them. */
export interface StaffRef {
  identityId: string;
  /** The id work items and jobs use for assignees. */
  staffId?: string;
  name: string;
}

/** A community scheme (body corporate, HOA or share block) managed by an organisation. */
export interface Scheme {
  id: string;
  organisationId: string;
  name: string;
  /** Short code used in unit/account references, e.g. "KC" → account KC-042. */
  code: string;
  type: SchemeType;
  status: SchemeStatus;
  suburb: string;
  city: string;
  province: string;
  unitCount: number;
  /**
   * Read-only: worked out by the server from portfolio-manager role assignments
   * (the longest-standing one if several cover the scheme). Assigning a manager
   * is granting that role, in Users & access. Null when nobody is assigned.
   */
  portfolioManager: StaffRef | null;
}
