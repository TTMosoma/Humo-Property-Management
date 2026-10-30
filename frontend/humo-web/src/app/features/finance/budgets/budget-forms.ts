import { Router } from '@angular/router';
import { BudgetDataSource, BudgetView, Meeting, Scheme } from '../../../domain';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { openForm } from '../../shared/form-drawer';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Next year's draft, or this year's captured part-way (D28). `yearEnds`: each scheme's financial year end month, from
 * its profile; the first budget for a scheme sets it.
 */
export function newBudgetForm(drawer: DrawerService, data: BudgetDataSource, router: Router, schemes: Scheme[], yearEnds: Record<string, number>, schemeId?: string): void {
  const first = schemeId ?? schemes[0]?.id ?? '';
  openForm(drawer, {
    eyebrow: 'Budgets',
    title: 'New budget',
    intro: 'Next year’s starts from this year’s, with every line increased by the percentage you choose. This year’s is for a scheme new to Humo Property Management: capture the budget the owners approved, then the spending so far.',
    fields: [
      { key: 'schemeId', label: 'Scheme', type: 'select', required: true, options: schemes.map((s) => ({ value: s.id, label: s.name })) },
      {
        key: 'year', label: 'Which year', type: 'select', required: true,
        options: [{ value: 'next', label: 'Next year’s, for the AGM' }, { value: 'current', label: 'This year’s, already approved (new to Humo Property Management)' }],
      },
      { key: 'increasePct', label: 'Increase on this year (%)', type: 'number', required: true, half: true, help: 'E.g. inflation plus known increases (insurance, municipal).', showIf: (v) => v['year'] === 'next' },
      {
        key: 'financialYearEnd', label: 'Financial year ends in', type: 'select', required: true, half: true, options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
        help: 'A scheme setting: change it in Settings › Levies & billing.',
      },
    ],
    initial: { schemeId: first, year: 'next', increasePct: '7', financialYearEnd: String(yearEnds[first] ?? 2) },
    changed: (key, v) => (key === 'schemeId' ? { ...v, financialYearEnd: String(yearEnds[v['schemeId']] ?? 2) } : v),
    submitLabel: 'Create',
    submit: (v) =>
      data.create({ schemeId: v['schemeId'], year: v['year'] as 'current' | 'next', increasePct: v['year'] === 'next' ? Number(v['increasePct']) : 0, financialYearEnd: Number(v['financialYearEnd']) }),
    success: (_id, v) => (v['year'] === 'current' ? 'Captured as a draft. Check the lines, enter the spending so far, then record the owners’ approval.' : 'Draft created.'),
    done: (id) => router.navigate(['/finance/budgets', id]),
    failure: 'The budget wasn’t created',
  });
}

/** The owners approved it at an AGM (D28): recorded by hand until meetings are on Humo PM. A fresh passkey; the figures are fixed after. */
export function recordApprovalForm(drawer: DrawerService, data: BudgetDataSource, v: BudgetView): void {
  openForm(drawer, {
    eyebrow: `${v.scheme.name} · ${v.budget.year}`,
    title: 'Record the owners’ approval',
    intro: 'For a budget the owners approved at an AGM. Take the date and the resolution from the signed minutes. The figures can’t change after this.',
    fields: [
      { key: 'approvedOn', label: 'Date of the meeting', type: 'date', required: true, half: true },
      { key: 'resolutionRef', label: 'Resolution', type: 'text', required: true, half: true, placeholder: 'e.g. AGM 2026 resolution 4' },
    ],
    submitLabel: 'Record approval',
    stepUp: { action: 'approve-large-amount', detail: `Record the owners’ approval of ${v.scheme.name}’s ${v.budget.year} budget` },
    submit: (f) => data.act(v.budget.id, { type: 'record-approval', approvedOn: f['approvedOn'], resolutionRef: f['resolutionRef'] }, v.budget.version),
    success: () => 'Recorded: the budget is approved.',
    failure: 'The approval wasn’t recorded',
  });
}

/** A year captured part-way (D28): what the previous system recorded up to a date, by line. Humo PM's records count from the day after. */
export function openingForm(drawer: DrawerService, data: BudgetDataSource, v: BudgetView): void {
  const lines = v.lines.filter((l) => l.line.kind === 'expense' || l.line.category === 'Levies').map((l) => l.line);
  const bf = v.budget.broughtForward;
  openForm(drawer, {
    eyebrow: `${v.scheme.name} · ${v.budget.year}`,
    title: 'Spending before Humo Property Management',
    intro: 'From the previous system’s ledger: what each line had spent (and the levies billed) up to the date below. Humo Property Management’s own records count from the day after.',
    fields: [
      { key: 'to', label: 'Up to and including', type: 'date', required: true, half: true },
      ...lines.map((l, i) => ({ key: `l${i}`, label: `${l.category} (R)`, type: 'number' as const, half: true })),
    ],
    initial: { to: bf?.to ?? '', ...Object.fromEntries(lines.map((l, i) => [`l${i}`, bf?.amounts[l.category] ? String(bf.amounts[l.category]) : ''])) },
    submitLabel: 'Save',
    submit: (f) =>
      data.act(v.budget.id, { type: 'set-opening', to: f['to'], amounts: Object.fromEntries(lines.map((l, i) => [l.category, Number(f[`l${i}`] || 0)])) }, v.budget.version),
    success: () => 'Saved. Actuals now include the spending before Humo Property Management.',
    failure: 'It wasn’t saved',
  });
}

export function lineForm(drawer: DrawerService, data: BudgetDataSource, v: BudgetView, line?: { category: string; kind: 'income' | 'expense'; annual: number }): void {
  openForm(drawer, {
    eyebrow: `${v.scheme.name} · ${v.budget.year}`,
    title: line ? line.category : 'Add a line',
    fields: [
      { key: 'category', label: 'Category', type: 'text', required: true, placeholder: 'e.g. Lift maintenance contract' },
      { key: 'kind', label: 'Kind', type: 'select', required: true, half: true, options: [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] },
      { key: 'annual', label: 'For the year (R)', type: 'number', required: true, half: true },
    ],
    initial: line ? { category: line.category, kind: line.kind, annual: String(line.annual) } : { kind: 'expense' },
    submitLabel: 'Save',
    submit: (f) => data.act(v.budget.id, { type: 'set-line', category: f['category'], kind: f['kind'] as 'income' | 'expense', annual: Number(f['annual']) }, v.budget.version),
    success: () => 'Saved.',
    failure: 'The line wasn’t saved',
  });
}

/** The owners approve the budget at the AGM: it becomes an agenda item, and the resolution on it approves the budget. */
export function proposeForm(drawer: DrawerService, data: BudgetDataSource, v: BudgetView, agms: Meeting[]): void {
  openForm(drawer, {
    eyebrow: `${v.scheme.name} · ${v.budget.year}`,
    title: 'Put it to the AGM',
    intro: 'Adds “Approve the budget” to the AGM’s agenda. When the meeting records a resolution on that item and it passes, the budget is approved. The figures can’t change after this.',
    fields: [{ key: 'meetingId', label: 'AGM', type: 'select', required: true, options: agms.map((m) => ({ value: m.id, label: `${m.ref} · ${m.title}` })) }],
    initial: { meetingId: agms[0]?.id ?? '' },
    submitLabel: 'Add to the agenda',
    submit: (f) => data.act(v.budget.id, { type: 'propose', meetingId: f['meetingId'] }, v.budget.version),
    success: () => 'On the AGM agenda.',
    failure: 'It wasn’t added to the agenda',
  });
}
