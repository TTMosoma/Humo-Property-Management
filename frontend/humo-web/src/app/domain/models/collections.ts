import { Account, Ageing, TrustAccount } from './account';
import { DocumentTemplateRef } from './document';
import { Person } from './person';
import { Scheme } from './scheme';
import { Unit } from './unit';

/**
 * Credit control (review finding F13): arrears are chased as a process, not
 * read off an ageing table. Each account in arrears has a collection stage:
 *
 *   Not started → Reminder → Final demand → Letter of demand → Handed over
 *   side states: Payment arrangement · Disputed
 *
 * Each stage has a next action and a due date (a follow-up Task in the
 * Attention model) and a letter (a template-driven document). A letter of
 * demand needs the trustees' approval first. Ageing is a filter and a chart.
 */

export type CollectionStage = 'not-started' | 'reminder' | 'final-demand' | 'letter-of-demand' | 'handed-over' | 'arrangement' | 'disputed';

export const COLLECTION_STAGES: { id: Exclude<CollectionStage, 'arrangement' | 'disputed'>; label: string }[] = [
  { id: 'not-started', label: 'Not started' },
  { id: 'reminder', label: 'Reminder' },
  { id: 'final-demand', label: 'Final demand' },
  { id: 'letter-of-demand', label: 'Letter of demand' },
  { id: 'handed-over', label: 'Handed over' },
];

export const COLLECTION_STAGE_LABELS: Record<CollectionStage, string> = {
  'not-started': 'Not started',
  reminder: 'Reminder sent',
  'final-demand': 'Final demand sent',
  'letter-of-demand': 'Letter of demand sent',
  'handed-over': 'Handed over',
  arrangement: 'Payment arrangement',
  disputed: 'Disputed',
};


/** Letters that go to the owner. Each is a payment-notice document. */
export type LetterKind = 'reminder' | 'final-demand' | 'letter-of-demand';

export interface CollectionStep {
  id: string;
  at: string;
  by: string;
  /** What happened, in words. */
  text: string;
  stage: CollectionStage;
  /** A letter sent at this step, with the template version it was issued with. */
  letter?: { kind: LetterKind; amount: number; ageing: Ageing; dueBy: string; channel: 'email' | 'post' | 'sms'; template: DocumentTemplateRef };
}

export interface PaymentArrangement {
  instalment: number;
  /** Day of the month the instalment is due. */
  day: number;
  months: number;
  startedAt: string;
  missed: number;
}

export interface CollectionCase {
  /** One case per account. */
  accountId: string;
  version: number;
  schemeId: string;
  stage: CollectionStage;
  /** The stage before an arrangement or dispute, to return to. */
  previousStage?: CollectionStage;
  steps: CollectionStep[];
  arrangement?: PaymentArrangement;
  dispute?: { reason: string; at: string; by: string };
  /** A letter of demand waiting for, or approved by, the trustees. */
  demandApproval?: { workItemId: string; status: 'pending' | 'approved' | 'rejected'; decidedBy?: string; decidedAt?: string };
  /** The open follow-up Task. */
  followUpWorkItemId?: string;
}

export type CollectionAction =
  | { type: 'send-letter'; kind: LetterKind; channel: 'email' | 'post' | 'sms' }
  | { type: 'request-demand-approval' }
  | { type: 'hand-over'; attorney: string }
  | { type: 'arrangement'; instalment: number; day: number; months: number }
  | { type: 'missed-instalment' }
  | { type: 'dispute'; reason: string }
  | { type: 'resolve-dispute'; outcome: 'resume' | 'written-off-in-part'; note: string }
  | { type: 'note'; text: string };

// ---------------------------------------------------------------- Read models

export interface NextAction {
  label: string;
  dueAt: string;
  overdue: boolean;
}

export interface CollectionView {
  case: CollectionCase;
  account: Account;
  unit: Unit;
  scheme: Scheme;
  holder: Person;
  /** Days the oldest unpaid amount has been outstanding (from the ageing). */
  daysInArrears: number;
  overdueAmount: number;
  next?: NextAction;
  lastStep?: CollectionStep;
  assigneeName: string;
  /** For the letters: where to pay, and who is writing. */
  payTo: TrustAccount;
  agencyName: string;
  /** Days between letters (Settings › Billing configuration). */
  stepDays: number;
}

export function overdueOf(a: Ageing): number {
  return Math.round((a.d30 + a.d60 + a.d90 + a.d120) * 100) / 100;
}

export function daysInArrears(a: Ageing): number {
  return a.d120 > 0 ? 120 : a.d90 > 0 ? 90 : a.d60 > 0 ? 60 : a.d30 > 0 ? 30 : 0;
}

export type AgeingBucket = 'd30' | 'd60' | 'd90' | 'd120';

export const AGEING_LABELS: Record<AgeingBucket, string> = { d30: '30 days', d60: '60 days', d90: '90 days', d120: '120+ days' };
