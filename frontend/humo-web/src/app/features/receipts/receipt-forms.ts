import { ReceiptDataSource, ReceiptView, Scheme, todaySA } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatRand } from '../../ui/format/money';
import { REASON_FIELD, openForm } from '../shared/form-drawer';

/** docs/22 §1: one deposit, captured exactly as it appears on the bank statement. */
export function captureReceiptForm(drawer: DrawerService, data: ReceiptDataSource, schemes: Scheme[], schemeId?: string): void {
  openForm(drawer, {
    eyebrow: 'Receipts',
    title: 'Capture a receipt',
    intro: 'For a deposit that isn’t in an imported statement. It goes to the scheme’s trust account, unallocated, ready to match to an owner’s account.',
    fields: [
      { key: 'schemeId', label: 'Scheme', type: 'select', required: true, options: schemes.map((s) => ({ value: s.id, label: s.name })) },
      { key: 'date', label: 'Date received', type: 'date', required: true, half: true },
      { key: 'amount', label: 'Amount (R)', type: 'number', required: true, half: true },
      { key: 'reference', label: 'Reference', type: 'text', required: true, placeholder: 'e.g. KC042 LEVY', help: 'Exactly as it appears on the bank statement: it’s what matches the receipt to an account.' },
      { key: 'payer', label: 'Depositor', type: 'text', placeholder: 'e.g. A MTHEMBU' },
    ],
    initial: { schemeId: schemeId ?? schemes[0]?.id ?? '', date: todaySA() },
    submitLabel: 'Capture receipt',
    submit: (v) => data.capture({ schemeId: v['schemeId'], date: v['date'], amount: Number(v['amount']), reference: v['reference'], payer: v['payer'] }),
    success: (_id, v) => `Captured ${formatRand(Number(v['amount']))}. It’s waiting to be allocated.`,
    failure: 'The receipt wasn’t captured',
  });
}

/** Only an unallocated receipt can be removed, with a reason (it's in the audit log). */
export function removeReceiptForm(drawer: DrawerService, data: ReceiptDataSource, v: ReceiptView, done: () => void): void {
  openForm(drawer, {
    eyebrow: `${v.scheme.name} · ${formatRand(v.receipt.amount)}`,
    title: 'Remove this receipt',
    intro: `“${v.receipt.reference || '(no reference)'}” is removed from the receipts to allocate. Use this for a deposit captured or imported by mistake, not for one you can’t identify (park that in suspense).`,
    fields: [REASON_FIELD],
    submitLabel: 'Remove receipt',
    submit: (f) => data.remove(v.receipt.id, f['reason'], v.receipt.version),
    success: () => 'Receipt removed.',
    done,
    failure: 'The receipt wasn’t removed',
  });
}
