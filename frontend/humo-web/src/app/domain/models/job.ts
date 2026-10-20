import { Trade } from './supplier';

/**
 * The Job (review finding F16): one record carries a maintenance problem
 * from report to payment. Finance › Payables, Suppliers and Approvals are
 * views of the same job — never copies.
 */
export type JobStage =
  | 'reported'
  | 'quoting'
  | 'approval'
  | 'approved'
  | 'scheduled'
  | 'in-progress'
  | 'completed'
  | 'verified'
  | 'invoiced'
  | 'paid'
  | 'closed'
  | 'cancelled';

export const JOB_STAGES: { id: JobStage; label: string; short: string }[] = [
  { id: 'reported', label: 'Reported', short: 'Reported' },
  { id: 'quoting', label: 'Quotes', short: 'Quotes' },
  { id: 'approval', label: 'Approval', short: 'Approval' },
  { id: 'approved', label: 'Work order', short: 'Order' },
  { id: 'scheduled', label: 'Scheduled', short: 'Booked' },
  { id: 'in-progress', label: 'In progress', short: 'Working' },
  { id: 'completed', label: 'Completed', short: 'Done' },
  { id: 'verified', label: 'Verified', short: 'Verified' },
  { id: 'invoiced', label: 'Invoice', short: 'Invoice' },
  { id: 'paid', label: 'Paid', short: 'Paid' },
  { id: 'closed', label: 'Closed', short: 'Closed' },
];

export type Priority = 'urgent' | 'high' | 'normal' | 'low';

export const PRIORITY_LABEL: Record<Priority, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };

/** Agency staff may approve quotes up to this amount; above it the trustees decide (Settings › Billing). */
export const DELEGATED_LIMIT = 5000;

export interface Photo {
  id: string;
  caption: string;
  takenAt: string;
  by: string;
  /** Before/after work. */
  stage: 'report' | 'completion';
}

export interface Quote {
  id: string;
  supplierId: string;
  amount: number;
  receivedAt?: string;
  /** Requested but not yet received. */
  status: 'requested' | 'received' | 'declined';
  validUntil?: string;
  notes?: string;
  guaranteeMonths?: number;
  recommended?: boolean;
}

export interface JobEvent {
  id: string;
  at: string;
  kind: 'stage' | 'comment' | 'quote' | 'approval' | 'message' | 'invoice' | 'payment' | 'photo';
  text: string;
  by: string;
}

export interface Job {
  id: string;
  /** Concurrency token: send it back with commands that change this record. The API answers 409 if someone changed it first. */
  version: number;
  /** "MR-1042" */
  ref: string;
  schemeId: string;
  /** Unit, or undefined for common property. */
  unitId?: string;
  location: string;
  title: string;
  description: string;
  category: Trade;
  priority: Priority;
  stage: JobStage;
  reportedBy: { name: string; role: 'owner' | 'tenant' | 'trustee' | 'staff'; personId?: string };
  reportedAt: string;
  /** Agency staff member responsible. */
  assigneeId: string | null;
  photos: Photo[];
  quotes: Quote[];
  approval?: { status: 'pending' | 'approved' | 'rejected'; workItemId?: string; decidedBy?: string; decidedAt?: string; comment?: string; withinDelegation?: boolean };
  supplierId?: string;
  workOrder?: { issuedAt: string; scheduledFor: string; accessNotes?: string };
  completion?: { completedAt: string; notes: string };
  verification?: { at: string; by: string; outcome: 'fixed' | 'not-fixed'; comment?: string };
  invoiceId?: string;
  /** Quotes gathered through a Humo Contractor quote request (compared there, awarded here). */
  networkQuotes?: { quoteRequestId: string; compared: number };
  budgetCategory: string;
  events: JobEvent[];
  /** Overdue flag for the current stage (e.g. contractor missed the booking). */
  dueAt?: string;
}

export interface Invoice {
  id: string;
  /** Concurrency token: send it back with commands that change this record. The API answers 409 if someone changed it first. */
  version: number;
  supplierId: string;
  schemeId: string;
  jobId?: string;
  /** The supplier's own invoice number (on the API; in the simulation the id is the number). */
  number?: string;
  /** Monthly contract invoices have no job. */
  contractRef?: string;
  description: string;
  amount: number;
  receivedAt: string;
  dueAt: string;
  /** Amount of the approved quote, for the match. */
  approvedAmount?: number;
  status: 'awaiting-approval' | 'approved' | 'rejected' | 'in-batch' | 'paid';
  approvalWorkItemId?: string;
  batchId?: string;
  paidAt?: string;
}

export interface PaymentBatch {
  id: string;
  /** Concurrency token: send it back with commands that change this record. The API answers 409 if someone changed it first. */
  version: number;
  schemeId: string;
  invoiceIds: string[];
  total: number;
  createdAt: string;
  createdBy: string;
  status: 'awaiting-approval' | 'approved' | 'released';
  approvalWorkItemId?: string;
  releasedAt?: string;
}

export function stageIndex(stage: JobStage): number {
  return JOB_STAGES.findIndex((s) => s.id === stage);
}

/** Invoice vs approved quote: the three-way match agents and trustees care about. */
export function invoiceVariance(inv: Pick<Invoice, 'amount' | 'approvedAmount'>): number | null {
  return inv.approvedAmount === undefined ? null : Math.round((inv.amount - inv.approvedAmount) * 100) / 100;
}
