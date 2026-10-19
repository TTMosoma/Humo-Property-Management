/**
 * A customer organisation on the Humo platform. Today every customer of Humo
 * Property Management is a managing agency, and the UI says "Agency"; the
 * concept stays general so other kinds of organisation can be added later.
 * Its package and features live on its Subscription.
 */
export type OrganisationKind = 'managing-agency';

/**
 * Lifecycle, separate from the subscription's commercial status. Organisations
 * are never deleted: they are suspended (access paused) or archived (closed, kept for records).
 */
export type OrganisationStatus = 'onboarding' | 'active' | 'suspended' | 'archived';

export const ORGANISATION_STATUS_LABELS: Record<OrganisationStatus, string> = {
  onboarding: 'Onboarding',
  active: 'Active',
  suspended: 'Suspended',
  archived: 'Archived',
};

export interface Organisation {
  id: string;
  /** Concurrency token: send it back with commands that change this record. The API answers 409 if someone changed it first. */
  version: number;
  kind: OrganisationKind;
  status: OrganisationStatus;
  name: string;
  shortName: string;
  city: string;
  province: string;
  /** Denormalised counts for display. */
  schemeCount: number;
  unitCount: number;
  /** Approving this amount or more needs a fresh passkey (doc 03). Set by the agency's administrators; R50 000 by default. */
  approvalStepUpAmount?: number;
}
