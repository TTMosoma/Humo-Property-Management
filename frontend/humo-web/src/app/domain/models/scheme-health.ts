export type ComplianceStatus = 'complete' | 'due-soon' | 'overdue' | 'not-applicable';
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
