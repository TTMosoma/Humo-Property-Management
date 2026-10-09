import { Router } from '@angular/router';
import { BudgetDataSource, BudgetView, Meeting, Scheme } from '../../../domain';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { openForm } from '../../shared/form-drawer';

export function newBudgetForm(drawer: DrawerService, data: BudgetDataSource, router: Router, schemes: Scheme[], schemeId?: string): void {
  openForm(drawer, {
    eyebrow: 'Budgets',
    title: 'Draft next year’s budget',
    intro: 'It starts from this year’s budget, with every line increased by the percentage you choose. Adjust the lines, then put it on the AGM agenda.',
    fields: [
      { key: 'schemeId', label: 'Scheme', type: 'select', required: true, options: schemes.map((s) => ({ value: s.id, label: s.name })) },
      { key: 'increasePct', label: 'Increase on this year (%)', type: 'number', required: true, half: true, help: 'E.g. inflation plus known increases (insurance, municipal).' },
    ],
    initial: { schemeId: schemeId ?? schemes[0]?.id ?? '', increasePct: '7' },
    submitLabel: 'Create draft',
    submit: (v) => data.create({ schemeId: v['schemeId'], increasePct: Number(v['increasePct']) }),
    success: () => 'Draft created.',
    done: (id) => router.navigate(['/finance/budgets', id]),
    failure: 'The draft wasn’t created',
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
