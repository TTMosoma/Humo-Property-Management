import { Injectable, inject } from '@angular/core';
import {
  Account,
  COLLECTION_STAGE_LABELS,
  CollectionAction,
  CollectionCase,
  CollectionStage,
  CollectionStep,
  CollectionView,
  FieldErrors,
  LetterKind,
  NextAction,
  WorkItem,
  activeAssignments,
  daysInArrears,
  entitlementSet,
  overdueOf,
} from '../../domain';
import { formatDate, formatRand } from '../../ui/format/money';
import { personName } from '../fixtures/staff';
import { simulationStorage } from '../simulation/simulation-storage';
import { AccessStore } from './access-store';
import { DocumentStore } from './document-store';
import { MockDb } from './mock-db';
import { CommsStore } from './comms-store';
import { SettingsStore } from './settings-store';
import { OrganisationStore } from './organisation-store';
import { PlatformStore } from './platform-store';
import { StaffStore } from './staff-store';


/** 1 → "1st", 22 → "22nd" (days of the month, 1–28). */
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface CollectionsSnapshot {
  cases: CollectionCase[];
  seq: number;
}

const DAY = 86_400_000;
const iso = (days: number, hour = 10) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const plus = (at: string, days: number) => new Date(new Date(at).getTime() + days * DAY).toISOString();

const LETTER_TEXT: Record<LetterKind, string> = {
  reminder: 'Reminder',
  'final-demand': 'Final demand',
  'letter-of-demand': 'Letter of demand',
};

/** Which letter each stage allows next. */
const NEXT_LETTER: Partial<Record<CollectionStage, LetterKind>> = {
  'not-started': 'reminder',
  reminder: 'final-demand',
};

/**
 * Credit control "backend" for the prototype: a collection case per account in
 * arrears, the rules for each step, the letters sent (with their template
 * version), the trustees' approval of letters of demand, and one follow-up
 * Task per active case so the next step can't be forgotten.
 */
@Injectable({ providedIn: 'root' })
export class CollectionsStore {
  private readonly db = inject(MockDb);
  private readonly settings = inject(SettingsStore);
  private readonly comms = inject(CommsStore);
  private readonly staff = inject(StaffStore);
  private readonly access = inject(AccessStore);
  private readonly docs = inject(DocumentStore);
  private readonly platform = inject(PlatformStore);
  private readonly orgs = inject(OrganisationStore);

  private cases = new Map<string, CollectionCase>();
  private seq: number;

  constructor() {
    const saved = simulationStorage.load<CollectionsSnapshot>('collections');
    if (saved) {
      saved.cases.forEach((c) => this.cases.set(c.accountId, c));
      this.seq = saved.seq;
    } else {
      this.seq = 100;
      this.seed();
      this.commit();
    }
    this.db.workHooks.push((before, after) => this.onDecision(before, after));
  }

  // =================================================================== Reads

  /** Every account in arrears in these schemes, plus accounts with an active arrangement, dispute or hand-over. */
  list(schemeIds: string[]): CollectionView[] {
    const ids = new Set(schemeIds);
    return [...this.db.accounts.values()]
      .filter((a) => ids.has(a.schemeId))
      .filter((a) => overdueOf(a.ageing) > 0 || (a.balance > 0 && ['arrangement', 'disputed', 'handed-over'].includes(this.cases.get(a.id)?.stage ?? '')))
      .map((a) => this.view(a));
  }

  get(accountId: string): CollectionView | undefined {
    const a = this.db.accounts.get(accountId);
    return a ? this.view(a) : undefined;
  }

  caseFor(accountId: string): CollectionCase {
    return this.cases.get(accountId) ?? { accountId, version: 0, schemeId: this.db.accounts.get(accountId)!.schemeId, stage: 'not-started', steps: [] };
  }

  private view(a: Account): CollectionView {
    const c = this.caseFor(a.id);
    const unit = this.db.unitById.get(a.unitId)!;
    const scheme = this.db.scheme(a.schemeId);
    return {
      case: c,
      account: a,
      unit,
      scheme,
      payTo: this.db.trustAccount(scheme).account,
      stepDays: this.settings.billing(scheme.organisationId).stepDays,
      agencyName: this.orgs.get(scheme.organisationId)?.name ?? '',
      holder: this.db.persons.get(a.holderPersonId)!,
      daysInArrears: daysInArrears(a.ageing),
      overdueAmount: overdueOf(a.ageing),
      next: this.next(c, a),
      lastStep: c.steps[0],
      assigneeName: personName(this.assigneeFor(a.schemeId)),
    };
  }

  /** The next step and when it's due. */
  private next(c: CollectionCase, a: Account): NextAction | undefined {
    const last = c.steps[0]?.at ?? new Date().toISOString();
    const due = (label: string, at: string): NextAction => ({ label, dueAt: at, overdue: new Date(at).getTime() < Date.now() });
    const STEP_DAYS = this.settings.billing(this.db.scheme(c.schemeId).organisationId).stepDays;
    switch (c.stage) {
      case 'not-started': {
        // In arrears since the last billing run: remind today.
        const today = new Date();
        today.setHours(23, 59, 0, 0);
        return due('Send a reminder', today.toISOString());
      }
      case 'reminder':
        return due('Send a final demand', plus(last, STEP_DAYS));
      case 'final-demand':
        if (c.demandApproval?.status === 'pending') return due('Waiting for the trustees to approve a letter of demand', plus(last, STEP_DAYS + 3));
        if (c.demandApproval?.status === 'approved') return due('Send the letter of demand', plus(c.demandApproval.decidedAt ?? last, 2));
        return due('Ask the trustees to approve a letter of demand', plus(last, STEP_DAYS));
      case 'letter-of-demand':
        return due('Hand the account to the attorney', plus(last, STEP_DAYS));
      case 'handed-over':
        return due('Check progress with the attorney', plus(last, 30));
      case 'arrangement': {
        const ar = c.arrangement!;
        const d = new Date();
        const nextDue = new Date(d.getFullYear(), d.getMonth() + (d.getDate() > ar.day ? 1 : 0), ar.day, 12);
        return due(`Check the ${formatRand(ar.instalment)} instalment on the ${ordinal(ar.day)}`, nextDue.toISOString());
      }
      case 'disputed':
        return due('Resolve the dispute', plus(c.dispute?.at ?? last, STEP_DAYS));
    }
  }

  // =================================================================== Commands

  check(accountId: string, action: CollectionAction): FieldErrors | null {
    const a = this.db.accounts.get(accountId);
    if (!a) return { account: 'No such account.' };
    const c = this.caseFor(accountId);
    const e: FieldErrors = {};
    const stageIs = (stages: CollectionStage[], what: string) => {
      if (!stages.includes(c.stage)) e['stage'] = `${what} isn’t the next step: the account is at “${COLLECTION_STAGE_LABELS[c.stage]}”.`;
    };
    switch (action.type) {
      case 'send-letter':
        if (overdueOf(a.ageing) <= 0) e['stage'] = 'Nothing is overdue on this account.';
        else if (action.kind === 'letter-of-demand') {
          stageIs(['final-demand'], 'A letter of demand');
          if (c.demandApproval?.status !== 'approved') e['approval'] = 'A letter of demand needs the trustees’ approval first.';
        } else if (NEXT_LETTER[c.stage] !== action.kind) e['stage'] = `A ${LETTER_TEXT[action.kind].toLowerCase()} isn’t the next step: the account is at “${COLLECTION_STAGE_LABELS[c.stage]}”.`;
        break;
      case 'request-demand-approval':
        stageIs(['final-demand'], 'Asking for a letter of demand');
        if (c.demandApproval?.status === 'pending') e['approval'] = 'The trustees already have it.';
        if (c.demandApproval?.status === 'approved') e['approval'] = 'Already approved: send the letter.';
        break;
      case 'hand-over':
        stageIs(['letter-of-demand'], 'Handing over');
        if (!action.attorney.trim()) e['attorney'] = 'Which attorney?';
        break;
      case 'arrangement': {
        stageIs(['not-started', 'reminder', 'final-demand', 'letter-of-demand', 'disputed'], 'An arrangement');
        if (!(action.instalment > 0)) e['instalment'] = 'Enter the monthly instalment.';
        if (!(action.day >= 1 && action.day <= 28)) e['day'] = 'A day from 1 to 28.';
        if (!(action.months >= 1 && action.months <= 24)) e['months'] = 'Between 1 and 24 months.';
        const owed = overdueOf(a.ageing);
        if (!e['instalment'] && !e['months'] && action.instalment * action.months < owed) {
          e['instalment'] = `${formatRand(action.instalment)} × ${action.months} months doesn’t clear the ${formatRand(owed)} overdue (on top of the monthly levy).`;
        }
        break;
      }
      case 'missed-instalment':
        stageIs(['arrangement'], 'Recording a missed instalment');
        break;
      case 'dispute':
        if (action.reason.trim().length < 10) e['reason'] = 'Say what the owner disputes.';
        if (c.stage === 'disputed') e['stage'] = 'Already marked as disputed.';
        break;
      case 'resolve-dispute':
        stageIs(['disputed'], 'Resolving a dispute');
        if (action.note.trim().length < 5) e['note'] = 'Record how it was resolved.';
        break;
      case 'note':
        if (!action.text.trim()) e['text'] = 'Write a note.';
        break;
    }
    return Object.keys(e).length ? e : null;
  }

  act(accountId: string, action: CollectionAction, by: string): void {
    const a = this.db.accounts.get(accountId)!;
    const c = this.ensure(accountId);
    switch (action.type) {
      case 'send-letter': {
        const stage: CollectionStage = action.kind;
        this.step(c, stage, `${LETTER_TEXT[action.kind]} sent by ${action.channel}: ${formatRand(overdueOf(a.ageing))} overdue`, by, this.letter(a, action.kind, action.channel));
        c.stage = stage;
        if (action.kind === 'letter-of-demand') c.demandApproval = undefined;
        // Emailed or SMSed letters are in Sent; registered post is tracked by the post office.
        const holder = action.channel !== 'post' ? this.comms.holderOf(a.id) : undefined;
        if (holder && action.channel !== 'post') {
          const channel = action.channel;
          this.comms.record({
            kind: 'letter',
            schemeId: a.schemeId,
            subject: `${LETTER_TEXT[action.kind]}: levy account {account.number}`,
            body: `Dear {person.name},\n\nPlease find attached a ${LETTER_TEXT[action.kind].toLowerCase()} about {account.overdue} overdue on your levy account for unit {unit.number}.\n\n{agency.name}`,
            channels: [channel],
            audienceLabel: `${a.accountNo} · ${this.db.scheme(a.schemeId).name}`,
            by,
            to: [{ ...holder, channel }],
            source: { label: `Collection case ${a.accountNo}`, route: `/finance/credit-control/${a.id}` },
          });
        }
        break;
      }
      case 'request-demand-approval': {
        const workItemId = `w-lod-${a.id}-${++this.seq}`;
        this.db.addWork({
          id: workItemId,
          ref: a.accountNo,
          kind: 'approval',
          type: 'demand-approval',
          title: `Letter of demand: unit ${this.db.unitById.get(a.unitId)?.number} — ${this.db.persons.get(a.holderPersonId)?.displayName}`,
          detail: `${formatRand(overdueOf(a.ageing))} overdue, ${daysInArrears(a.ageing)}+ days. Reminder and final demand sent; no payment.`,
          schemeId: a.schemeId,
          amount: overdueOf(a.ageing),
          createdAt: new Date().toISOString(),
          dueAt: iso(3, 17),
          assigneeId: null,
          approverRoles: ['trustee', 'agency-admin'],
          evidence: c.steps.filter((s) => s.letter).map((s) => `${LETTER_TEXT[s.letter!.kind]} sent ${formatDate(s.at)}`),
          status: 'open',
          route: `/finance/credit-control/${a.id}`,
        });
        c.demandApproval = { workItemId, status: 'pending' };
        this.step(c, c.stage, 'Asked the trustees to approve a letter of demand', by);
        break;
      }
      case 'hand-over':
        c.stage = 'handed-over';
        a.status = 'handed-over';
        this.step(c, 'handed-over', `Handed over to ${action.attorney.trim()} for collection`, by);
        break;
      case 'arrangement':
        c.previousStage = c.stage === 'disputed' ? c.previousStage : c.stage;
        c.stage = 'arrangement';
        c.arrangement = { instalment: action.instalment, day: action.day, months: action.months, startedAt: new Date().toISOString(), missed: 0 };
        a.status = 'arrangement';
        this.step(c, 'arrangement', `Payment arrangement: ${formatRand(action.instalment)} on the ${ordinal(action.day)} of each month for ${action.months} months, on top of the levy. Interest suspended while it’s kept.`, by);
        break;
      case 'missed-instalment':
        c.arrangement = { ...c.arrangement!, missed: c.arrangement!.missed + 1 };
        c.stage = c.previousStage ?? 'final-demand';
        a.status = 'arrears';
        this.step(c, c.stage, `Arrangement broken: instalment of ${formatRand(c.arrangement.instalment)} missed. Collection resumes.`, by);
        break;
      case 'dispute':
        c.previousStage = c.stage;
        c.stage = 'disputed';
        c.dispute = { reason: action.reason.trim(), at: new Date().toISOString(), by };
        this.step(c, 'disputed', `Disputed: ${action.reason.trim()}`, by);
        break;
      case 'resolve-dispute':
        c.stage = c.previousStage ?? 'not-started';
        this.step(c, c.stage, `Dispute resolved${action.outcome === 'written-off-in-part' ? ' (part written off by journal)' : ''}: ${action.note.trim()}`, by);
        c.dispute = undefined;
        break;
      case 'note':
        this.step(c, c.stage, action.text.trim(), by);
        break;
    }
    c.version++;
    this.syncFollowUp(c, by);
    this.commit();
  }

  /** Reminders to many accounts at once (the Compose pattern). Only accounts whose next step is a reminder get one. */
  remind(accountIds: string[], channel: 'email' | 'sms', by: string): number {
    let sent = 0;
    const reminded: string[] = [];
    for (const id of accountIds) {
      const a = this.db.accounts.get(id);
      if (!a || overdueOf(a.ageing) <= 0 || this.caseFor(id).stage !== 'not-started') continue;
      const c = this.ensure(id);
      this.step(c, 'reminder', `Reminder sent by ${channel} (bulk): ${formatRand(overdueOf(a.ageing))} overdue`, by, this.letter(a, 'reminder', channel));
      c.stage = 'reminder';
      c.version++;
      this.syncFollowUp(c, by);
      sent++;
      reminded.push(id);
    }
    const first = reminded[0] && this.db.accounts.get(reminded[0]);
    if (first) {
      this.comms.record({
        kind: 'reminder',
        schemeId: first.schemeId,
        subject: 'Your levy account {account.number}',
        body: 'Hi {person.firstName}, a friendly reminder that {account.overdue} is overdue on your levy account for unit {unit.number}, {scheme.name}. Please pay using reference {account.number}, or call {agency.name} on {agency.phone} to arrange.',
        channels: [channel],
        audienceLabel: `${reminded.length} account${reminded.length === 1 ? '' : 's'} in arrears · ${this.db.scheme(first.schemeId).name}`,
        by,
        to: reminded.map((rid) => this.comms.holderOf(rid)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ ...x, channel })),
        source: { label: 'Credit control', route: '/finance/credit-control' },
      });
    }
    this.commit();
    return sent;
  }

  // =================================================================== Approvals decided elsewhere

  private onDecision(before: WorkItem, after: WorkItem): void {
    if (after.type !== 'demand-approval' || before.status === after.status) return;
    const c = [...this.cases.values()].find((x) => x.demandApproval?.workItemId === after.id);
    if (!c) return;
    const by = after.decidedBy ?? 'Trustee';
    c.demandApproval = { ...c.demandApproval!, status: after.status === 'approved' ? 'approved' : 'rejected', decidedBy: by, decidedAt: after.decidedAt };
    this.step(c, c.stage, after.status === 'approved' ? `Trustees approved a letter of demand (${by})` : `Trustees declined a letter of demand (${by})${after.comment ? `: “${after.comment}”` : ''}`, by);
    c.version++;
    this.syncFollowUp(c, by);
    this.save();
  }

  // =================================================================== Internals

  private ensure(accountId: string): CollectionCase {
    let c = this.cases.get(accountId);
    if (!c) {
      c = this.caseFor(accountId);
      this.cases.set(accountId, c);
    }
    return c;
  }

  private letter(a: Account, kind: LetterKind, channel: 'email' | 'post' | 'sms'): CollectionStep['letter'] {
    const scheme = this.db.scheme(a.schemeId);
    const ent = entitlementSet(this.platform.customers().find((x) => x.organisationId === scheme.organisationId)?.entitlements ?? []);
    return { kind, amount: overdueOf(a.ageing), ageing: { ...a.ageing }, dueBy: iso(kind === 'reminder' ? 7 : 14, 17), channel, template: this.docs.issuingTemplate(scheme.organisationId, 'payment-notice', ent) };
  }

  private step(c: CollectionCase, stage: CollectionStage, text: string, by: string, letter?: CollectionStep['letter'], at = new Date().toISOString()): void {
    c.steps = [{ id: `cs-${++this.seq}`, at, by, text, stage, letter }, ...c.steps];
  }

  /** One open follow-up Task per active case, due when the next step is. */
  private syncFollowUp(c: CollectionCase, by: string, id?: string): void {
    const a = this.db.accounts.get(c.accountId)!;
    if (c.followUpWorkItemId) this.db.closeWork(c.followUpWorkItemId, by);
    const next = this.next(c, a);
    if (!next || c.stage === 'not-started') {
      c.followUpWorkItemId = undefined;
      return;
    }
    const unit = this.db.unitById.get(a.unitId)!;
    const workId = id ?? `w-col-${a.id}-${++this.seq}`;
    this.db.addWork({
      id: workId,
      ref: a.accountNo,
      kind: 'task',
      type: 'debtor-follow-up',
      title: `Unit ${unit.number} — ${next.label.charAt(0).toLowerCase()}${next.label.slice(1)}`,
      detail: `${COLLECTION_STAGE_LABELS[c.stage]} · ${formatRand(overdueOf(a.ageing))} overdue, ${daysInArrears(a.ageing)}+ days`,
      schemeId: a.schemeId,
      unitLabel: `Unit ${unit.number}`,
      personName: this.db.persons.get(a.holderPersonId)?.displayName,
      amount: overdueOf(a.ageing),
      createdAt: new Date().toISOString(),
      dueAt: next.dueAt,
      assigneeId: this.assigneeFor(a.schemeId),
      status: 'open',
      route: `/finance/credit-control/${a.id}`,
    });
    c.followUpWorkItemId = workId;
  }

  /** The agency's credit controller if it has one, else the scheme's portfolio manager. */
  private assigneeFor(schemeId: string): string | null {
    const scheme = this.db.scheme(schemeId);
    const controller = this.access
      .identities()
      .find((i) => i.status === 'active' && i.staffId && /credit/i.test(i.title ?? '') && activeAssignments(i).some((x) => x.role === 'finance' && x.scope.organisationId === scheme.organisationId));
    return this.staff.routeTo(controller?.staffId ?? scheme.portfolioManager?.staffId ?? null);
  }

  /** Demo cases behind the old fixture tasks (w04–w06), plus a few reminders and a dispute. */
  private seed(): void {
    const byNo = (no: string) => [...this.db.accounts.values()].find((a) => a.accountNo === no);
    const zanele = 'Zanele Dlamini';
    const add = (no: string, build: (c: CollectionCase, a: Account) => void, followUpId?: string) => {
      const a = byNo(no);
      if (!a) return;
      const c = this.ensure(a.id);
      build(c, a);
      c.version = 1;
      this.syncFollowUp(c, zanele, followUpId);
    };
    const sent = (c: CollectionCase, a: Account, kind: LetterKind, days: number) =>
      this.step(c, kind, `${LETTER_TEXT[kind]} sent by email: ${formatRand(overdueOf(a.ageing))} overdue`, zanele, { ...this.letter(a, kind, 'email')!, dueBy: iso(days + (kind === 'reminder' ? 7 : 14), 17) }, iso(days));

    add('KC-031', (c, a) => {
      sent(c, a, 'reminder', -44);
      sent(c, a, 'final-demand', -24);
      c.stage = 'final-demand';
    }, 'w04');
    add('JH-008', (c, a) => {
      sent(c, a, 'reminder', -70);
      sent(c, a, 'final-demand', -52);
      c.previousStage = 'final-demand';
      c.arrangement = { instalment: 1500, day: 1, months: 6, startedAt: iso(-40), missed: 0 };
      this.step(c, 'arrangement', 'Payment arrangement: R 1 500.00 on the 1st of each month for 6 months, on top of the levy. Interest suspended while it’s kept.', zanele, undefined, iso(-40));
      c.stage = 'arrangement';
    }, 'w05');
    add('MC-044', (c, a) => {
      sent(c, a, 'reminder', -62);
      sent(c, a, 'final-demand', -40);
      c.stage = 'final-demand';
      c.demandApproval = { workItemId: 'w-lod-mc-044', status: 'approved', decidedBy: 'Trustees of Midrand Crossing', decidedAt: iso(-8) };
      this.step(c, 'final-demand', 'Trustees approved a letter of demand (Trustees of Midrand Crossing)', 'Trustees of Midrand Crossing', undefined, iso(-8));
    }, 'w06');

    // A few Kingfisher Court accounts at the reminder stage, and a dispute at The Willows.
    const inArrears = (schemeId: string) =>
      [...this.db.accounts.values()].filter((a) => a.schemeId === schemeId && overdueOf(a.ageing) > 0 && a.status === 'arrears' && !this.cases.has(a.id));
    inArrears('kingfisher-court')
      .slice(0, 3)
      .forEach((a, i) => add(a.accountNo, (c) => {
        sent(c, a, 'reminder', -6 - i * 4);
        c.stage = 'reminder';
      }));
    const tw = inArrears('the-willows')[0];
    if (tw) {
      add(tw.accountNo, (c) => {
        sent(c, tw, 'reminder', -20);
        c.previousStage = 'reminder';
        c.stage = 'disputed';
        c.dispute = { reason: 'Owner says the July water recovery was billed twice.', at: iso(-9), by: zanele };
        this.step(c, 'disputed', 'Disputed: Owner says the July water recovery was billed twice.', zanele, undefined, iso(-9));
      });
    }
  }

  private save(): void {
    simulationStorage.save('collections', (): CollectionsSnapshot => ({ cases: [...this.cases.values()], seq: this.seq }));
  }

  private commit(): void {
    this.save();
    this.db.touch();
  }
}
