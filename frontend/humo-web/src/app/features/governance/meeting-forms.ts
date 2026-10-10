import { Router } from '@angular/router';
import {
  Assignee,
  MEETING_TYPE_LABELS,
  MeetingDataSource,
  MeetingDetail,
  MeetingType,
  NOTICE_DAYS,
  NewAction,
  ResolutionDataSource,
  Scheme,
  earliestMeetingDate,
} from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { FormField, FormValues, REASON_FIELD, openForm } from '../shared/form-drawer';
import { fieldsFrom, isoFrom } from './meeting-view';

const TYPE_OPTIONS = (Object.keys(MEETING_TYPE_LABELS) as MeetingType[]).map((t) => ({ value: t, label: MEETING_TYPE_LABELS[t] }));

export function scheduleMeetingForm(drawer: DrawerService, data: MeetingDataSource, router: Router, schemes: Scheme[], schemeId?: string, type: MeetingType = 'trustee'): void {
  const earliest = fieldsFrom(earliestMeetingDate(type).toISOString()).date;
  openForm(drawer, {
    eyebrow: 'Governance',
    title: 'Schedule a meeting',
    intro: `It starts as a draft agenda. Notice goes out from the meeting page: trustee meetings need ${NOTICE_DAYS.trustee} days’ notice, AGMs and SGMs ${NOTICE_DAYS.agm}.`,
    fields: [
      { key: 'schemeId', label: 'Scheme', type: 'select', required: true, options: schemes.map((s) => ({ value: s.id, label: s.name })) },
      { key: 'type', label: 'Meeting', type: 'select', required: true, options: TYPE_OPTIONS },
      { key: 'date', label: 'Date', type: 'date', required: true, half: true, help: `Earliest with notice today: ${earliest} (${MEETING_TYPE_LABELS[type].toLowerCase()}).` },
      { key: 'time', label: 'Time', type: 'text', required: true, half: true, placeholder: '18:00' },
      { key: 'venue', label: 'Venue', type: 'text', required: true, placeholder: 'Clubhouse, or “Online (Teams)”' },
      { key: 'title', label: 'Title', type: 'text', help: 'Optional. Defaults to the meeting type and month.' },
    ],
    initial: { schemeId: schemeId ?? schemes[0]?.id ?? '', type, date: earliest, time: '18:00' },
    submitLabel: 'Schedule meeting',
    submit: (v) => data.create({ schemeId: v['schemeId'], type: v['type'] as MeetingType, scheduledFor: isoFrom(v['date'], v['time']), venue: v['venue'], title: v['title'] }),
    success: () => 'Meeting scheduled. Next: finish the agenda and send notice.',
    done: (id) => router.navigate(['/governance/meetings', id]),
    failure: 'The meeting wasn’t scheduled',
  });
}

export function agendaItemForm(drawer: DrawerService, data: MeetingDataSource, d: MeetingDetail): void {
  openForm(drawer, {
    eyebrow: d.meeting.title,
    title: 'Add an agenda item',
    fields: [
      { key: 'title', label: 'Item', type: 'text', required: true, placeholder: 'e.g. CCTV upgrade: decide on quotes' },
      { key: 'notes', label: 'Background', type: 'textarea', help: 'Optional. Printed under the item on the notice.' },
    ],
    submitLabel: 'Add to agenda',
    submit: (v) => data.act(d.meeting.id, { type: 'add-agenda-item', title: v['title'], notes: v['notes'] }, d.meeting.version),
    success: () => 'Added to the agenda.',
    failure: 'The item wasn’t added',
  });
}

export function rescheduleForm(drawer: DrawerService, data: MeetingDataSource, d: MeetingDetail): void {
  const f = fieldsFrom(d.meeting.scheduledFor);
  openForm(drawer, {
    eyebrow: d.meeting.title,
    title: 'Change date or venue',
    fields: [
      { key: 'date', label: 'Date', type: 'date', required: true, half: true },
      { key: 'time', label: 'Time', type: 'text', required: true, half: true },
      { key: 'venue', label: 'Venue', type: 'text', required: true },
    ],
    initial: { date: f.date, time: f.time, venue: d.meeting.venue },
    submitLabel: 'Save',
    submit: (v) => data.act(d.meeting.id, { type: 'reschedule', scheduledFor: isoFrom(v['date'], v['time']), venue: v['venue'] }, d.meeting.version),
    success: () => 'Meeting moved.',
    failure: 'The meeting wasn’t moved',
  });
}

export function packForm(drawer: DrawerService, data: MeetingDataSource, d: MeetingDetail): void {
  openForm(drawer, {
    eyebrow: d.meeting.title,
    title: 'Meeting pack',
    intro: 'The papers trustees read before the meeting. (They’ll come from the document library once it exists.)',
    fields: [{ key: 'documents', label: 'Documents, one per line', type: 'textarea', required: true, placeholder: 'Previous minutes\nCCTV quotes (3)\nArrears report' }],
    initial: { documents: ['Previous minutes', 'Financial report', 'Arrears report'].join('\n') },
    submitLabel: 'Mark pack ready',
    submit: (v) => data.act(d.meeting.id, { type: 'pack-ready', documents: v['documents'].split('\n').map((x) => x.trim()).filter(Boolean) }, d.meeting.version),
    success: () => 'The pack is ready.',
    failure: 'The pack wasn’t saved',
  });
}

/** Trustees present or sending apologies; general meetings also count owners in person and by proxy. */
export function attendanceForm(drawer: DrawerService, data: MeetingDataSource, d: MeetingDetail): void {
  const m = d.meeting;
  const people = m.attendees.filter((a) => a.role !== 'agent');
  const fields: FormField[] = people.map((a) => ({
    key: `p-${a.id}`,
    label: `${a.name} (${a.capacity})`,
    type: 'select',
    required: true,
    half: true,
    options: [
      { value: 'present', label: 'Present' },
      { value: 'apology', label: 'Apologies' },
    ],
  }));
  if (m.type !== 'trustee') {
    fields.push({ key: 'ownersPresent', label: 'Owners present in person or by proxy', type: 'number', required: true, help: `${d.scheme.unitCount} units; a third (${Math.ceil(d.scheme.unitCount / 3)}) makes a quorum.` });
  }
  openForm(drawer, {
    eyebrow: m.title,
    title: 'Record the meeting',
    intro: m.type === 'trustee' ? 'Who was there. A majority of trustees makes a quorum; without one, the meeting can’t take decisions.' : 'Who was there, and how many owners voted in person or by proxy.',
    fields,
    initial: Object.fromEntries(people.map((a) => [`p-${a.id}`, 'present'])),
    submitLabel: 'Record attendance',
    submit: (v) =>
      data.act(
        m.id,
        {
          type: 'record-attendance',
          presentIds: [...people.filter((a) => v[`p-${a.id}`] === 'present').map((a) => a.id), ...m.attendees.filter((a) => a.role === 'agent').map((a) => a.id)],
          ownersPresent: v['ownersPresent'] ? Number(v['ownersPresent']) : undefined,
        },
        m.version,
      ),
    success: () => 'Meeting recorded. Next: minute the items and record resolutions.',
    failure: 'Attendance wasn’t recorded',
  });
}

export function minuteForm(drawer: DrawerService, data: MeetingDataSource, d: MeetingDetail, itemId: string): void {
  const item = d.meeting.agenda.find((a) => a.id === itemId)!;
  openForm(drawer, {
    eyebrow: d.meeting.title,
    title: item.title,
    intro: 'What was discussed and noted. Decisions go in as resolutions, with their wording and votes.',
    fields: [{ key: 'minute', label: 'Minute', type: 'textarea', required: true }],
    initial: { minute: item.minute ?? item.notes ?? '' },
    submitLabel: 'Save minute',
    submit: (v) => data.act(d.meeting.id, { type: 'record-minute', itemId, minute: v['minute'] }, d.meeting.version),
    success: () => 'Minute saved.',
    failure: 'The minute wasn’t saved',
  });
}

function actionFields(d: { assignees: Assignee[] }, count: number): FormField[] {
  const people = d.assignees.map((a) => ({ value: a.id, label: `${a.name}${a.kind === 'trustee' ? ' (trustee)' : ''}` }));
  const out: FormField[] = [];
  for (let i = 0; i < count; i++) {
    const shown = (v: FormValues) => i === 0 || !!v[`action${i - 1}`]?.trim();
    out.push(
      { key: `action${i}`, label: i === 0 ? 'Action' : `Action ${i + 1}`, type: 'text', placeholder: i === 0 ? 'e.g. Obtain 3 quotes for the CCTV upgrade' : 'Another action (optional)', showIf: shown },
      { key: `assignee${i}`, label: 'Responsible', type: 'select', half: true, options: people, showIf: (v) => !!v[`action${i}`]?.trim() },
      { key: `due${i}`, label: 'Due', type: 'date', half: true, showIf: (v) => !!v[`action${i}`]?.trim() },
    );
  }
  return out;
}

function actionsFrom(v: FormValues, count: number): NewAction[] {
  const out: NewAction[] = [];
  for (let i = 0; i < count; i++) {
    const title = v[`action${i}`]?.trim();
    if (title) out.push({ title, assigneeId: v[`assignee${i}`] || null, dueAt: v[`due${i}`] ? isoFrom(v[`due${i}`], '17:00') : '' });
  }
  return out;
}

/** Actions default to the meeting's managing agent. */
const agentOf = (d: MeetingDetail) => d.meeting.attendees.find((a) => a.role === 'agent' && d.assignees.some((x) => x.id === a.id))?.id ?? d.assignees[0]?.id ?? '';

const inDays = (n: number) => fieldsFrom(new Date(Date.now() + n * 86_400_000).toISOString()).date;

/** A resolution as passed (or not) at the meeting, with the actions that follow from it. Each action becomes a Task. */
export function resolutionForm(drawer: DrawerService, data: MeetingDataSource, d: MeetingDetail, agendaItemId?: string): void {
  const voters = d.meeting.held?.present ?? 0;
  openForm(drawer, {
    eyebrow: d.meeting.title,
    title: 'Record a resolution',
    intro: 'Its actions become Tasks for the people responsible; completing the last one completes the resolution.',
    fields: [
      { key: 'agendaItemId', label: 'Agenda item', type: 'select', options: d.meeting.agenda.map((a, i) => ({ value: a.id, label: `${i + 1}. ${a.title}` })) },
      { key: 'title', label: 'Short title', type: 'text', required: true, placeholder: 'e.g. Replace the gate cameras' },
      { key: 'text', label: 'Resolution', type: 'textarea', required: true, placeholder: 'Resolved that …' },
      { key: 'outcome', label: 'Outcome', type: 'select', required: true, options: [{ value: 'passed', label: 'Passed' }, { value: 'not-passed', label: 'Not passed' }] },
      { key: 'for', label: 'For', type: 'number', required: true, half: true },
      { key: 'against', label: 'Against', type: 'number', required: true, half: true },
      { key: 'abstain', label: 'Abstained', type: 'number', required: true, half: true, help: `${voters} voters present.` },
      ...actionFields(d, 3).map((f) => ({ ...f, showIf: (v: FormValues) => v['outcome'] === 'passed' && (!f.showIf || f.showIf(v)) })),
    ],
    initial: { agendaItemId: agendaItemId ?? '', outcome: 'passed', for: String(voters), against: '0', abstain: '0', due0: inDays(14), due1: inDays(14), due2: inDays(14), assignee0: agentOf(d) },
    submitLabel: 'Record resolution',
    submit: (v) =>
      data.act(
        d.meeting.id,
        {
          type: 'add-resolution',
          resolution: {
            title: v['title'],
            text: v['text'],
            agendaItemId: v['agendaItemId'] || undefined,
            outcome: v['outcome'] as 'passed' | 'not-passed',
            votes: { for: Number(v['for']), against: Number(v['against']), abstain: Number(v['abstain']) },
            actions: v['outcome'] === 'passed' ? actionsFrom(v, 3) : [],
          },
        },
        d.meeting.version,
      ),
    success: (_r, v) => (v['outcome'] === 'passed' && actionsFrom(v, 3).length ? 'Resolution recorded; its actions are on the responsible people’s Tasks.' : 'Resolution recorded.'),
    failure: 'The resolution wasn’t recorded',
  });
}

export function cancelMeetingForm(drawer: DrawerService, data: MeetingDataSource, d: MeetingDetail): void {
  openForm(drawer, {
    eyebrow: d.meeting.title,
    title: 'Cancel meeting',
    intro: d.meeting.notice ? 'Everyone who received notice is told it’s cancelled.' : 'Notice hasn’t gone out, so nobody needs to be told.',
    fields: [REASON_FIELD],
    submitLabel: 'Cancel meeting',
    submit: (v) => data.act(d.meeting.id, { type: 'cancel', reason: v['reason'] }, d.meeting.version),
    success: () => 'Meeting cancelled.',
    failure: 'The meeting wasn’t cancelled',
  });
}

/** Round-robin: the trustees decide it in Approvals; its actions start once it passes. */
export function writtenResolutionForm(
  drawer: DrawerService,
  data: ResolutionDataSource,
  schemes: Scheme[],
  assignees: Assignee[],
): void {
  const first = schemes[0]?.id ?? '';
  openForm(drawer, {
    eyebrow: 'Resolutions',
    title: 'Propose a written resolution',
    intro: 'For decisions that can’t wait for the next meeting. It goes to the scheme’s trustees in Approvals; once it passes, its actions become Tasks.',
    fields: [
      { key: 'schemeId', label: 'Scheme', type: 'select', required: true, options: schemes.map((s) => ({ value: s.id, label: s.name })) },
      { key: 'title', label: 'Short title', type: 'text', required: true },
      { key: 'text', label: 'Resolution', type: 'textarea', required: true, placeholder: 'Resolved that …' },
      ...actionFields({ assignees }, 2),
    ],
    initial: { schemeId: first, due0: inDays(10), due1: inDays(10), assignee0: assignees[0]?.id ?? '' },
    submitLabel: 'Send to the trustees',
    submit: (v) => data.proposeWritten({ schemeId: v['schemeId'], title: v['title'], text: v['text'], actions: actionsFrom(v, 2) }),
    success: (ref) => `${ref} sent to the trustees for approval.`,
    failure: 'The resolution wasn’t sent',
  });
}

