import { Attendee, Meeting, MeetingEvent, Resolution, ResolutionAction, WorkItem } from '../../domain';
import { MockDb } from './mock-db';

const DAY = 86_400_000;
const at = (days: number, hour = 18) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const short = (iso: string) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });

const JOHAN = { id: 'staff-johan', name: 'Johan van der Merwe' };

function board(db: MockDb, schemeId: string, presentAll = true): Attendee[] {
  const trustees = db.trustees(schemeId).map(
    (t): Attendee => ({ id: t.person.id, name: t.person.displayName, role: t.portfolio === 'Chairperson' ? 'chair' : 'trustee', capacity: t.portfolio, votes: true, present: presentAll }),
  );
  return [...trustees, { id: JOHAN.id, name: JOHAN.name, role: 'agent', capacity: 'Managing agent', votes: false, present: presentAll }];
}

let seq = 0;
const ev = (atIso: string, kind: MeetingEvent['kind'], text: string, by: string): MeetingEvent => ({ id: `me-s${++seq}`, at: atIso, kind, text, by });

/**
 * Governance seed: two Kingfisher Court trustee meetings (one minuted, one
 * being prepared), a Willows meeting whose minutes await approval, and a
 * written resolution out to the Kingfisher Court trustees. The actions are
 * real Tasks (they replace the old fixture tasks w28–w30, same ids).
 */
export function seedGovernance(db: MockDb): { meetings: Meeting[]; resolutions: Resolution[]; work: WorkItem[] } {
  const work: WorkItem[] = [];
  const resolutions: Resolution[] = [];

  const action = (r: Pick<Resolution, 'ref' | 'schemeId'>, id: string, title: string, assigneeId: string, due: number, route: string, detail: string, done?: { by: string; days: number }): ResolutionAction => {
    work.push({
      id,
      ref: r.ref,
      kind: 'task',
      type: 'meeting-action',
      title,
      detail,
      schemeId: r.schemeId,
      createdAt: at(-20),
      dueAt: at(due, 17),
      assigneeId,
      status: done ? 'done' : 'open',
      decidedBy: done?.by,
      decidedAt: done ? at(done.days, 11) : undefined,
      route,
    });
    return { id: `act-${id}`, workItemId: id, title, assigneeId, dueAt: at(due, 17) };
  };

  // ---- Kingfisher Court: last month's trustee meeting, minutes approved
  const kcHeld = at(-20);
  const kc1: Meeting = {
    id: 'mtg-kc-1',
    version: 4,
    ref: 'MTG-KC-001',
    schemeId: 'kingfisher-court',
    type: 'trustee',
    title: `Trustee meeting — ${new Date(kcHeld).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}`,
    scheduledFor: kcHeld,
    venue: 'Clubhouse, Kingfisher Court',
    stage: 'minutes-approved',
    agenda: [
      { id: 'ag-kc1-1', title: 'Apologies and quorum', minute: 'All trustees present. Quorate.' },
      { id: 'ag-kc1-2', title: 'Exterior painting project', notes: 'Three quotes received; budget R 180 000.', minute: 'Trustees compared the three quotes and chose ProPaint on value and guarantee.' },
      { id: 'ag-kc1-3', title: 'Security and CCTV', notes: 'Two break-ins at Block C since June.', minute: 'Agreed the cameras at the gate and Block C need replacing; quotes to be obtained.' },
      { id: 'ag-kc1-4', title: 'Pet rule', notes: 'Owners asked for clearer rules on dogs in common areas.', minute: 'Revised wording agreed; to be circulated to owners for comment.' },
    ],
    attendees: board(db, 'kingfisher-court'),
    pack: ['Previous minutes', 'Painting quotes (3)', 'Arrears report'],
    notice: { sentAt: at(-30, 9), sentBy: JOHAN.name, recipients: 3, document: { templateId: 'meeting-notice.standard', version: 1 } },
    held: { at: kcHeld, quorate: true, present: 3, voters: 3, required: 2 },
    minutes: { draftedAt: at(-18, 10), draftedBy: JOHAN.name, approvedAt: at(-8, 19), approvedBy: 'Sipho Khumalo', document: { templateId: 'meeting-minutes.standard', version: 1 } },
    events: [],
  };
  const kcRoute = `/governance/meetings/${kc1.id}`;
  const kcDetail = `Trustee meeting ${short(kcHeld)}`;
  const r13: Resolution = {
    id: 'res-kc-13', version: 1, ref: 'RES-KC-13', number: 13, schemeId: 'kingfisher-court', mode: 'meeting', meetingId: kc1.id, agendaItemId: 'ag-kc1-2',
    title: 'Appoint ProPaint for the exterior painting',
    text: 'Resolved that ProPaint (Pty) Ltd be appointed to paint the exterior of Blocks A–D at R 172 400, within the approved maintenance budget.',
    outcome: 'passed', votes: { for: 3, against: 0, abstain: 0 }, proposedAt: kcHeld, proposedBy: JOHAN.name, decidedAt: kcHeld, decidedBy: kc1.title, actions: [],
  };
  r13.actions = [action(r13, 'w-res-kc-13', 'Issue the work order to ProPaint', JOHAN.id, -12, kcRoute, `RES-KC-13 · ${kcDetail}`, { by: JOHAN.name, days: -14 })];
  const r14: Resolution = {
    id: 'res-kc-14', version: 1, ref: 'RES-KC-14', number: 14, schemeId: 'kingfisher-court', mode: 'meeting', meetingId: kc1.id, agendaItemId: 'ag-kc1-3',
    title: 'Replace the gate and Block C cameras',
    text: 'Resolved that the managing agent obtain three quotes for replacing the CCTV cameras at the main gate and Block C, for decision at the next meeting.',
    outcome: 'passed', votes: { for: 3, against: 0, abstain: 0 }, proposedAt: kcHeld, proposedBy: JOHAN.name, decidedAt: kcHeld, decidedBy: kc1.title, actions: [],
  };
  r14.actions = [action(r14, 'w28', 'Obtain 3 quotes for CCTV upgrade', JOHAN.id, 3, kcRoute, `RES-KC-14 · ${kcDetail}`)];
  const r15: Resolution = {
    id: 'res-kc-15', version: 1, ref: 'RES-KC-15', number: 15, schemeId: 'kingfisher-court', mode: 'meeting', meetingId: kc1.id, agendaItemId: 'ag-kc1-4',
    title: 'Circulate the revised pet rule',
    text: 'Resolved that the revised conduct rule on pets in common areas be circulated to all owners for comment within 30 days, before adoption at the AGM.',
    outcome: 'passed', votes: { for: 2, against: 1, abstain: 0 }, proposedAt: kcHeld, proposedBy: 'Sipho Khumalo', decidedAt: kcHeld, decidedBy: kc1.title, actions: [],
  };
  r15.actions = [action(r15, 'w29', 'Circulate revised pet rule to owners', 'p-sipho', -1, kcRoute, `RES-KC-15 · ${kcDetail}`)];
  resolutions.push(r13, r14, r15);
  kc1.events = [
    ev(at(-8, 19), 'stage', 'Minutes approved by Sipho Khumalo', 'Sipho Khumalo'),
    ev(at(-14, 11), 'action', 'RES-KC-13 action done: Issue the work order to ProPaint', JOHAN.name),
    ev(at(-18, 10), 'stage', 'Minutes sent to the trustees for approval', JOHAN.name),
    ev(kcHeld, 'resolution', 'RES-KC-15 passed (2–1–0): Circulate the revised pet rule · 1 action created', JOHAN.name),
    ev(kcHeld, 'resolution', 'RES-KC-14 passed (3–0–0): Replace the gate and Block C cameras · 1 action created', JOHAN.name),
    ev(kcHeld, 'resolution', 'RES-KC-13 passed (3–0–0): Appoint ProPaint for the exterior painting · 1 action created', JOHAN.name),
    ev(kcHeld, 'stage', 'Meeting held: 3 of 3 trustees present, quorate', JOHAN.name),
    ev(at(-30, 9), 'notice', 'Notice sent to 3 trustees by email and the portal, 7+ days ahead', JOHAN.name),
  ];

  // ---- Kingfisher Court: next month's meeting, agenda being prepared
  const kcNext = at(16);
  const kc2: Meeting = {
    id: 'mtg-kc-2',
    version: 1,
    ref: 'MTG-KC-002',
    schemeId: 'kingfisher-court',
    type: 'trustee',
    title: `Trustee meeting — ${new Date(kcNext).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}`,
    scheduledFor: kcNext,
    venue: 'Clubhouse, Kingfisher Court',
    stage: 'draft',
    agenda: [
      { id: 'ag-kc2-1', title: 'Apologies and quorum' },
      { id: 'ag-kc2-2', title: 'Minutes of the previous meeting' },
      { id: 'ag-kc2-3', title: 'CCTV upgrade: decide on quotes', notes: 'Follows RES-KC-14.' },
      { id: 'ag-kc2-4', title: 'Pet rule: owners’ comments', notes: 'Follows RES-KC-15.' },
      { id: 'ag-kc2-5', title: '2027 budget and levy increase' },
    ],
    attendees: board(db, 'kingfisher-court', false).map((a) => ({ ...a, present: undefined })),
    pack: [],
    events: [ev(at(-2, 10), 'stage', `Scheduled for ${short(kcNext)} at Clubhouse, Kingfisher Court`, JOHAN.name)],
  };

  // ---- Kingfisher Court: written resolution out to the trustees
  const r16: Resolution = {
    id: 'res-kc-16', version: 1, ref: 'RES-KC-16', number: 16, schemeId: 'kingfisher-court', mode: 'written',
    title: 'Gate motor maintenance contract',
    text: 'Resolved that SecureAccess Systems be appointed to maintain the gate motors at R 1 450 a month for 12 months, from the first of next month.',
    outcome: 'proposed', proposedAt: at(-2, 9), proposedBy: JOHAN.name, approvalWorkItemId: 'w-res-kc-16', actions: [],
    plannedActions: [{ title: 'Sign the gate motor maintenance contract', assigneeId: JOHAN.id, dueAt: at(10, 17) }],
  };
  resolutions.push(r16);
  work.push({
    id: 'w-res-kc-16', ref: 'RES-KC-16', kind: 'approval', type: 'resolution-approval',
    title: 'Written resolution: Gate motor maintenance contract', detail: 'Round-robin to 3 trustees of Kingfisher Court',
    schemeId: 'kingfisher-court', amount: 17_400, createdAt: at(-2, 9), dueAt: at(3, 17), assigneeId: null, approverRoles: ['trustee'],
    evidence: [r16.text, 'SecureAccess quote (12-month contract)'], status: 'open', route: '/governance/resolutions',
  });

  // ---- The Willows: held, minutes waiting for the trustees
  const twHeld = at(-13);
  const tw1: Meeting = {
    id: 'mtg-tw-1',
    version: 3,
    ref: 'MTG-TW-001',
    schemeId: 'the-willows',
    type: 'trustee',
    title: `Trustee meeting — ${new Date(twHeld).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}`,
    scheduledFor: twHeld,
    venue: 'Online (Teams)',
    stage: 'minutes-draft',
    agenda: [
      { id: 'ag-tw1-1', title: 'Apologies and quorum', minute: 'Quorate.' },
      { id: 'ag-tw1-2', title: 'Insurance renewal', minute: 'Santam renewal accepted; replacement value confirmed by the valuer.' },
      { id: 'ag-tw1-3', title: 'Arrears: Unit 9', minute: 'Owner has not responded to the letter of demand.' },
    ],
    attendees: board(db, 'the-willows'),
    pack: ['Insurance renewal schedule', 'Arrears report'],
    notice: { sentAt: at(-22, 9), sentBy: JOHAN.name, recipients: 3, document: { templateId: 'meeting-notice.standard', version: 1 } },
    held: { at: twHeld, quorate: true, present: 3, voters: 3, required: 2 },
    minutes: { draftedAt: at(-12, 10), draftedBy: JOHAN.name, approvalWorkItemId: 'w-mtg-tw-1-minutes' },
    events: [],
  };
  const twRoute = `/governance/meetings/${tw1.id}`;
  const twDetail = `Trustee meeting ${short(twHeld)}`;
  const tw6: Resolution = {
    id: 'res-tw-6', version: 1, ref: 'RES-TW-6', number: 6, schemeId: 'the-willows', mode: 'meeting', meetingId: tw1.id, agendaItemId: 'ag-tw1-2',
    title: 'Renew the buildings insurance with Santam',
    text: 'Resolved that the buildings insurance be renewed with Santam at R 96 400 a year on the confirmed replacement value.',
    outcome: 'passed', votes: { for: 3, against: 0, abstain: 0 }, proposedAt: twHeld, proposedBy: JOHAN.name, decidedAt: twHeld, decidedBy: tw1.title, actions: [],
  };
  const tw7: Resolution = {
    id: 'res-tw-7', version: 1, ref: 'RES-TW-7', number: 7, schemeId: 'the-willows', mode: 'meeting', meetingId: tw1.id, agendaItemId: 'ag-tw1-3',
    title: 'Hand Unit 9 arrears to the attorney',
    text: 'Resolved that the arrears on Unit 9 be handed to the scheme’s attorney for collection, with costs recovered from the owner as the rules allow.',
    outcome: 'passed', votes: { for: 3, against: 0, abstain: 0 }, proposedAt: twHeld, proposedBy: JOHAN.name, decidedAt: twHeld, decidedBy: tw1.title, actions: [],
  };
  tw7.actions = [action(tw7, 'w30', 'Instruct attorney on Unit 9 arrears', JOHAN.id, 10, twRoute, `RES-TW-7 · ${twDetail}`)];
  resolutions.push(tw6, tw7);
  work.push({
    id: 'w-mtg-tw-1-minutes', ref: tw1.ref, kind: 'approval', type: 'minutes-approval',
    title: `Approve the minutes: ${tw1.title}`, detail: `2 resolutions · held ${short(twHeld)}`,
    schemeId: 'the-willows', createdAt: at(-12, 10), dueAt: at(-5, 17), assigneeId: null, approverRoles: ['trustee', 'agency-admin'],
    evidence: ['Draft minutes', ...tw1.pack], status: 'open', route: twRoute,
  });
  tw1.events = [
    ev(at(-12, 10), 'stage', 'Minutes sent to the trustees for approval', JOHAN.name),
    ev(twHeld, 'resolution', 'RES-TW-7 passed (3–0–0): Hand Unit 9 arrears to the attorney · 1 action created', JOHAN.name),
    ev(twHeld, 'resolution', 'RES-TW-6 passed (3–0–0): Renew the buildings insurance with Santam', JOHAN.name),
    ev(twHeld, 'stage', 'Meeting held: 3 of 3 trustees present, quorate', JOHAN.name),
    ev(at(-22, 9), 'notice', 'Notice sent to 3 trustees by email and the portal, 7+ days ahead', JOHAN.name),
  ];

  return { meetings: [kc2, kc1, tw1], resolutions, work };
}
