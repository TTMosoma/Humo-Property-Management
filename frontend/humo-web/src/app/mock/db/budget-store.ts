import { Injectable, inject } from '@angular/core';
import { Budget, BudgetAction, BudgetLine, BudgetLineView, BudgetView, FieldErrors, Invoice, NewBudget, financialYearLabel } from '../../domain';
import { simulationStorage } from '../simulation/simulation-storage';
import { ComplianceStore } from './compliance-store';
import { GovernanceStore } from './governance-store';
import { MaintenanceStore } from './maintenance-store';
import { MockDb } from './mock-db';
import { seeded } from './random';

/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface BudgetSnapshot {
  budgets: Budget[];
  seq: number;
}

/** Expense categories and their share of the levy roll in a typical scheme budget. */
const EXPENSES: [string, number][] = [
  ['Insurance', 0.17],
  ['Security services', 0.14],
  ['Garden services', 0.05],
  ['Utilities (common property)', 0.11],
  ['Management fees', 0.08],
  ['Audit & administration', 0.02],
  ['Maintenance — building', 0.07],
  ['Maintenance — plumbing', 0.03],
  ['Maintenance — electrical', 0.02],
  ['Maintenance — security', 0.02],
  ['Maintenance — other', 0.03],
  ['Reserve fund contribution', 0.1],
];

/** The budget line a paid invoice counts against: its job's category, or the contract's trade. */
export function budgetCategoryFor(category: string): string {
  const c = category.toLowerCase();
  if (/plumbing/.test(c)) return 'Maintenance — plumbing';
  if (/electrical/.test(c)) return 'Maintenance — electrical';
  if (/security|gate/.test(c)) return 'Maintenance — security';
  if (/building|roof|paint/.test(c)) return 'Maintenance — building';
  return 'Maintenance — other';
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The day after a yyyy-mm-dd date. */
const next = (d: string) => iso(new Date(new Date(`${d}T12:00:00`).getTime() + 86_400_000));
/** Categories Humo PM records spending for (supplier invoices); the rest (insurance, municipal, audit…) aren't tracked yet. */
const tracked = (category: string) => category.startsWith('Maintenance') || category.endsWith('services');

/**
 * Budgets for the prototype. Actuals come from Humo PM's own records: levies
 * billed (the levy roll for the months gone) and supplier invoices paid or
 * approved, by category. Approval happens at the AGM: proposing adds an agenda
 * item; a passed resolution on that item approves the budget.
 */
@Injectable({ providedIn: 'root' })
export class BudgetStore {
  private readonly db = inject(MockDb);
  private readonly maintenance = inject(MaintenanceStore);
  private readonly compliance = inject(ComplianceStore);
  private readonly governance = inject(GovernanceStore);

  budgets: Budget[];
  private seq: number;

  constructor() {
    const saved = simulationStorage.load<BudgetSnapshot>('budgets');
    this.budgets = saved?.budgets ?? [];
    this.seq = saved?.seq ?? 100;
    if (!saved) this.seed();
    else if (this.budgets.some((b) => this.needsOpening(b))) {
      for (const b of this.budgets.filter((x) => this.needsOpening(x))) b.broughtForward = this.opening(b);
      this.save();
    }
  }

  // =================================================================== Years

  /** The financial year containing today (offset 0), or the next one (1). */
  private year(schemeId: string, offset = 0): { from: string; to: string; label: string } {
    const m = this.compliance.profile(schemeId).financialYearEnd;
    const now = new Date();
    let end = new Date(now.getFullYear(), m, 0);
    if (end < new Date(now.getFullYear(), now.getMonth(), now.getDate())) end = new Date(now.getFullYear() + 1, m, 0);
    end = new Date(end.getFullYear() + offset, m, 0);
    const from = new Date(end.getFullYear() - 1, m, 1);
    return { from: iso(from), to: iso(end), label: financialYearLabel(end.getFullYear(), m) };
  }

  // =================================================================== Reads

  /** Expense actuals by category for a scheme and date range: paid, and approved-but-unpaid. */
  private spend(schemeId: string, from: string, to: string): Map<string, { paid: number; committed: number }> {
    const out = new Map<string, { paid: number; committed: number }>();
    const inRange = (d?: string) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;
    for (const i of this.maintenance.invoices.filter((x) => x.schemeId === schemeId)) {
      const cat = this.categoryOf(i);
      const g = out.get(cat) ?? { paid: 0, committed: 0 };
      if (i.status === 'paid' && inRange(i.paidAt ?? i.receivedAt)) g.paid += i.amount;
      else if ((i.status === 'approved' || i.status === 'in-batch') && inRange(i.receivedAt)) g.committed += i.amount;
      out.set(cat, g);
    }
    return out;
  }

  private categoryOf(i: Invoice): string {
    const job = i.jobId ? this.maintenance.jobs.find((j) => j.id === i.jobId) : undefined;
    if (job) return budgetCategoryFor(job.category);
    const trade = this.maintenance.supplier(i.supplierId)?.trades[0] ?? '';
    if (trade === 'Security') return 'Security services';
    if (trade === 'Gardens') return 'Garden services';
    return budgetCategoryFor(trade);
  }

  view(b: Budget): BudgetView {
    this.checkApproval(b);
    const scheme = this.db.scheme(b.schemeId);
    const start = new Date(`${b.from}T00:00:00`).getTime();
    const end = new Date(`${b.to}T23:59:59`).getTime();
    const elapsed = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
    // Levies are billed monthly in advance: the months whose first day has passed.
    const from = new Date(`${b.from}T00:00:00`);
    const now = new Date();
    const monthsBilled = Math.min(12, Math.max(0, now.getFullYear() * 12 + now.getMonth() - (from.getFullYear() * 12 + from.getMonth()) + 1));
    const levyRoll = this.db.units.filter((u) => u.schemeId === b.schemeId).reduce((n, u) => n + u.monthlyLevy, 0);
    const bf = b.broughtForward;
    const spend = this.spend(b.schemeId, bf ? next(bf.to) : b.from, b.to);
    const lines: BudgetLineView[] = b.lines.map((line) => {
      const levies = line.kind === 'income' && line.category === 'Levies';
      const toDate = Math.round(levies ? (line.annual * monthsBilled) / 12 : line.annual * elapsed);
      let actual: number | null = null;
      let committed = 0;
      if (levies) actual = Math.round(levyRoll * monthsBilled);
      else if (line.kind === 'expense') {
        const s = spend.get(line.category);
        if (s || tracked(line.category)) {
          actual = Math.round((s?.paid ?? 0) + (bf?.amounts[line.category] ?? 0));
          committed = Math.round(s?.committed ?? 0);
        }
      }
      return { line, toDate, actual, committed, variance: actual === null ? null : actual - toDate };
    });
    const sum = (k: 'income' | 'expense', f: (l: BudgetLineView) => number) => lines.filter((l) => l.line.kind === k).reduce((n, l) => n + f(l), 0);
    const income = sum('income', (l) => l.line.annual);
    const expense = sum('expense', (l) => l.line.annual);
    return {
      budget: b,
      scheme,
      elapsed,
      lines,
      totals: { income, expense, surplus: income - expense, incomeActual: sum('income', (l) => l.actual ?? 0), expenseActual: sum('expense', (l) => l.actual ?? 0) },
      overspent: lines.filter((l) => l.line.kind === 'expense' && l.actual !== null && l.toDate > 0 && l.actual + l.committed > l.toDate * 1.1).map((l) => l.line.category),
    };
  }

  inScope(schemeIds: string[]): BudgetView[] {
    const ids = new Set(schemeIds);
    return this.budgets.filter((b) => ids.has(b.schemeId)).map((b) => this.view(b));
  }

  get(id: string): Budget | undefined {
    return this.budgets.find((b) => b.id === id);
  }

  /** For approval cards: this year's approved line for the category, with what's been spent. */
  lineFor(schemeId: string, category: string): { category: string; annual: number; spent: number } | undefined {
    const y = this.year(schemeId);
    const b = this.budgets.find((x) => x.schemeId === schemeId && x.from === y.from && x.status === 'approved');
    const cat = budgetCategoryFor(category);
    const line = b?.lines.find((l) => l.category === cat);
    if (!b || !line) return undefined;
    const bf = b.broughtForward;
    const s = this.spend(schemeId, bf ? next(bf.to) : b.from, b.to).get(cat);
    return { category: cat, annual: line.annual, spent: Math.round((s?.paid ?? 0) + (s?.committed ?? 0) + (bf?.amounts[cat] ?? 0)) };
  }

  /** A proposed budget whose AGM resolution passed is approved (the API does this when the resolution is recorded). */
  private checkApproval(b: Budget): void {
    if (b.status !== 'proposed' || !b.agm) return;
    const r = this.governance.resolutions.find((x) => x.meetingId === b.agm!.meetingId && x.agendaItemId === b.agm!.agendaItemId && x.outcome === 'passed');
    if (!r) return;
    b.status = 'approved';
    b.approved = { at: r.decidedAt ?? r.proposedAt, resolutionRef: r.ref, meetingId: b.agm.meetingId };
    b.version++;
    this.save();
  }

  // =================================================================== Commands

  checkCreate(input: NewBudget): FieldErrors | null {
    const e: FieldErrors = {};
    if (!this.db.schemes.has(input.schemeId)) return { schemeId: 'Choose a scheme.' };
    const next = this.year(input.schemeId, 1);
    if (this.budgets.some((b) => b.schemeId === input.schemeId && b.from === next.from)) e['schemeId'] = `There’s already a ${next.label} budget for this scheme.`;
    if (!(input.increasePct >= -20 && input.increasePct <= 30)) e['increasePct'] = 'Between −20% and 30%.';
    return Object.keys(e).length ? e : null;
  }

  create(input: NewBudget, by: string): string {
    const now = this.year(input.schemeId);
    const next = this.year(input.schemeId, 1);
    const base = this.budgets.find((b) => b.schemeId === input.schemeId && b.from === now.from);
    const f = 1 + input.increasePct / 100;
    const lines = base ? base.lines.map((l) => ({ ...l, annual: Math.round((l.annual * f) / 100) * 100 })) : this.defaultLines(input.schemeId);
    const id = `bud-${++this.seq}`;
    this.budgets.push({ id, version: 1, schemeId: input.schemeId, year: next.label, from: next.from, to: next.to, status: 'draft', lines, createdBy: by, updatedAt: new Date().toISOString() });
    this.commit();
    return id;
  }

  check(id: string, a: BudgetAction): FieldErrors | null {
    const b = this.get(id);
    if (!b) return { id: 'This budget no longer exists.' };
    if (b.status === 'approved') return { id: 'An approved budget can’t change: the owners approved these figures.' };
    if (b.status === 'proposed' && a.type !== 'propose') return { id: 'It’s on the AGM agenda: the figures are what the owners will vote on.' };
    switch (a.type) {
      case 'set-line':
        if (a.category.trim().length < 3) return { category: 'Name the category.' };
        if (!(a.annual >= 0)) return { annual: 'An amount of R 0 or more.' };
        return null;
      case 'remove-line':
        return b.lines.some((l) => l.category === a.category) ? null : { category: 'No such line.' };
      case 'propose': {
        const m = this.governance.meetings.find((x) => x.id === a.meetingId);
        if (!m || m.type !== 'agm' || m.schemeId !== b.schemeId) return { meetingId: 'Choose this scheme’s AGM.' };
        if (m.stage !== 'draft') return { meetingId: 'Notice has gone out: the agenda is fixed. Propose it at the next AGM, or at an SGM.' };
        return b.status === 'proposed' ? { id: 'Already on an AGM agenda.' } : null;
      }
    }
  }

  act(id: string, a: BudgetAction, by: string): void {
    const b = this.get(id)!;
    switch (a.type) {
      case 'set-line': {
        const i = b.lines.findIndex((l) => l.category === a.category.trim());
        const line: BudgetLine = { category: a.category.trim(), kind: a.kind, annual: Math.round(a.annual) };
        if (i >= 0) b.lines[i] = line;
        else b.lines.push(line);
        break;
      }
      case 'remove-line':
        b.lines = b.lines.filter((l) => l.category !== a.category);
        break;
      case 'propose': {
        const m = this.governance.meetings.find((x) => x.id === a.meetingId)!;
        const total = b.lines.filter((l) => l.kind === 'expense').reduce((n, l) => n + l.annual, 0);
        // Another budget may already be on this agenda's budget item (rare: two years at one AGM).
        const taken = this.budgets.filter((x) => x.id !== b.id && x.agm?.meetingId === m.id).map((x) => x.agm!.agendaItemId);
        const notes = `The ${b.year} budget: expenses of R ${total.toLocaleString('en-ZA')} for the year from ${b.from}. A resolution on this item approves it.`;
        const itemId = this.governance.placeOnAgenda(m.id, /budget/i, `Approve the ${b.year} budget`, notes, by, taken);
        b.agm = { meetingId: m.id, meetingRef: m.ref, agendaItemId: itemId };
        b.status = 'proposed';
        break;
      }
    }
    b.updatedAt = new Date().toISOString();
    b.version++;
    this.commit();
  }

  // =================================================================== Seed

  private defaultLines(schemeId: string): BudgetLine[] {
    const roll = this.db.units.filter((u) => u.schemeId === schemeId).reduce((n, u) => n + u.monthlyLevy, 0) * 12;
    const r = seeded(`budget:${schemeId}`);
    const round = (n: number) => Math.round(n / 1000) * 1000;
    return [
      { category: 'Levies', kind: 'income', annual: round(roll) },
      { category: 'Interest & other income', kind: 'income', annual: round(roll * 0.01) },
      ...EXPENSES.map(([category, share]): BudgetLine => ({ category, kind: 'expense', annual: round(roll * share * (0.85 + r() * 0.3)) })),
    ];
  }

  /** This year's approved budget for every scheme; Kingfisher Court also has next year's draft, for its AGM. */
  private seed(): void {
    for (const s of [...this.db.schemes.values()].filter((x) => x.organisationId === 'acacia' && x.status === 'active')) {
      const y = this.year(s.id);
      const b: Budget = { id: `bud-${s.code.toLowerCase()}-${y.from.slice(0, 4)}`, version: 1, schemeId: s.id, year: y.label, from: y.from, to: y.to, status: 'approved', lines: this.defaultLines(s.id), createdBy: 'Priya Naidoo', updatedAt: new Date(`${y.from}T09:00:00`).toISOString(), approved: { at: new Date(`${y.from}T18:00:00`).toISOString(), resolutionRef: 'AGM resolution (before Humo Property Management)' } };
      if (this.needsOpening(b)) b.broughtForward = this.opening(b);
      this.budgets.push(b);
    }
    this.create({ schemeId: 'kingfisher-court', increasePct: 7 }, 'Priya Naidoo');
  }

  /** Seeded budgets from before Humo PM predate its records: they carry the year's spending so far from the previous system. */
  private needsOpening(b: Budget): boolean {
    return b.status === 'approved' && !b.broughtForward && !b.approved?.meetingId && b.from < iso(new Date());
  }

  private opening(b: Budget): Budget['broughtForward'] {
    // Humo PM's records start about six weeks back; before that, the year to date comes from the import.
    const cutoff = new Date(Date.now() - 45 * 86_400_000);
    const to = iso(cutoff) < b.from ? b.from : iso(cutoff);
    const start = new Date(`${b.from}T00:00:00`).getTime();
    const end = new Date(`${b.to}T23:59:59`).getTime();
    const share = Math.max(0, Math.min(1, (new Date(`${to}T23:59:59`).getTime() - start) / (end - start)));
    const r = seeded(`opening:${b.id}`);
    const amounts: Record<string, number> = {};
    for (const l of b.lines.filter((x) => x.kind === 'expense' && tracked(x.category))) {
      // Most lines run close to budget; now and then one runs well over (a burst pipe, a lift motor).
      const factor = r() < 0.12 ? 1.18 + r() * 0.2 : 0.78 + r() * 0.27;
      amounts[l.category] = Math.round((l.annual * share * factor) / 10) * 10;
    }
    return { to, amounts };
  }

  private save(): void {
    simulationStorage.save('budgets', (): BudgetSnapshot => ({ budgets: this.budgets, seq: this.seq }));
  }

  private commit(): void {
    this.save();
    this.db.touch();
  }
}
