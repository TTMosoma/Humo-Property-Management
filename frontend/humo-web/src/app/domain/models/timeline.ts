/**
 * Timeline (pattern P4): everything that happened to a record, in one stream —
 * money, messages, maintenance, documents, notes and status changes.
 */
export type TimelineKind = 'payment' | 'charge' | 'message' | 'call' | 'note' | 'maintenance' | 'document' | 'statement' | 'status';

export interface TimelineEvent {
  id: string;
  /** ISO timestamp. */
  at: string;
  /** Only the date is known (a back-dated payment, when someone became the owner): no time is shown. */
  allDay?: boolean;
  kind: TimelineKind;
  title: string;
  detail?: string;
  actor?: string;
  amount?: number;
  link?: string;
  /** A file with the entry, e.g. an owner's proof of payment, opened through `TimelineDataSource.fileLink`. */
  fileId?: string;
  fileName?: string;
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
