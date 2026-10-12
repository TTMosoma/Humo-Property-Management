import { DocumentTemplateRef } from './document';
import { Scheme } from './scheme';

/**
 * The billing run (review finding F15): one month's charges for one scheme,
 * prepared, checked and approved before anything reaches an account.
 *
 *   Scope & period → Charges preview → Exceptions → Approval → Posted → Statements sent
 *
 * - Every exception needs a decision before the run can go for approval.
 * - Approval happens in Approvals (the Approval engine), never on this screen.
 * - Posting writes the charges to the accounts and LOCKS the run: corrections
 *   after that are journal adjustments on the account, never edits to the run.
 * - Sending statements records which template version each was issued with.
 */

export type BillingStage = 'preview' | 'awaiting-approval' | 'approved' | 'posted' | 'sent' | 'cancelled';

export const BILLING_STAGES: { id: Exclude<BillingStage, 'cancelled'>; label: string }[] = [
  { id: 'preview', label: 'Charges & exceptions' },
  { id: 'awaiting-approval', label: 'Approval' },
  { id: 'approved', label: 'Approved' },
  { id: 'posted', label: 'Posted' },
  { id: 'sent', label: 'Statements sent' },
];

export const BILLING_STAGE_LABELS: Record<BillingStage, string> = {
  preview: 'Preparing',
  'awaiting-approval': 'Awaiting approval',
  approved: 'Approved, not posted',
  posted: 'Posted',
  sent: 'Statements sent',
  cancelled: 'Cancelled',
};

export type ChargeKind = 'levy' | 'special-levy' | 'utility' | 'interest';

export interface Charge {
  kind: ChargeKind;
  description: string;
  amount: number;
}

/** One account's charges in the run. */
export interface BillingLine {
  accountId: string;
  accountNo: string;
  unitNumber: string;
  holderName: string;
  charges: Charge[];
  total: number;
  /** Left out of the run by an exception decision. */
  excluded: boolean;
}

export type ExceptionKind = 'meter-missing' | 'unusual-reading' | 'levy-changed' | 'arrangement' | 'handed-over' | 'large-credit' | 'no-holder';

export type ExceptionDecision = 'include' | 'exclude' | 'estimate' | 'no-interest' | 'acknowledge';

export interface BillingException {
  id: string;
  accountId: string;
  accountNo: string;
  kind: ExceptionKind;
  /** What's unusual, in words. */
  detail: string;
  /** The decisions that make sense for this kind; the first is the usual one. */
  options: ExceptionDecision[];
  decision?: ExceptionDecision;
  decidedBy?: string;
  note?: string;
}

export const EXCEPTION_LABELS: Record<ExceptionKind, string> = {
  'meter-missing': 'No meter reading',
  'unusual-reading': 'Unusual meter reading',
  'levy-changed': 'Levy changed',
  arrangement: 'Payment arrangement',
  'handed-over': 'With the attorney',
  'large-credit': 'Large credit balance',
  'no-holder': 'No owner on record',
};

export const DECISION_LABELS: Record<ExceptionDecision, string> = {
  include: 'Bill as calculated',
  exclude: 'Leave out of this run',
  estimate: 'Bill an estimate (3-month average)',
  'no-interest': 'Bill, but no interest',
  acknowledge: 'Noted — bill as calculated',
};

export interface BillingEvent {
  id: string;
  at: string;
  kind: 'stage' | 'exception' | 'approval' | 'posting' | 'statements' | 'comment';
  text: string;
  by: string;
}

export interface BillingRun {
  id: string;
  version: number;
  /** "BR-KC-2611" */
  ref: string;
  schemeId: string;
  /** "2026-11" */
  period: string;
  stage: BillingStage;
  createdAt: string;
  createdBy: string;
  lines: BillingLine[];
  exceptions: BillingException[];
  /** Last month's total, for the "vs last month" check. */
  previousTotal?: number;
  approvalWorkItemId?: string;
  approval?: { decidedAt: string; decidedBy: string; comment?: string };
  posted?: { at: string; by: string; accounts: number; total: number };
  statements?: { at: string; by: string; email: number; post: number; portal: number; template: DocumentTemplateRef };
  cancelled?: { at: string; by: string; reason: string };
  events: BillingEvent[];
}

export function runTotal(run: Pick<BillingRun, 'lines'>): number {
  return Math.round(run.lines.filter((l) => !l.excluded).reduce((s, l) => s + l.total, 0) * 100) / 100;
}

export function openExceptions(run: Pick<BillingRun, 'exceptions'>): BillingException[] {
  return run.exceptions.filter((e) => !e.decision);
}

export type BillingAction =
  | { type: 'decide'; exceptionId: string; decision: ExceptionDecision; note?: string }
  | { type: 'send-for-approval' }
  | { type: 'post' }
  | { type: 'send-statements' }
  | { type: 'cancel'; reason: string }
  | { type: 'comment'; text: string };

export interface NewBillingRun {
  schemeId: string;
  period: string;
}

// ---------------------------------------------------------------- Read models

export interface BillingRunSummary {
  run: BillingRun;
  scheme: Scheme;
  total: number;
  accounts: number;
  openExceptions: number;
}

/** Levies & billing: where each scheme stands. */
export interface SchemeBillingStatus {
  scheme: Scheme;
  /** Monthly levy roll (levies only), from the units. */
  levyRoll: number;
  lastPosted?: { period: string; total: number; at: string };
  current?: BillingRunSummary;
  /** The period the next run should bill. */
  nextPeriod: string;
  /** The scheme recovers water from owners (meter readings, docs/22 §2). */
  recoversWater?: boolean;
}
