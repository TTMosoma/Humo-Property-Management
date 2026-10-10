import { Role } from './role';
import { Scheme } from './scheme';
import { WorkItem } from './work-item';

/**
 * Staff (Portfolio › Staff): who manages what, and each person's workload,
 * from the Attention model. Roles and scheme assignments stay in
 * Users & access; this page reads them.
 *
 * Away cover: while someone is away, their open Tasks and messages move to a
 * colleague, and new work for their schemes goes to the colleague too. When
 * the cover ends, what's still open moves back.
 */

export interface StaffCover {
  /** The colleague covering. */
  coverId: string;
  coverName: string;
  from: string;
  to: string;
  reason: string;
  setBy: string;
  /** Work items moved to the colleague, to move back afterwards. */
  movedIds: string[];
}

export interface StaffSummary {
  /** The staff id work items use. */
  id: string;
  identityId: string;
  name: string;
  initials: string;
  title?: string;
  email: string;
  roles: Role[];
  /** Every scheme, for organisation-wide roles. */
  allSchemes: boolean;
  schemes: Scheme[];
  openTasks: number;
  overdueTasks: number;
  openMessages: number;
  /** Approvals waiting that their role can decide. */
  approvalsWaiting: number;
  away?: StaffCover;
  /** Someone else's work they're covering. */
  covering: string[];
}

export interface StaffDetail extends StaffSummary {
  openWork: WorkItem[];
  /** Done in the last 14 days. */
  doneRecently: WorkItem[];
}

export interface NewCover {
  coverId: string;
  /** yyyy-mm-dd */
  from: string;
  to: string;
  reason: string;
}
