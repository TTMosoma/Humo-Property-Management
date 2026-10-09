import { Injectable, inject } from '@angular/core';
import {
  BillingAction,
  BillingEvent,
  BillingException,
  BillingLine,
  BillingRun,
  BillingRunSummary,
  Charge,
  DECISION_LABELS,
  EXCEPTION_LABELS,
  FieldErrors,
  NewBillingRun,
  SchemeBillingStatus,
  WorkItem,
  entitlementSet,
  openExceptions,
  periodLabel,
  runTotal,
} from '../../domain';
import { formatRand } from '../../ui/format/money';
import { simulationStorage } from '../simulation/simulation-storage';
import { DocumentStore } from './document-store';
import { RawTransaction } from './ledger';
import { OpsStore } from './ops-store';
import { SettingsStore } from './settings-store';
import { MockDb } from './mock-db';
import { PlatformStore } from './platform-store';
import { round2, seeded } from './random';
import { SCHEME_CHARGES, monthlyCharges, specialLevyAmount } from './seed-portfolio';

/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface BillingSnapshot {
  runs: BillingRun[];
  seq: number;
}

const APPROVERS: WorkItem['approverRoles'] = ['agency-admin', 'finance'];
const DAY = 86_400_000;

/** "2026-11" → months from this month (0 = this month). */
function monthOffset(period: string, now = new Date()): number {
  const [y, m] = period.split('-').map(Number);
  return y * 12 + (m - 1) - (now.getFullYear() * 12 + now.getMonth());
}

function nextPeriodAfter(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const thisPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * The billing "backend" for the prototype: it calculates each account's
 * charges, detects the exceptions a person must decide, and — once the run is
 * approved in Approvals — posts the charges to the ledger and records the
 * statements it sends. Posted runs are never changed again.
 */
@Injectable({ providedIn: 'root' })
export class BillingStore {
  private readonly db = inject(MockDb);
  private readonly docs = inject(DocumentStore);
  private readonly platform = inject(PlatformStore);
  private readonly settings = inject(SettingsStore);
  private readonly ops = inject(OpsStore);

  runs: BillingRun[];
  private seq: number;

  constructor() {
    const saved = simulationStorage.load<BillingSnapshot>('billing');
    if (saved) {
      this.runs = saved.runs;
      this.seq = saved.seq;
    } else {
      this.seq = 100;
      this.runs = this.seedHistory();
      // Waterkloof Ridge's November run is already with the approvers (it replaces fixture approval w07).
      const wre = this.prepare({ schemeId: 'waterkloof-ridge', period: nextPeriodAfter(thisPeriod()) }, 'Priya Naidoo');
      wre.exceptions.forEach((e) => this.applyDecision(wre, e, e.options[0], 'Priya Naidoo'));
      this.sendForApproval(wre, 'Priya Naidoo', 'w07');
      this.runs = [wre, ...this.runs];
      this.commit();
    }
    this.db.workHooks.push((before, after) => this.onDecision(before, after));
  }

  // =================================================================== Reads

  summary(run: BillingRun): BillingRunSummary {
    const posted = run.posted;
    return {
      run,
      scheme: this.db.scheme(run.schemeId),
      total: posted ? posted.total : runTotal(run),
      accounts: posted ? posted.accounts : run.lines.filter((l) => !l.excluded).length,
      openExceptions: openExceptions(run).length,
    };
  }

  status(schemeId: string): SchemeBillingStatus {
    const scheme = this.db.scheme(schemeId);
    const runs = this.runs.filter((r) => r.schemeId === schemeId);
    const done = runs.filter((r) => r.stage === 'posted' || r.stage === 'sent').sort((a, b) => b.period.localeCompare(a.period))[0];
    const current = runs.find((r) => ['preview', 'awaiting-approval', 'approved'].includes(r.stage));
    return {
      scheme,
      levyRoll: round2(this.db.units.filter((u) => u.schemeId === schemeId).reduce((s, u) => s + u.monthlyLevy, 0)),
      lastPosted: done?.posted ? { period: done.period, total: done.posted.total, at: done.posted.at } : undefined,
      current: current ? this.summary(current) : undefined,
      nextPeriod: done ? nextPeriodAfter(done.period) : nextPeriodAfter(thisPeriod()),
    };
  }

  // =================================================================== Commands

  checkCreate(input: NewBillingRun): FieldErrors | null {
    const e: FieldErrors = {};
    if (!this.db.schemes.has(input.schemeId)) e['schemeId'] = 'Choose a scheme.';
    else {
      const s = this.status(input.schemeId);
      if (s.current) e['schemeId'] = `${s.scheme.name} already has a ${periodLabel(s.current.run.period, false)} run in progress (${s.current.run.ref}). Finish or cancel it first.`;
      else if (input.period !== s.nextPeriod) e['period'] = `The next period to bill for ${s.scheme.name} is ${periodLabel(s.nextPeriod)}: periods are billed in order, once.`;
    }
    return Object.keys(e).length ? e : null;
  }

  create(input: NewBillingRun, by: string): string {
    const run = this.prepare(input, by);
    this.runs = [run, ...this.runs];
    this.commit();
    return run.id;
  }

  check(run: BillingRun, action: BillingAction): FieldErrors | null {
    const e: FieldErrors = {};
    const locked = run.stage === 'posted' || run.stage === 'sent';
    switch (action.type) {
      case 'decide': {
        const x = run.exceptions.find((i) => i.id === action.exceptionId);
        if (run.stage !== 'preview') e['decision'] = locked ? 'This run is posted and locked. Correct an account with a journal adjustment.' : 'Decisions are made before the run goes for approval.';
        else if (!x || !x.options.includes(action.decision)) e['decision'] = 'Choose one of the options for this exception.';
        break;
      }
      case 'send-for-approval': {
        if (run.stage !== 'preview') e['stage'] = 'Only a run being prepared can go for approval.';
        const open = openExceptions(run).length;
        if (open) e['exceptions'] = `${open} exception${open === 1 ? '' : 's'} still need${open === 1 ? 's' : ''} a decision.`;
        if (!run.lines.some((l) => !l.excluded)) e['lines'] = 'Nothing would be billed.';
        break;
      }
      case 'post':
        if (run.stage !== 'approved') e['stage'] = run.stage === 'awaiting-approval' ? 'The run is still with the approvers.' : 'Only an approved run can be posted.';
        break;
      case 'send-statements':
        if (run.stage !== 'posted') e['stage'] = 'Statements are sent once the run is posted.';
        else if (!this.ops.isOn('billing.statement-sending', this.db.scheme(run.schemeId).organisationId)) e['stage'] = 'Humo has paused statement sending for a moment. The run stays posted; send the statements again shortly.';
        break;
      case 'cancel':
        if (locked) e['stage'] = 'A posted run can’t be cancelled. Correct accounts with journal adjustments.';
        if (action.reason.trim().length < 5) e['reason'] = 'Give a short reason for the audit log.';
        break;
      case 'comment':
        if (!action.text.trim()) e['text'] = 'Write a comment.';
        break;
    }
    return Object.keys(e).length ? e : null;
  }

  act(id: string, action: BillingAction, by: string): void {
    const run = this.runs.find((r) => r.id === id)!;
    switch (action.type) {
      case 'decide': {
        const x = run.exceptions.find((i) => i.id === action.exceptionId)!;
        this.applyDecision(run, x, action.decision, by, action.note);
        break;
      }
      case 'send-for-approval':
        this.sendForApproval(run, by);
        break;
      case 'post':
        this.post(run, by);
        break;
      case 'send-statements':
        this.sendStatements(run, by);
        break;
      case 'cancel':
        if (run.approvalWorkItemId) this.db.resolveWork(run.ref, ['billing-run-approval'], by);
        run.stage = 'cancelled';
        run.cancelled = { at: new Date().toISOString(), by, reason: action.reason.trim() };
        this.log(run, 'stage', `Cancelled: ${action.reason.trim()}`, by);
        break;
      case 'comment':
        this.log(run, 'comment', action.text.trim(), by);
        break;
    }
    run.version++;
    this.commit();
  }

  // =================================================================== Charges & exceptions

  /** The API's calculation: each account's charges for the period, and what a person must decide. */
  private prepare(input: NewBillingRun, by: string): BillingRun {
    const scheme = this.db.scheme(input.schemeId);
    const cfg = SCHEME_CHARGES[scheme.id] ?? {};
    const offset = monthOffset(input.period);
    const month = periodLabel(input.period, false);
    const r = seeded(`billing-${scheme.id}-${input.period}`);
    const rate = this.settings.billing(scheme.organisationId).interestRate;
    const lines: BillingLine[] = [];
    const exceptions: BillingException[] = [];
    const units = this.db.units.filter((u) => u.schemeId === scheme.id).sort((a, b) => Number(a.number) - Number(b.number) || a.number.localeCompare(b.number));
    let missingMeters = cfg.waterRecovery ? 2 : 0;

    for (const unit of units) {
      const account = this.db.accountForUnit(unit.id);
      if (!account) continue;
      const holder = this.db.persons.get(account.holderPersonId);
      const charges: Charge[] = [{ kind: 'levy', description: `Levy — ${month}`, amount: unit.monthlyLevy }];
      if (cfg.specialLevy) {
        const n = offset - cfg.specialLevy.startMonthOffset + 1;
        if (n >= 1 && n <= cfg.specialLevy.instalments) charges.push({ kind: 'special-levy', description: `${cfg.specialLevy.label} (${n} of ${cfg.specialLevy.instalments})`, amount: specialLevyAmount(unit, cfg) });
      }
      let estimated = false;
      if (cfg.waterRecovery) {
        estimated = missingMeters > 0 && r() < 0.06;
        if (estimated) missingMeters--;
        const amount = Math.round((280 + r() * 280) * 2) / 2;
        charges.push({ kind: 'utility', description: `Water recovery — ${month} (${estimated ? 'estimated' : 'metered'})`, amount });
      }
      const overdue = account.ageing.d30 + account.ageing.d60 + account.ageing.d90 + account.ageing.d120;
      if (overdue > 0 && rate > 0) charges.push({ kind: 'interest', description: `Interest on arrears (${rate}% per month)`, amount: round2((overdue * rate) / 100) });

      const line: BillingLine = {
        accountId: account.id,
        accountNo: account.accountNo,
        unitNumber: unit.number,
        holderName: holder?.displayName ?? '—',
        charges,
        total: round2(charges.reduce((s, c) => s + c.amount, 0)),
        excluded: false,
      };
      lines.push(line);

      const add = (kind: BillingException['kind'], detail: string, options: BillingException['options']) =>
        exceptions.push({ id: `${account.id}-${kind}`, accountId: account.id, accountNo: account.accountNo, kind, detail, options });
      if (!holder) add('no-holder', 'No current owner on the account: there’s nobody to bill.', ['exclude']);
      if (estimated) add('meter-missing', `No water meter reading for unit ${unit.number}. The 3-month average is ${formatRand(line.charges.find((c) => c.kind === 'utility')!.amount)}.`, ['estimate', 'exclude']);
      const lastLevy = this.db.ledger(account.id).transactions.filter((t) => t.type === 'levy').at(-1)?.amount;
      if (lastLevy !== undefined && Math.abs(lastLevy - unit.monthlyLevy) > 0.005) add('levy-changed', `Levy changes from ${formatRand(lastLevy)} to ${formatRand(unit.monthlyLevy)}. Check the trustees approved it.`, ['include', 'exclude']);
      if (account.status === 'arrangement') add('arrangement', `On a payment arrangement: interest of ${formatRand(charges.find((c) => c.kind === 'interest')?.amount ?? 0)} is usually suspended while it’s kept.`, ['no-interest', 'include']);
      if (account.status === 'handed-over') add('handed-over', 'With the scheme’s attorney: the statement is copied to them.', ['acknowledge', 'exclude']);
      if (account.balance < -3 * monthlyCharges(unit)) add('large-credit', `In credit by ${formatRand(-account.balance)}: more than three months’ charges. Consider a refund.`, ['acknowledge']);
    }

    const previous = this.runs.filter((x) => x.schemeId === scheme.id && x.posted).sort((a, b) => b.period.localeCompare(a.period))[0];
    const [y, m] = input.period.split('-');
    const run: BillingRun = {
      id: `br-${++this.seq}`,
      version: 1,
      ref: `BR-${scheme.code}-${y.slice(2)}${m}`,
      schemeId: scheme.id,
      period: input.period,
      stage: 'preview',
      createdAt: new Date().toISOString(),
      createdBy: by,
      lines,
      exceptions,
      previousTotal: previous?.posted?.total,
      events: [],
    };
    this.log(run, 'stage', `Prepared: ${lines.length} accounts, ${formatRand(runTotal(run))}, ${exceptions.length} exception${exceptions.length === 1 ? '' : 's'} to decide`, by);
    return run;
  }

  private applyDecision(run: BillingRun, x: BillingException, decision: BillingException['decision'] & string, by: string, note?: string): void {
    x.decision = decision;
    x.decidedBy = by;
    x.note = note?.trim() || undefined;
    const line = run.lines.find((l) => l.accountId === x.accountId)!;
    // Re-derive the line from all of its account's decisions.
    const decisions = run.exceptions.filter((e) => e.accountId === x.accountId && e.decision).map((e) => e.decision);
    line.excluded = decisions.includes('exclude');
    if (decisions.includes('no-interest')) line.charges = line.charges.filter((c) => c.kind !== 'interest');
    line.total = round2(line.charges.reduce((s, c) => s + c.amount, 0));
    this.log(run, 'exception', `${x.accountNo} · ${EXCEPTION_LABELS[x.kind]}: ${DECISION_LABELS[decision]}${x.note ? ` (${x.note})` : ''}`, by);
  }

  private sendForApproval(run: BillingRun, by: string, workId = `w-${run.id}-approval`): void {
    const total = runTotal(run);
    const scheme = this.db.scheme(run.schemeId);
    const included = run.lines.filter((l) => !l.excluded).length;
    const special = run.lines.find((l) => l.charges.some((c) => c.kind === 'special-levy'))?.charges.find((c) => c.kind === 'special-levy');
    this.db.addWork({
      id: workId,
      ref: run.ref,
      kind: 'approval',
      type: 'billing-run-approval',
      title: `${periodLabel(run.period, false)} billing — ${scheme.name}`,
      detail: `${included} accounts · ${run.exceptions.length} exception${run.exceptions.length === 1 ? '' : 's'} decided${special ? ` · ${special.description.toLowerCase()} included` : ''}`,
      schemeId: run.schemeId,
      amount: total,
      createdAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 3 * DAY).toISOString(),
      assigneeId: null,
      approverRoles: APPROVERS,
      evidence: ['Charges preview', `Exceptions report (${run.exceptions.length} decided)`, run.previousTotal ? `Last month ${formatRand(run.previousTotal)}` : 'First run in Humo'],
      status: 'open',
      route: `/finance/billing/${run.id}`,
    });
    run.approvalWorkItemId = workId;
    run.stage = 'awaiting-approval';
    this.log(run, 'approval', `Sent for approval: ${formatRand(total)} across ${included} accounts`, by);
  }

  /** Writes the charges to the ledger, dated the 1st of the period. From here the run is locked. */
  private post(run: BillingRun, by: string): void {
    const date = `${run.period}-01T06:00:00`;
    const included = run.lines.filter((l) => !l.excluded);
    for (const l of included) {
      const tx: RawTransaction[] = l.charges.map((c, i) => ({
        id: `${run.id}-${l.accountId}-${i}`,
        accountId: l.accountId,
        date: new Date(date).toISOString(),
        type: c.kind,
        description: c.description,
        reference: run.ref,
        amount: c.amount,
      }));
      this.db.postCharges(l.accountId, tx);
    }
    const total = runTotal(run);
    run.posted = { at: new Date().toISOString(), by, accounts: included.length, total };
    run.stage = 'posted';
    this.log(run, 'posting', `Posted ${formatRand(total)} to ${included.length} accounts. The run is now locked.`, by);
  }

  /** Statements go out by each account's chosen channel; each records the template version it was issued with. */
  private sendStatements(run: BillingRun, by: string): void {
    const scheme = this.db.scheme(run.schemeId);
    const ent = entitlementSet(this.platform.customers().find((c) => c.organisationId === scheme.organisationId)?.entitlements ?? []);
    const template = this.docs.issuingTemplate(scheme.organisationId, 'levy-statement', ent);
    const counts = { email: 0, post: 0, portal: 0 };
    for (const l of run.lines.filter((x) => !x.excluded)) {
      const account = this.db.accounts.get(l.accountId)!;
      this.db.recordStatement(l.accountId, run.period, template);
      counts[account.statementBy]++;
    }
    run.statements = { at: new Date().toISOString(), by, ...counts, template };
    run.stage = 'sent';
    this.log(run, 'statements', `Statements sent: ${counts.email} by email, ${counts.portal} to the portal, ${counts.post} by post`, by);
  }

  // =================================================================== Approvals decided elsewhere

  private onDecision(before: WorkItem, after: WorkItem): void {
    if (after.type !== 'billing-run-approval' || before.status === after.status) return;
    const run = this.runs.find((r) => r.approvalWorkItemId === after.id);
    if (!run || run.stage !== 'awaiting-approval') return;
    const by = after.decidedBy ?? 'Approver';
    if (after.status === 'approved') {
      run.stage = 'approved';
      run.approval = { decidedAt: after.decidedAt ?? new Date().toISOString(), decidedBy: by, comment: after.comment };
      this.log(run, 'approval', `Approved by ${by}`, by);
    } else if (after.status === 'rejected') {
      run.stage = 'preview';
      run.approvalWorkItemId = undefined;
      this.log(run, 'approval', `Sent back by ${by}${after.comment ? `: “${after.comment}”` : ''}`, by);
    }
    run.version++;
    this.save();
  }

  // =================================================================== Internals

  /** Last month's run for every scheme, already posted and sent (totals only: the ledger holds the detail). */
  private seedHistory(): BillingRun[] {
    const period = thisPeriod();
    const [y, m] = period.split('-');
    return [...this.db.schemes.values()].map((scheme) => {
      const units = this.db.units.filter((u) => u.schemeId === scheme.id);
      const total = round2(units.reduce((s, u) => s + monthlyCharges(u), 0));
      const accounts = units.map((u) => this.db.accountForUnit(u.id)).filter((a) => !!a);
      const at = new Date(Date.now() - (new Date().getDate() + 5) * DAY).toISOString();
      const template = { templateId: 'levy-statement.standard', version: 1 };
      return {
        id: `br-${scheme.id}-${period}`,
        version: 1,
        ref: `BR-${scheme.code}-${y.slice(2)}${m}`,
        schemeId: scheme.id,
        period,
        stage: 'sent' as const,
        createdAt: at,
        createdBy: 'Priya Naidoo',
        lines: [],
        exceptions: [],
        posted: { at, by: 'Priya Naidoo', accounts: accounts.length, total },
        statements: {
          at,
          by: 'Priya Naidoo',
          email: accounts.filter((a) => a!.statementBy === 'email').length,
          portal: accounts.filter((a) => a!.statementBy === 'portal').length,
          post: accounts.filter((a) => a!.statementBy === 'post').length,
          template,
        },
        events: [{ id: `be-${scheme.id}-h`, at, kind: 'posting' as const, text: `Posted ${formatRand(total)} to ${accounts.length} accounts; statements sent`, by: 'Priya Naidoo' }],
      };
    });
  }

  private log(run: BillingRun, kind: BillingEvent['kind'], text: string, by: string): void {
    run.events = [{ id: `be-${++this.seq}`, at: new Date().toISOString(), kind, text, by }, ...run.events];
  }

  private save(): void {
    simulationStorage.save('billing', (): BillingSnapshot => ({ runs: this.runs, seq: this.seq }));
  }

  private commit(): void {
    this.save();
    this.db.touch();
  }
}
