/** Complete · Upcoming (not yet due) · Due soon (within 30 days) · Overdue · N/A. Neutral words: no claims of legal sufficiency. */
export type ComplianceStatus = 'complete' | 'upcoming' | 'due-soon' | 'overdue' | 'not-applicable';
export type HealthRating = 'good' | 'watch' | 'at-risk';

/** A scheme's vital signs, shown in the schemes list, scheme header and dashboard. */
export interface SchemeHealth {
  schemeId: string;
  /** Percentage of billed levies collected over the last 3 months. */
  collectionRate: number;
  /** Total arrears in Rands. */
  arrears: number;
  /** Accounts more than 90 days in arrears. */
  accounts90Plus: number;
  monthlyLevyRoll: number;
  openJobs: number;
  overdueJobs: number;
  compliance: ComplianceStatus;
  complianceOpenItems: number;
  /** ISO date of the next scheduled meeting, if any. */
  nextMeeting?: { type: 'Trustee meeting' | 'AGM' | 'SGM'; at: string };
  rating: HealthRating;
}

/**
 * Healthy · Watch · At risk, from the vital signs. Prototype thresholds:
 * at risk when compliance is overdue, collections are under 85%, or jobs are
 * overdue while collections are under 90%; watch when anything is slipping.
 */
export function rateHealth(h: Pick<SchemeHealth, 'compliance' | 'collectionRate' | 'overdueJobs' | 'accounts90Plus'>): HealthRating {
  if (h.compliance === 'overdue' || h.collectionRate < 85 || (h.overdueJobs > 0 && h.collectionRate < 90)) return 'at-risk';
  if (h.compliance === 'due-soon' || h.collectionRate < 91 || h.overdueJobs > 0) return 'watch';
  return 'good';
}

/** Something that changed since yesterday that a person may need to act on (review finding F9, "Exceptions"). */
export interface ChangeEvent {
  id: string;
  at: string;
  kind: 'approval' | 'request' | 'quote' | 'payments' | 'compliance' | 'document' | 'meeting' | 'billing' | 'collection';
  title: string;
  detail: string;
  schemeId: string;
  route: string;
  /** Bad news is "attention"; the rest is "info". */
  tone: 'attention' | 'info';
}
