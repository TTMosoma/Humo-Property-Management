import { Role } from './role';

/**
 * The Attention model: every actionable thing in Humo Property Management is a WorkItem.
 * Tasks, Approvals, Inbox, sidebar badges, notifications and the dashboard's
 * "Today" list are all views over the same items, so they can never disagree.
 */
export type WorkItemKind = 'task' | 'approval' | 'message';

export type WorkItemType =
  | 'receipt-allocation'
  | 'debtor-follow-up'
  | 'maintenance-triage'
  | 'maintenance-overdue'
  | 'quote-approval'
  | 'invoice-approval'
  | 'payment-batch-approval'
  | 'bank-details-verification'
  | 'billing-run-approval'
  | 'demand-approval'
  | 'compliance-due'
  | 'meeting-action'
  | 'minutes-approval'
  | 'resolution-approval'
  | 'document-expiry'
  | 'owner-message'
  | 'follow-up'
  | 'rule-breach';

/** 'cooling-off': approved alone under the trustees' permission, in effect after 24 hours (D24). */
export type WorkItemStatus = 'open' | 'done' | 'approved' | 'rejected' | 'cooling-off';

/**
 * Who approves an approval its preparer can't, when the agency has nobody else (D24): a trustee on Humo; the preparer
 * alone under the trustees' permission; or nobody until the permission is added.
 */
export interface SecondAuthoriser {
  mode: 'trustees' | 'alone' | 'permission-needed';
  note: string;
}

export type Urgency = 'overdue' | 'today' | 'week' | 'later';

export interface WorkItem {
  id: string;
  /** Human reference shown in lists, e.g. "MR-1042", "INV-20931". */
  ref: string;
  kind: WorkItemKind;
  type: WorkItemType;
  title: string;
  detail: string;
  schemeId: string;
  unitLabel?: string;
  personName?: string;
  supplierName?: string;
  /** Rands. For approvals: the amount being approved. */
  amount?: number;
  /** For grouped items, e.g. "17 receipts to allocate". */
  count?: number;
  /** ISO timestamps. */
  createdAt: string;
  dueAt: string;
  /** Staff id or persona id; null means "team / unassigned". */
  assigneeId: string | null;
  /** Approvals only: who may decide. */
  approverRoles?: Role[];
  /** Approvals only: context for a confident decision. */
  budget?: { category: string; annual: number; spent: number };
  evidence?: string[];
  status: WorkItemStatus;
  decidedBy?: string;
  decidedAt?: string;
  comment?: string;
  /** Approved alone (D24): who, and when it takes effect after the cooling-off. */
  heldBy?: string;
  heldUntil?: string;
  /** Set when the person looking prepared it and the agency has nobody else to approve it (D24). */
  secondAuthoriser?: SecondAuthoriser;
  /** Deep link to the record where the work is done. */
  route: string;
  /** D39: decided by a majority of the board register; who has decided so far. */
  board?: BoardProgress;
}

export interface BoardProgress {
  trustees: number;
  /** More than half the trustees on the board register. */
  needed: number;
  approvals: number;
  rejections: number;
  seats: { personId: string; name: string; decision?: 'approved' | 'rejected'; source?: 'humo' | 'upload' }[];
  /** The person looking is on this scheme's board. */
  mySeat: boolean;
  iVoted: boolean;
}

/**
 * Where work with nobody assigned waits (P2-7): the agency's shared queue. Agency
 * Administrators see all of it; the right staff pick it up. A scheme without a
 * portfolio manager sends its new work here.
 */
export const AGENCY_QUEUE = 'Agency queue';

/**
 * Approvals of work the managing agency arranged (D6): quotes, supplier
 * invoices, payment batches, billing runs and letters of demand. Board matters
 * (minutes, written resolutions) aren't included: how a staff trustee votes on
 * them is still open (D6).
 */
export const AGENCY_WORK: readonly WorkItemType[] = ['quote-approval', 'invoice-approval', 'payment-batch-approval', 'billing-run-approval', 'demand-approval'];

export const WORK_TYPE_LABELS: Record<WorkItemType, string> = {
  'receipt-allocation': 'Receipt allocation',
  'debtor-follow-up': 'Debtor follow-up',
  'maintenance-triage': 'New maintenance request',
  'maintenance-overdue': 'Overdue maintenance',
  'quote-approval': 'Quote approval',
  'invoice-approval': 'Invoice approval',
  'payment-batch-approval': 'Payment batch',
  'bank-details-verification': 'Supplier bank details',
  'billing-run-approval': 'Billing run',
  'demand-approval': 'Letter of demand',
  'compliance-due': 'Compliance',
  'meeting-action': 'Meeting action',
  'minutes-approval': 'Minutes approval',
  'resolution-approval': 'Written resolution',
  'document-expiry': 'Document expiry',
  'owner-message': 'Message',
  'follow-up': 'Follow-up',
  'rule-breach': 'Rule breach',
};

/** Which part of Humo Property Management a work item belongs to (used for grouping and filters). */
/**
 * Tasks that stand for real work on a record, with the button that goes to it. Each closes itself when that step is
 * taken, so ticking one off could only say the work was done when it wasn't. The API refuses it too.
 */
const CLOSES_ITSELF: Partial<Record<WorkItemType, string>> = {
  'debtor-follow-up': 'Open debtor case',
  'maintenance-triage': 'Open the job',
  'rule-breach': 'Open the breach',
};

/** The button to the work, when this task can only be closed by doing it. */
export function workButton(w: Pick<WorkItem, 'type'>): string | undefined {
  return CLOSES_ITSELF[w.type];
}

export const WORK_TYPE_AREA: Record<WorkItemType, 'Finance' | 'Maintenance' | 'Governance' | 'Compliance' | 'Communication'> = {
  'receipt-allocation': 'Finance',
  'debtor-follow-up': 'Finance',
  'maintenance-triage': 'Maintenance',
  'maintenance-overdue': 'Maintenance',
  'quote-approval': 'Maintenance',
  'invoice-approval': 'Finance',
  'payment-batch-approval': 'Finance',
  'bank-details-verification': 'Finance',
  'billing-run-approval': 'Finance',
  'demand-approval': 'Finance',
  'compliance-due': 'Compliance',
  'meeting-action': 'Governance',
  'minutes-approval': 'Governance',
  'resolution-approval': 'Governance',
  'document-expiry': 'Compliance',
  'owner-message': 'Communication',
  'follow-up': 'Communication',
  'rule-breach': 'Governance',
};

export function urgencyOf(item: Pick<WorkItem, 'dueAt'>, now = new Date()): Urgency {
  const due = new Date(item.dueAt).getTime();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  if (due < now.getTime()) return 'overdue';
  if (due < start + day) return 'today';
  if (due < start + 7 * day) return 'week';
  return 'later';
}

export function isOpen(item: WorkItem): boolean {
  return item.status === 'open';
}
