import { REVERSAL_REASON_LABELS, ReceiptDataSource, ReceiptView, ReversalReason, Scheme, UnitSummary, todaySA } from '../../domain';
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

/**
 * Reverses an allocated payment with the reason (docs/22 §1): the payment line stays on the account and a reversal
 * line takes it off today, so statements already sent stay true. The receipt waits to be allocated again.
 */
export function reverseReceiptForm(drawer: DrawerService, data: ReceiptDataSource, v: ReceiptView): void {
  const on = v.allocatedTo.map((a) => a.account.accountNo).join(', ');
  openForm(drawer, {
    eyebrow: `${v.scheme.name} · ${formatRand(v.receipt.amount)}`,
    title: 'Reverse this payment',
    intro: `It comes off ${on} today, with your reason, and goes back to “To allocate”. The payment line stays, so statements already sent still match; the next one shows both. The owner is told if they use the portal. Paid into the wrong account? Use “Move to another account” instead.`,
    fields: [
      {
        key: 'reason', label: 'Why', type: 'select', required: true,
        options: (Object.keys(REVERSAL_REASON_LABELS) as ReversalReason[]).filter((r) => r !== 'wrong-account').map((r) => ({ value: r, label: REVERSAL_REASON_LABELS[r] })),
      },
      { key: 'note', label: 'Note', type: 'textarea', requiredIf: (f) => f['reason'] === 'other', help: 'On the account and in the audit log, e.g. the bank’s return reason.' },
    ],
    initial: { reason: 'wrong-amount' },
    submitLabel: 'Reverse payment',
    submit: (f) => data.reverse(v.receipt.id, { reason: f['reason'] as ReversalReason, note: f['note'] || undefined }, v.receipt.version),
    success: () => `Reversed. ${formatRand(v.receipt.amount)} is back in “To allocate”.`,
    failure: 'The payment wasn’t reversed',
  });
}

/** Allocated to the wrong account: reversed there and allocated to the right one in one step, with the reason. */
export function moveReceiptForm(drawer: DrawerService, data: ReceiptDataSource, v: ReceiptView, units: UnitSummary[]): void {
  const current = new Set(v.allocatedTo.map((a) => a.account.id));
  const options = units
    .filter((u) => !current.has(u.account.id))
    .map((u) => ({ value: u.account.id, label: `${u.account.accountNo} · ${u.owners.map((o) => o.displayName).join(' & ') || 'no owner on record'}` }));
  openForm(drawer, {
    eyebrow: `${v.scheme.name} · ${formatRand(v.receipt.amount)}`,
    title: 'Move to another account',
    intro: `It’s reversed on ${v.allocatedTo.map((a) => a.account.accountNo).join(', ')} and allocated to the account you choose, both today and with the reason “allocated to the wrong account”. Both owners are told if they use the portal.`,
    fields: [
      // Nothing chosen until they pick: the first account in the list isn't a guess.
      { key: 'accountId', label: 'The right account', type: 'select', required: true, options: [{ value: '', label: 'Choose the account…' }, ...options] },
      { key: 'note', label: 'Note', type: 'textarea', help: 'Optional, e.g. “Reference was KC042, not KC024”.' },
    ],
    initial: { accountId: '' },
    submitLabel: 'Move payment',
    submit: (f) => data.reverse(v.receipt.id, { reason: 'wrong-account', note: f['note'] || undefined, moveToAccountId: f['accountId'] }, v.receipt.version),
    success: (_r, f) => `Moved to ${options.find((o) => o.value === f['accountId'])?.label.split(' · ')[0] ?? 'the right account'}.`,
    failure: 'The payment wasn’t moved',
  });
}
