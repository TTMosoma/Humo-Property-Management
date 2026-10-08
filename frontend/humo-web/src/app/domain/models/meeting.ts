import { DocumentTemplateRef } from './document';
import { Scheme } from './scheme';
import { WorkItem } from './work-item';

/**
 * Governance (Slice C): Meeting → Resolution → Action → Completion.
 *
 * - A meeting runs through one lifecycle: draft agenda → notice sent → pack
 *   ready → held → minutes draft → minutes approved.
 * - Resolutions are captured in the meeting (or passed in writing between
 *   meetings through the Approval engine).
 * - Every action a resolution creates is a Task in the Attention model, so it
 *   can't rot in a register nobody opens: completing the task completes the
 *   action, and the last action completes the resolution.
 * - The resolutions register is a view over resolutions, never a second place
 *   to type them in.
 */

export type MeetingType = 'trustee' | 'agm' | 'sgm';

export const MEETING_TYPE_LABELS: Record<MeetingType, string> = {
  trustee: 'Trustee meeting',
  agm: 'Annual general meeting',
  sgm: 'Special general meeting',
};

/**
 * Days of written notice before the meeting. Prototype values, set by the
 * scheme's rules in practice (STSMA management rules: 14 days for general
 * meetings; trustee meetings per the scheme's own rules).
 */
export const NOTICE_DAYS: Record<MeetingType, number> = { trustee: 7, agm: 14, sgm: 14 };

export type MeetingStage = 'draft' | 'notice-sent' | 'pack-ready' | 'held' | 'minutes-draft' | 'minutes-approved' | 'cancelled';

export const MEETING_STAGES: { id: Exclude<MeetingStage, 'cancelled'>; label: string }[] = [
  { id: 'draft', label: 'Agenda' },
  { id: 'notice-sent', label: 'Notice sent' },
  { id: 'pack-ready', label: 'Pack ready' },
  { id: 'held', label: 'Held' },
  { id: 'minutes-draft', label: 'Minutes draft' },
  { id: 'minutes-approved', label: 'Minutes approved' },
];

export const MEETING_STAGE_LABELS: Record<MeetingStage, string> = {
  draft: 'Draft agenda',
  'notice-sent': 'Notice sent',
  'pack-ready': 'Pack ready',
  held: 'Held',
  'minutes-draft': 'Minutes in draft',
  'minutes-approved': 'Minutes approved',
  cancelled: 'Cancelled',
};

export interface AgendaItem {
  id: string;
  title: string;
  /** What the item is about; becomes the starting point of its minute. */
  notes?: string;
  /** Discussion recorded at the meeting. */
  minute?: string;
}

export type AttendeeRole = 'chair' | 'trustee' | 'agent' | 'owner';

export interface Attendee {
  /** Person id (trustees, owners) or identity id (agency staff). */
  id: string;
  name: string;
  role: AttendeeRole;
  /** e.g. "Chairperson", "Treasurer", "Portfolio Manager". */
  capacity: string;
  /** Recorded when the meeting is held. */
  present?: boolean;
  /** Votes at this meeting (trustees at trustee meetings; at general meetings owners vote, counted in `held`). */
  votes: boolean;
}

export interface MeetingEvent {
  id: string;
  at: string;
  kind: 'stage' | 'comment' | 'notice' | 'resolution' | 'document' | 'action';
  text: string;
  by: string;
}

export interface Meeting {
  id: string;
  /** Concurrency token. */
  version: number;
  /** "MTG-KC-0926" */
  ref: string;
  schemeId: string;
  type: MeetingType;
  title: string;
  scheduledFor: string;
  venue: string;
  stage: MeetingStage;
  agenda: AgendaItem[];
  attendees: Attendee[];
  /** The documents that make up the meeting pack (names, from the document library later). */
  pack: string[];
  notice?: { sentAt: string; sentBy: string; recipients: number; document: DocumentTemplateRef };
  /** Voters present (trustees, or owners in person and by proxy at general meetings) against the quorum needed. */
  held?: { at: string; quorate: boolean; present: number; voters: number; required: number };
  minutes?: {
    draftedAt: string;
    draftedBy: string;
    approvalWorkItemId?: string;
    approvedAt?: string;
    approvedBy?: string;
    document?: DocumentTemplateRef;
  };
  cancelled?: { at: string; by: string; reason: string };
  events: MeetingEvent[];
}

// ---------------------------------------------------------------- Resolutions & actions

export type ResolutionOutcome = 'proposed' | 'passed' | 'not-passed' | 'withdrawn';

export interface ResolutionAction {
  id: string;
  /** The Task that carries it. Its status is the action's status. */
  workItemId: string;
  title: string;
  assigneeId: string | null;
  dueAt: string;
}

export interface Resolution {
  id: string;
  version: number;
  /** "RES-KC-14": numbered per scheme. */
  ref: string;
  number: number;
  schemeId: string;
  /** Passed at a meeting, or in writing between meetings (round-robin, through Approvals). */
  mode: 'meeting' | 'written';
  meetingId?: string;
  agendaItemId?: string;
  title: string;
  text: string;
  outcome: ResolutionOutcome;
  votes?: { for: number; against: number; abstain: number };
  proposedAt: string;
  proposedBy: string;
  decidedAt?: string;
  decidedBy?: string;
  /** Written resolutions: the approval the trustees decide. */
  approvalWorkItemId?: string;
  /** Actions to create once it passes (written resolutions keep them here until then). */
  actions: ResolutionAction[];
  plannedActions?: NewAction[];
}

/** Where a resolution stands, including its actions. */
export type ResolutionProgress = 'awaiting-decision' | 'not-passed' | 'withdrawn' | 'no-actions' | 'in-progress' | 'completed';

export const RESOLUTION_PROGRESS_LABELS: Record<ResolutionProgress, string> = {
  'awaiting-decision': 'Awaiting trustees',
  'not-passed': 'Not passed',
  withdrawn: 'Withdrawn',
  'no-actions': 'Passed',
  'in-progress': 'Actions open',
  completed: 'Completed',
};

export function resolutionProgress(r: Resolution, work: Pick<WorkItem, 'id' | 'status'>[]): ResolutionProgress {
  if (r.outcome === 'proposed') return 'awaiting-decision';
  if (r.outcome === 'not-passed') return 'not-passed';
  if (r.outcome === 'withdrawn') return 'withdrawn';
  if (!r.actions.length) return 'no-actions';
  const done = r.actions.filter((a) => work.find((w) => w.id === a.workItemId)?.status === 'done').length;
  return done === r.actions.length ? 'completed' : 'in-progress';
}

/** Quorum: a majority of those who vote (trustees), or a third at general meetings. Prototype rule; the scheme's rules decide. */
export function quorumRequired(type: MeetingType, voters: number): number {
  return type === 'trustee' ? Math.floor(voters / 2) + 1 : Math.ceil(voters / 3);
}

/** The earliest date a meeting can be held if notice goes out now. */
export function earliestMeetingDate(type: MeetingType, from = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + NOTICE_DAYS[type]);
  return d;
}

// ---------------------------------------------------------------- Inputs & commands

export interface NewAction {
  title: string;
  assigneeId: string | null;
  dueAt: string;
}

export interface NewMeeting {
  schemeId: string;
  type: MeetingType;
  title?: string;
  scheduledFor: string;
  venue: string;
}

export interface NewResolutionInput {
  title: string;
  text: string;
  agendaItemId?: string;
  outcome: 'passed' | 'not-passed';
  votes: { for: number; against: number; abstain: number };
  actions: NewAction[];
}

export interface WrittenResolutionInput {
  schemeId: string;
  title: string;
  text: string;
  actions: NewAction[];
}

export type MeetingAction =
  | { type: 'add-agenda-item'; title: string; notes?: string }
  | { type: 'remove-agenda-item'; itemId: string }
  | { type: 'reschedule'; scheduledFor: string; venue: string }
  | { type: 'send-notice' }
  | { type: 'pack-ready'; documents: string[] }
  /** Trustees present by id; general meetings also count owners present in person or by proxy. */
  | { type: 'record-attendance'; presentIds: string[]; ownersPresent?: number }
  | { type: 'record-minute'; itemId: string; minute: string }
  | { type: 'add-resolution'; resolution: NewResolutionInput }
  | { type: 'send-minutes-for-approval' }
  | { type: 'cancel'; reason: string }
  | { type: 'comment'; text: string };

// ---------------------------------------------------------------- Read models

export interface Assignee {
  id: string;
  name: string;
  kind: 'staff' | 'trustee';
}

export interface ActionView {
  action: ResolutionAction;
  assigneeName: string;
  status: 'open' | 'done';
  completedAt?: string;
  overdue: boolean;
}

export interface ResolutionView {
  resolution: Resolution;
  scheme: Scheme;
  meeting?: Pick<Meeting, 'id' | 'ref' | 'title' | 'scheduledFor' | 'type'>;
  actions: ActionView[];
  progress: ResolutionProgress;
}

export interface MeetingSummary {
  meeting: Meeting;
  scheme: Scheme;
  resolutions: number;
  openActions: number;
}

export interface MeetingDetail extends MeetingSummary {
  resolutionViews: ResolutionView[];
  /** Who actions can be given to: the agency's staff on the scheme and trustees with a Humo sign-in. */
  assignees: Assignee[];
  /** The agency managing the scheme (for documents). */
  agencyName: string;
}
