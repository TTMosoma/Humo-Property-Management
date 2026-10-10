/**
 * Timeline (pattern P4): everything that happened to a record, in one stream —
 * money, messages, maintenance, documents, notes and status changes.
 */
export type TimelineKind = 'payment' | 'charge' | 'message' | 'call' | 'note' | 'maintenance' | 'document' | 'statement' | 'status';

export interface TimelineEvent {
  id: string;
  /** ISO timestamp. */
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  actor?: string;
  amount?: number;
  link?: string;
}

/** A note or call log entered by staff. */
export interface Note {
  id: string;
  /** What it is attached to, e.g. { unitId } or { personId }. */
  unitId?: string;
  personId?: string;
  kind: 'call' | 'note';
  text: string;
  author: string;
  at: string;
}
