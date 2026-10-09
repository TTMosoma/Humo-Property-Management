import { ComplianceDataSource, ComplianceItem, Scheme } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { openForm, today } from '../shared/form-drawer';

const REFERENCE_HELP: Record<string, string> = {
  agm: 'Where the record is, e.g. “AGM held 12 Sep, minutes on file” (for an AGM held outside Humo PM).',
  'financial-statements': 'E.g. “Audit report signed 28 Aug by Moore Johannesburg”.',
  'csos-return': 'The CSOS submission reference.',
};

/** For year-based items: the submission or sign-off, with its reference. */
export function recordForm(drawer: DrawerService, data: ComplianceDataSource, item: ComplianceItem, schemeName: string): void {
  openForm(drawer, {
    eyebrow: `${item.ref} · ${schemeName}`,
    title: `Record ${item.title.toLowerCase()} as done`,
    intro: `For the ${item.period} financial year. It shows on the item as evidence, with your name and the date.`,
    fields: [
      { key: 'reference', label: 'Reference', type: 'text', required: true, help: REFERENCE_HELP[item.type] },
      { key: 'note', label: 'Note', type: 'textarea' },
    ],
    submitLabel: 'Record as done',
    submit: (v) => data.act(item.id, { type: 'record', reference: v['reference'], note: v['note'] }),
    success: () => 'Recorded. The item is complete.',
    failure: 'It wasn’t recorded',
  });
}

export function completeManualForm(drawer: DrawerService, data: ComplianceDataSource, item: ComplianceItem): void {
  openForm(drawer, {
    eyebrow: item.ref,
    title: `Mark “${item.title}” as done`,
    fields: [{ key: 'note', label: 'How it was done', type: 'textarea', required: true, placeholder: 'e.g. Inspected 14 Oct by AquaCare; certificate uploaded to the scheme' }],
    submitLabel: 'Mark as done',
    submit: (v) => data.act(item.id, { type: 'complete-manual', note: v['note'] }, item.version),
    success: () => 'Done.',
    failure: 'It wasn’t marked as done',
  });
}

/** Anything Humo doesn't generate: a pool inspection, an electrical certificate, a municipal deadline. */
export function addManualForm(drawer: DrawerService, data: ComplianceDataSource, schemes: Scheme[], schemeId?: string): void {
  openForm(drawer, {
    eyebrow: 'Compliance',
    title: 'Add a compliance item',
    intro: 'For deadlines Humo Property Management doesn’t work out from your records. It gets a Task when it’s due within 30 days.',
    fields: [
      { key: 'schemeId', label: 'Scheme', type: 'select', required: true, options: schemes.map((s) => ({ value: s.id, label: s.name })) },
      { key: 'title', label: 'What has to be done', type: 'text', required: true, placeholder: 'e.g. Pool safety inspection' },
      { key: 'dueAt', label: 'Due', type: 'date', required: true, half: true },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    initial: { schemeId: schemeId ?? schemes[0]?.id ?? '', dueAt: today() },
    submitLabel: 'Add item',
    submit: (v) => data.addManual({ schemeId: v['schemeId'], title: v['title'], dueAt: v['dueAt'], notes: v['notes'] }),
    success: () => 'Added.',
    failure: 'The item wasn’t added',
  });
}
