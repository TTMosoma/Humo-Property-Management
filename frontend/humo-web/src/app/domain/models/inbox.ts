import { Account } from './account';
import { JobSummary } from '../ports/maintenance-data-sources';
import { Person } from './person';
import { Scheme } from './scheme';
import { Channel } from './settings';
import { Unit } from './unit';

/**
 * The Inbox: conversations with owners, tenants and trustees, each linked to
 * the person, their unit and scheme — so the reply is written with their
 * balance and open jobs in view. A conversation waiting for the agency is an
 * `owner-message` work item (the Attention model counts it like any queue).
 */

export type ConversationStatus = 'open' | 'waiting' | 'closed';

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  open: 'Needs a reply',
  waiting: 'Waiting for them',
  closed: 'Closed',
};

export interface ConversationMessage {
  id: string;
  at: string;
  from: 'them' | 'us';
  /** Who wrote it. */
  by: string;
  body: string;
  /** How it came in or went out. */
  channel: Channel;
  /** Our replies are in Sent too. */
  sentId?: string;
}

export interface Conversation {
  id: string;
  version: number;
  /** "MSG-5521" */
  ref: string;
  schemeId: string;
  personId: string;
  unitId?: string;
  subject: string;
  status: ConversationStatus;
  assigneeId: string | null;
  /** The open queue item while it needs a reply. */
  workItemId?: string;
  messages: ConversationMessage[];
  /** A job or Task it was turned into. */
  links: { label: string; route: string }[];
}

export interface ConversationView {
  conversation: Conversation;
  person: Person;
  scheme: Scheme;
  unit?: Unit;
  account?: Account;
  openJobs: JobSummary[];
  assigneeName: string;
  lastAt: string;
}

export type ConversationAction =
  | { type: 'reply'; body: string; channel?: Channel; close?: boolean }
  | { type: 'assign'; assigneeId: string | null }
  | { type: 'close' }
  | { type: 'reopen' }
  | { type: 'to-job'; title: string; location: string }
  | { type: 'to-task'; title: string; dueAt: string };

/** A resident writing to the managing agent from the portal. */
export interface ResidentMessage {
  subject: string;
  body: string;
  /** Add to this conversation instead of starting one. */
  conversationId?: string;
}
