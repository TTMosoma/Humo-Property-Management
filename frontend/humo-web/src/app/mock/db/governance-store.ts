import { Injectable, inject } from '@angular/core';
import {
  AGENCY_STAFF,
  ActionView,
  Assignee,
  Attendee,
  DocumentTemplateRef,
  DocumentType,
  FieldErrors,
  MEETING_STAGE_LABELS,
  MEETING_TYPE_LABELS,
  Meeting,
  MeetingAction,
  MeetingDetail,
  MeetingEvent,
  MeetingSummary,
  NOTICE_DAYS,
  NewAction,
  NewMeeting,
  NewResolutionInput,
  Resolution,
  ResolutionView,
  WorkItem,
  WrittenResolutionInput,
  activeAssignments,
  earliestMeetingDate,
  quorumRequired,
  resolutionProgress,
  entitlementSet,
} from '../../domain';
import { formatDate } from '../../ui/format/money';
import { simulationStorage } from '../simulation/simulation-storage';
import { StaffDirectory } from './staff-directory';
import { AccessStore } from './access-store';
import { DocumentStore } from './document-store';
import { MockDb } from './mock-db';
import { OrganisationStore } from './organisation-store';
import { PlatformStore } from './platform-store';
import { seedGovernance } from './seed-governance';

/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface GovernanceSnapshot {
  meetings: Meeting[];
  resolutions: Resolution[];
  seq: number;
}

const ACTION_DAY = 86_400_000;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Governance "backend" for the prototype: meetings, resolutions and their
 * actions, with the lifecycle rules the API will enforce. Actions and
 * approvals live in MockDb's work items (the Attention model), so Tasks,
 * Approvals, badges and meeting pages always agree.
 */
@Injectable({ providedIn: 'root' })
export class GovernanceStore {
  private readonly directory = inject(StaffDirectory);
  private readonly db = inject(MockDb);
  private readonly access = inject(AccessStore);
  private readonly orgs = inject(OrganisationStore);
  private readonly docs = inject(DocumentStore);
  private readonly platform = inject(PlatformStore);

  meetings: Meeting[];
  resolutions: Resolution[];
  private seq: number;

  constructor() {
    const saved = simulationStorage.load<GovernanceSnapshot>('governance');
    if (saved) {
      this.meetings = saved.meetings;
      this.resolutions = saved.resolutions;
      this.seq = saved.seq;
    } else {
      const seed = seedGovernance(this.db);
      this.meetings = seed.meetings;
      this.resolutions = seed.resolutions;
      this.seq = 100;
      // Their actions and pending approvals are work items in the Attention model:
      // saved together, so a reload never keeps the meetings without their tasks.
      seed.work.forEach((w) => this.db.addWork(w));
      this.commit();
    }
    this.db.workHooks.push((before, after) => this.onWork(before, after));
  }

  // =================================================================== Reads

  summary(m: Meeting): MeetingSummary {
    const res = this.resolutions.filter((r) => r.meetingId === m.id);
    return {
      meeting: m,
      scheme: this.db.scheme(m.schemeId),
      resolutions: res.filter((r) => r.outcome !== 'withdrawn').length,
      openActions: res.flatMap((r) => r.actions).filter((a) => this.work(a.workItemId)?.status === 'open').length,
    };
  }

  detail(m: Meeting): MeetingDetail {
    const scheme = this.db.scheme(m.schemeId);
    return {
      ...this.summary(m),
      resolutionViews: this.resolutions.filter((r) => r.meetingId === m.id).sort((a, b) => a.number - b.number).map((r) => this.view(r)),
      assignees: this.assignees(m.schemeId),
      agencyName: this.orgs.get(scheme.organisationId)?.name ?? '',
    };
  }

  view(r: Resolution): ResolutionView {
    const m = r.meetingId ? this.meetings.find((x) => x.id === r.meetingId) : undefined;
    const now = Date.now();
    const actions: ActionView[] = r.actions.map((a) => {
      const w = this.work(a.workItemId);
      const done = w?.status === 'done';
      return { action: a, assigneeName: this.directory.name(a.assigneeId), status: done ? 'done' : 'open', completedAt: done ? w?.decidedAt : undefined, overdue: !done && new Date(a.dueAt).getTime() < now };
    });
    return {
      resolution: r,
      scheme: this.db.scheme(r.schemeId),
      meeting: m ? { id: m.id, ref: m.ref, title: m.title, scheduledFor: m.scheduledFor, type: m.type } : undefined,
      actions,
      progress: resolutionProgress(r, this.db.workItems),
    };
  }

  /** Agency staff covering the scheme, and trustees who have a Humo sign-in. */
  assignees(schemeId: string): Assignee[] {
    const scheme = this.db.scheme(schemeId);
    const staff = this.access
      .identities()
      .filter((i) => i.status === 'active' && i.staffId)
      .filter((i) =>
        activeAssignments(i).some(
          (a) => AGENCY_STAFF.includes(a.role) && a.scope.organisationId === scheme.organisationId && (a.scope.type === 'organisation' || a.scope.schemeIds.includes(schemeId)),
        ),
      )
      .map((i): Assignee => ({ id: i.staffId!, name: i.name, kind: 'staff' }));
    const trusteePersons = new Set(this.db.trustees(schemeId).map((t) => t.person.id));
    const trustees = this.access
      .identities()
      .filter((i) => i.status === 'active' && i.personId && trusteePersons.has(i.personId))
      .map((i): Assignee => ({ id: i.id, name: i.name, kind: 'trustee' }));
    return [...staff, ...trustees];
  }

  // =================================================================== Commands

  create(input: NewMeeting, by: string): string {
    const scheme = this.db.scheme(input.schemeId);
    const id = `mtg-${++this.seq}`;
    const code = scheme.code;
    const meeting: Meeting = {
      id,
      version: 1,
      ref: `MTG-${code}-${String(this.seq).padStart(3, '0')}`,
      schemeId: scheme.id,
      type: input.type,
      title: input.title?.trim() || `${MEETING_TYPE_LABELS[input.type]} — ${new Date(input.scheduledFor).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}`,
      scheduledFor: input.scheduledFor,
      venue: input.venue.trim(),
      stage: 'draft',
      agenda: this.standardAgenda(input.type),
      attendees: this.attendeesFor(scheme.id, input.type),
      pack: [],
      events: [],
    };
    this.log(meeting, 'stage', `Scheduled for ${formatDate(input.scheduledFor)} at ${meeting.venue}`, by);
    this.meetings = [meeting, ...this.meetings];
    this.commit();
    return id;
  }

  /** The API's rules for a lifecycle command: what each stage allows. */
  check(m: Meeting, action: MeetingAction): FieldErrors | null {
    const e: FieldErrors = {};
    const stage = m.stage;
    const at = (stages: Meeting['stage'][], what: string) => {
      if (!stages.includes(stage)) e['stage'] = `${what} isn’t possible while the meeting is ${MEETING_STAGE_LABELS[stage].toLowerCase()}.`;
    };
    switch (action.type) {
      case 'add-agenda-item':
        at(['draft'], 'Changing the agenda');
        if (!action.title.trim()) e['title'] = 'Give the item a title.';
        break;
      case 'remove-agenda-item':
        at(['draft'], 'Changing the agenda');
        break;
      case 'reschedule':
        at(['draft'], 'Rescheduling');
        if (Number.isNaN(Date.parse(action.scheduledFor))) e['date'] = 'Choose a date.';
        if (!action.venue.trim()) e['venue'] = 'Where is it held?';
        break;
      case 'send-notice': {
        at(['draft'], 'Sending notice');
        if (!m.agenda.length) e['agenda'] = 'Add at least one agenda item first.';
        const earliest = earliestMeetingDate(m.type);
        if (new Date(m.scheduledFor) < earliest) {
          e['scheduledFor'] = `${MEETING_TYPE_LABELS[m.type]}s need ${NOTICE_DAYS[m.type]} days’ notice: the earliest date is ${formatDate(earliest.toISOString())}. Reschedule first.`;
        }
        break;
      }
      case 'pack-ready':
        at(['notice-sent'], 'Finalising the pack');
        if (!action.documents.length) e['documents'] = 'List the documents in the pack.';
        break;
      case 'record-attendance': {
        at(['notice-sent', 'pack-ready'], 'Recording the meeting');
        const q = this.quorum(m, action.presentIds, action.ownersPresent);
        if (q.present < q.required) e['presentIds'] = `Not quorate: ${q.present} of ${q.voters} present, ${q.required} needed. The meeting can’t take decisions; adjourn it and reschedule.`;
        break;
      }
      case 'record-minute':
        at(['held', 'minutes-draft'], 'Recording minutes');
        break;
      case 'add-resolution': {
        at(['held', 'minutes-draft'], 'Recording a resolution');
        const r = action.resolution;
        if (!r.title.trim()) e['title'] = 'Give the resolution a short title.';
        if (r.text.trim().length < 10) e['text'] = 'Write the resolution as it was passed.';
        const voters = m.held?.present ?? 0;
        const cast = r.votes.for + r.votes.against + r.votes.abstain;
        if ([r.votes.for, r.votes.against, r.votes.abstain].some((v) => v < 0 || !Number.isInteger(v))) e['for'] = 'Votes are whole numbers.';
        else if (cast > voters) e['for'] = `Only ${voters} voters were present.`;
        else if (r.outcome === 'passed' && r.votes.for <= r.votes.against) e['outcome'] = 'A resolution passes with more votes for than against.';
        r.actions.forEach((a, i) => {
          if (!a.title.trim()) e[`action${i}`] = 'Describe the action.';
          if (Number.isNaN(Date.parse(a.dueAt))) e[`due${i}`] = 'Give it a due date.';
        });
        break;
      }
      case 'send-minutes-for-approval':
        at(['held', 'minutes-draft'], 'Sending minutes for approval');
        if (m.minutes?.approvalWorkItemId && this.work(m.minutes.approvalWorkItemId)?.status === 'open') e['stage'] = 'The minutes are already with the trustees.';
        break;
      case 'cancel':
        at(['draft', 'notice-sent', 'pack-ready'], 'Cancelling');
        if (action.reason.trim().length < 5) e['reason'] = 'Give a short reason; it goes to everyone who received notice.';
        break;
      case 'comment':
        if (!action.text.trim()) e['text'] = 'Write a comment.';
        break;
    }
    return Object.keys(e).length ? e : null;
  }

  act(id: string, action: MeetingAction, by: string): void {
    const m = this.meetings.find((x) => x.id === id)!;
    const scheme = this.db.scheme(m.schemeId);
    switch (action.type) {
      case 'add-agenda-item':
        m.agenda.push({ id: `ag-${++this.seq}`, title: action.title.trim(), notes: action.notes?.trim() || undefined });
        this.log(m, 'stage', `Agenda item added: ${action.title.trim()}`, by);
        break;
      case 'remove-agenda-item': {
        const item = m.agenda.find((a) => a.id === action.itemId);
        m.agenda = m.agenda.filter((a) => a.id !== action.itemId);
        if (item) this.log(m, 'stage', `Agenda item removed: ${item.title}`, by);
        break;
      }
      case 'reschedule':
        m.scheduledFor = action.scheduledFor;
        m.venue = action.venue.trim();
        this.log(m, 'stage', `Moved to ${formatDate(action.scheduledFor)} at ${m.venue}`, by);
        break;
      case 'send-notice': {
        const recipients = m.type === 'trustee' ? m.attendees.filter((a) => a.role !== 'agent').length : scheme.unitCount;
        m.notice = { sentAt: new Date().toISOString(), sentBy: by, recipients, document: this.templateFor(scheme.organisationId, 'meeting-notice') };
        m.stage = 'notice-sent';
        this.log(m, 'notice', `Notice sent to ${recipients} ${m.type === 'trustee' ? 'trustees' : 'owners'} by email and the portal, ${NOTICE_DAYS[m.type]}+ days ahead`, by);
        // An AGM notice satisfies the scheme's "set the AGM date" compliance item.
        if (m.type === 'agm') this.db.resolveWork(`CMP-${scheme.code}-AGM`, ['compliance-due'], by);
        break;
      }
      case 'pack-ready':
        m.pack = action.documents;
        m.stage = 'pack-ready';
        this.log(m, 'document', `Meeting pack ready: ${action.documents.join(', ')}`, by);
        break;
      case 'record-attendance': {
        m.attendees = m.attendees.map((a) => ({ ...a, present: action.presentIds.includes(a.id) }));
        const q = this.quorum(m, action.presentIds, action.ownersPresent);
        m.held = { at: new Date().toISOString(), quorate: true, ...q };
        m.stage = 'held';
        this.log(m, 'stage', `Meeting held: ${q.present} of ${q.voters} ${m.type === 'trustee' ? 'trustees' : 'owners (in person or by proxy)'} present, quorate`, by);
        break;
      }
      case 'record-minute': {
        const item = m.agenda.find((a) => a.id === action.itemId);
        if (item) item.minute = action.minute.trim() || undefined;
        this.startMinutes(m, by);
        break;
      }
      case 'add-resolution':
        this.addResolution(m, action.resolution, by);
        this.startMinutes(m, by);
        break;
      case 'send-minutes-for-approval': {
        this.startMinutes(m, by);
        const workId = `w-${m.id}-minutes-${++this.seq}`;
        this.db.addWork({
          id: workId,
          ref: m.ref,
          kind: 'approval',
          type: 'minutes-approval',
          title: `Approve the minutes: ${m.title}`,
          detail: `${plural(this.resolutions.filter((r) => r.meetingId === m.id).length, 'resolution')} · held ${formatDate(m.held?.at ?? m.scheduledFor)}`,
          schemeId: m.schemeId,
          createdAt: new Date().toISOString(),
          dueAt: new Date(Date.now() + 7 * ACTION_DAY).toISOString(),
          assigneeId: null,
          approverRoles: ['trustee', 'agency-admin'],
          evidence: ['Draft minutes', ...m.pack],
          status: 'open',
          route: `/governance/meetings/${m.id}`,
        });
        m.minutes = { ...m.minutes!, approvalWorkItemId: workId };
        this.log(m, 'stage', 'Minutes sent to the trustees for approval', by);
        break;
      }
      case 'cancel':
        m.stage = 'cancelled';
        m.cancelled = { at: new Date().toISOString(), by, reason: action.reason.trim() };
        this.log(m, 'stage', `Cancelled: ${action.reason.trim()}${m.notice ? ' (everyone who received notice is told)' : ''}`, by);
        break;
      case 'comment':
        this.log(m, 'comment', action.text.trim(), by);
        break;
    }
    m.version++;
    this.commit();
  }

  /**
   * Puts a matter on a draft meeting's agenda, reusing the standard item for it
   * when the agenda already has one (e.g. an AGM's "Budget and levies for the
   * coming year"). Returns the agenda item's id.
   */
  placeOnAgenda(meetingId: string, existing: RegExp, title: string, notes: string, by: string, skip: string[] = []): string {
    const m = this.meetings.find((x) => x.id === meetingId)!;
    const item = m.agenda.find((a) => existing.test(a.title) && !skip.includes(a.id));
    if (!item) {
      this.act(meetingId, { type: 'add-agenda-item', title, notes }, by);
      return m.agenda.at(-1)!.id;
    }
    item.notes = [item.notes, notes].filter(Boolean).join(' ');
    m.version++;
    this.log(m, 'stage', `Agenda item updated: ${item.title} — ${title}`, by);
    this.commit();
    return item.id;
  }

  checkWritten(input: WrittenResolutionInput): FieldErrors | null {
    const e: FieldErrors = {};
    if (!input.title.trim()) e['title'] = 'Give the resolution a short title.';
    if (input.text.trim().length < 10) e['text'] = 'Write the resolution the trustees are asked to pass.';
    if (!this.db.trustees(input.schemeId).length) e['schemeId'] = 'This scheme has no trustees on record.';
    input.actions.forEach((a, i) => {
      if (!a.title.trim()) e[`action${i}`] = 'Describe the action.';
    });
    return Object.keys(e).length ? e : null;
  }

  /** A round-robin resolution: the trustees decide it in Approvals; its actions start when it passes. */
  proposeWritten(input: WrittenResolutionInput, by: string): string {
    const scheme = this.db.scheme(input.schemeId);
    const number = this.nextNumber(scheme.id);
    const ref = `RES-${scheme.code}-${number}`;
    const workId = `w-${ref.toLowerCase()}`;
    const trustees = this.db.trustees(scheme.id).length;
    this.resolutions = [
      {
        id: `res-${++this.seq}`,
        version: 1,
        ref,
        number,
        schemeId: scheme.id,
        mode: 'written',
        title: input.title.trim(),
        text: input.text.trim(),
        outcome: 'proposed',
        proposedAt: new Date().toISOString(),
        proposedBy: by,
        approvalWorkItemId: workId,
        actions: [],
        plannedActions: input.actions,
      },
      ...this.resolutions,
    ];
    this.db.addWork({
      id: workId,
      ref,
      kind: 'approval',
      type: 'resolution-approval',
      title: `Written resolution: ${input.title.trim()}`,
      detail: `Round-robin to ${trustees} trustees of ${scheme.name}`,
      schemeId: scheme.id,
      createdAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 5 * ACTION_DAY).toISOString(),
      assigneeId: null,
      approverRoles: ['trustee'],
      evidence: [input.text.trim()],
      status: 'open',
      route: '/governance/resolutions',
    });
    this.commit();
    return ref;
  }

  // =================================================================== Consequences of work done elsewhere

  private onWork(before: WorkItem, after: WorkItem): void {
    const by = after.decidedBy ?? 'Someone';
    if (after.type === 'minutes-approval') {
      const m = this.meetings.find((x) => x.minutes?.approvalWorkItemId === after.id);
      if (!m) return;
      if (after.status === 'approved') {
        m.minutes = { ...m.minutes!, approvedAt: after.decidedAt, approvedBy: by, document: this.templateFor(this.db.scheme(m.schemeId).organisationId, 'meeting-minutes') };
        m.stage = 'minutes-approved';
        this.log(m, 'stage', `Minutes approved by ${by}`, by);
      } else if (after.status === 'rejected') {
        m.minutes = { ...m.minutes!, approvalWorkItemId: undefined };
        this.log(m, 'stage', `Minutes sent back by ${by}${after.comment ? `: “${after.comment}”` : ''}`, by);
      }
      m.version++;
      this.save();
    } else if (after.type === 'resolution-approval') {
      const r = this.resolutions.find((x) => x.approvalWorkItemId === after.id);
      if (!r || r.outcome !== 'proposed') return;
      r.decidedAt = after.decidedAt;
      r.decidedBy = by;
      r.outcome = after.status === 'approved' ? 'passed' : 'not-passed';
      if (r.outcome === 'passed') r.actions = (r.plannedActions ?? []).map((a) => this.createAction(r, a, '/governance/resolutions'));
      r.plannedActions = undefined;
      r.version++;
      this.save();
    } else if (after.type === 'meeting-action' && before.status !== after.status) {
      const r = this.resolutions.find((x) => x.actions.some((a) => a.workItemId === after.id));
      const m = r?.meetingId ? this.meetings.find((x) => x.id === r.meetingId) : undefined;
      if (r && m) {
        const a = r.actions.find((x) => x.workItemId === after.id)!;
        this.log(m, 'action', after.status === 'done' ? `${r.ref} action done: ${a.title}` : `${r.ref} action reopened: ${a.title}`, by);
        if (resolutionProgress(r, this.db.workItems.map((w) => (w.id === after.id ? after : w))) === 'completed') this.log(m, 'resolution', `${r.ref} completed: every action is done`, by);
        this.save();
      }
    }
  }

  // =================================================================== Internals

  private addResolution(m: Meeting, input: NewResolutionInput, by: string): void {
    const number = this.nextNumber(m.schemeId);
    const scheme = this.db.scheme(m.schemeId);
    const r: Resolution = {
      id: `res-${++this.seq}`,
      version: 1,
      ref: `RES-${scheme.code}-${number}`,
      number,
      schemeId: m.schemeId,
      mode: 'meeting',
      meetingId: m.id,
      agendaItemId: input.agendaItemId,
      title: input.title.trim(),
      text: input.text.trim(),
      outcome: input.outcome,
      votes: input.votes,
      proposedAt: m.held?.at ?? new Date().toISOString(),
      proposedBy: by,
      decidedAt: m.held?.at ?? new Date().toISOString(),
      decidedBy: m.title,
      actions: [],
    };
    if (r.outcome === 'passed') r.actions = input.actions.map((a) => this.createAction(r, a, `/governance/meetings/${m.id}`));
    this.resolutions = [r, ...this.resolutions];
    this.log(m, 'resolution', `${r.ref} ${r.outcome === 'passed' ? 'passed' : 'not passed'} (${input.votes.for}–${input.votes.against}–${input.votes.abstain}): ${r.title}${r.actions.length ? ` · ${r.actions.length} action${r.actions.length > 1 ? 's' : ''} created` : ''}`, by);
  }

  /** An action is a Task: assigned, due, and completed in My work › Tasks. */
  private createAction(r: Resolution, a: NewAction, route: string) {
    const workItemId = `w-${r.ref.toLowerCase()}-${++this.seq}`;
    const m = r.meetingId ? this.meetings.find((x) => x.id === r.meetingId) : undefined;
    this.db.addWork({
      id: workItemId,
      ref: r.ref,
      kind: 'task',
      type: 'meeting-action',
      title: a.title.trim(),
      detail: `${r.ref} · ${m ? `${m.title}` : 'Written resolution'}`,
      schemeId: r.schemeId,
      createdAt: new Date().toISOString(),
      dueAt: a.dueAt,
      assigneeId: a.assigneeId,
      status: 'open',
      route,
    });
    return { id: `act-${++this.seq}`, workItemId, title: a.title.trim(), assigneeId: a.assigneeId, dueAt: a.dueAt };
  }

  private startMinutes(m: Meeting, by: string): void {
    if (m.stage === 'held') {
      m.stage = 'minutes-draft';
      m.minutes = { draftedAt: new Date().toISOString(), draftedBy: by };
      this.log(m, 'stage', 'Minutes started', by);
    }
  }

  /** Trustee meetings: trustees present. General meetings: owners in person or by proxy, one vote per unit (prototype rule). */
  private quorum(m: Meeting, presentIds: string[], ownersPresent = 0): { present: number; voters: number; required: number } {
    const voters = m.type === 'trustee' ? m.attendees.filter((a) => a.votes).length : this.db.scheme(m.schemeId).unitCount;
    const present = m.type === 'trustee' ? m.attendees.filter((a) => a.votes && presentIds.includes(a.id)).length : ownersPresent;
    return { present, voters, required: quorumRequired(m.type, voters) };
  }

  private nextNumber(schemeId: string): number {
    return Math.max(0, ...this.resolutions.filter((r) => r.schemeId === schemeId).map((r) => r.number)) + 1;
  }

  private templateFor(organisationId: string, type: DocumentType): DocumentTemplateRef {
    const ent = entitlementSet(this.platform.customers().find((c) => c.organisationId === organisationId)?.entitlements ?? []);
    return this.docs.issuingTemplate(organisationId, type, ent);
  }

  private standardAgenda(type: Meeting['type']) {
    const items =
      type === 'agm'
        ? ['Quorum and proxies', 'Minutes of the previous AGM', 'Trustees’ report', 'Audited financial statements', 'Budget and levies for the coming year', 'Election of trustees', 'Appointment of the auditor', 'Insurance replacement value']
        : type === 'sgm'
          ? ['Quorum and proxies', 'Special resolution']
          : ['Apologies and quorum', 'Minutes of the previous meeting', 'Financial report and arrears'];
    return items.map((title) => ({ id: `ag-${++this.seq}`, title }));
  }

  private attendeesFor(schemeId: string, type: Meeting['type']): Attendee[] {
    const trustees = this.db.trustees(schemeId).map(
      (t): Attendee => ({ id: t.person.id, name: t.person.displayName, role: t.portfolio === 'Chairperson' ? 'chair' : 'trustee', capacity: t.portfolio, votes: type === 'trustee' }),
    );
    const agent = this.assignees(schemeId).find((a) => a.kind === 'staff');
    return [...trustees, ...(agent ? [{ id: agent.id, name: agent.name, role: 'agent' as const, capacity: 'Managing agent', votes: false }] : [])];
  }

  private work(id: string | undefined): WorkItem | undefined {
    return id ? this.db.workItems.find((w) => w.id === id) : undefined;
  }

  private log(m: Meeting, kind: MeetingEvent['kind'], text: string, by: string): void {
    m.events = [{ id: `me-${++this.seq}`, at: new Date().toISOString(), kind, text, by }, ...m.events];
  }

  private save(): void {
    simulationStorage.save('governance', (): GovernanceSnapshot => ({ meetings: this.meetings, resolutions: this.resolutions, seq: this.seq }));
  }

  /** Persist, then tell every live query (MockDb's change stream drives them). */
  private commit(): void {
    this.save();
    this.db.touch();
  }
}
