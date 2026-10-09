import { Router } from '@angular/router';
import {
  BillingDataSource,
  BillingException,
  BillingRun,
  DECISION_LABELS,
  EXCEPTION_LABELS,
  SchemeBillingStatus,
  periodLabel,
} from '../../../domain';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { formatRand } from '../../../ui/format/money';
import { REASON_FIELD, openForm } from '../../shared/form-drawer';

/** Scope and period: the run is prepared by the API, which calculates every charge and flags the exceptions. */
export function newRunForm(drawer: DrawerService, data: BillingDataSource, router: Router, statuses: SchemeBillingStatus[], schemeId?: string): void {
  const ready = statuses.filter((s) => !s.current);
  const first = ready.find((s) => s.scheme.id === schemeId) ?? ready[0];
  const periods = [...new Set(statuses.map((s) => s.nextPeriod))].sort();
  openForm(drawer, {
    eyebrow: 'Levies & billing',
    title: 'New billing run',
    intro: 'Humo calculates each account’s levy, special levy, water and interest, and flags anything unusual for you to decide. Nothing reaches an account until the run is approved and posted.',
    fields: [
      {
        key: 'schemeId',
        label: 'Scheme',
        type: 'select',
        required: true,
        options: statuses.map((s) => ({ value: s.scheme.id, label: s.current ? `${s.scheme.name} (run in progress)` : s.scheme.name })),
      },
      {
        key: 'period',
        label: 'Period',
        type: 'select',
        required: true,
        options: periods.map((p) => ({ value: p, label: periodLabel(p) })),
        help: 'Periods are billed in order, once. Each scheme’s next period is shown on Levies & billing.',
      },
    ],
    initial: { schemeId: first?.scheme.id ?? statuses[0]?.scheme.id ?? '', period: first?.nextPeriod ?? periods[0] ?? '' },
    submitLabel: 'Prepare charges',
    submit: (v) => data.create({ schemeId: v['schemeId'], period: v['period'] }),
    success: () => 'Charges prepared. Next: check the exceptions.',
    done: (id) => router.navigate(['/finance/billing', id]),
    failure: 'The run wasn’t prepared',
  });
}

export function decideForm(drawer: DrawerService, data: BillingDataSource, run: BillingRun, x: BillingException): void {
  openForm(drawer, {
    eyebrow: `${run.ref} · ${x.accountNo}`,
    title: EXCEPTION_LABELS[x.kind],
    intro: x.detail,
    fields: [
      { key: 'decision', label: 'Decision', type: 'select', required: true, options: x.options.map((o) => ({ value: o, label: DECISION_LABELS[o] })) },
      { key: 'note', label: 'Note', type: 'textarea', help: 'Optional. Kept with the run for the approvers and the audit log.' },
    ],
    initial: { decision: x.decision ?? x.options[0], note: x.note ?? '' },
    submitLabel: 'Save decision',
    submit: (v) => data.act(run.id, { type: 'decide', exceptionId: x.id, decision: v['decision'] as BillingException['options'][number], note: v['note']?.trim() || undefined }, run.version),
    success: () => 'Decision saved.',
    failure: 'The decision wasn’t saved',
  });
}

/** The three forward steps, each confirmed in the drawer so the person sees what will happen. */
export function confirmStep(drawer: DrawerService, data: BillingDataSource, run: BillingRun, total: number, accounts: number, step: 'send-for-approval' | 'post' | 'send-statements'): void {
  const period = periodLabel(run.period);
  const copy = {
    'send-for-approval': {
      title: 'Send for approval',
      intro: `${formatRand(total)} across ${accounts} accounts for ${period}. The run goes to Approvals (agency admin or finance); you can’t change it while it’s there.`,
      submit: 'Send for approval',
      success: 'Sent for approval.',
      failure: 'The run wasn’t sent',
    },
    post: {
      title: 'Post the run',
      intro: `Posts ${formatRand(total)} to ${accounts} accounts, dated 1 ${period}. After this the run is locked: any correction is a journal adjustment on the account.`,
      submit: 'Post to accounts',
      success: 'Posted. Next: send the statements.',
      failure: 'The run wasn’t posted',
    },
    'send-statements': {
      title: 'Send statements',
      intro: `Each owner gets their ${period} statement by their preferred channel (email, post or the portal), issued with your current statement template.`,
      submit: 'Send statements',
      success: 'Statements sent.',
      failure: 'The statements weren’t sent',
    },
  }[step];
  openForm(drawer, {
    eyebrow: run.ref,
    title: copy.title,
    intro: copy.intro,
    fields: [],
    submitLabel: copy.submit,
    submit: () => data.act(run.id, { type: step }, run.version),
    success: () => copy.success,
    failure: copy.failure,
  });
}

export function cancelRunForm(drawer: DrawerService, data: BillingDataSource, run: BillingRun): void {
  openForm(drawer, {
    eyebrow: run.ref,
    title: 'Cancel billing run',
    intro: run.stage === 'awaiting-approval' ? 'It’s withdrawn from Approvals. Nothing was posted, so no account changes.' : 'Nothing was posted, so no account changes. You can prepare the period again.',
    fields: [REASON_FIELD],
    submitLabel: 'Cancel run',
    submit: (v) => data.act(run.id, { type: 'cancel', reason: v['reason'] }, run.version),
    success: () => 'Run cancelled.',
    failure: 'The run wasn’t cancelled',
  });
}

/** After posting, corrections are journals on the account — never edits to a run. */
export function adjustmentForm(drawer: DrawerService, data: BillingDataSource, account: { id: string; accountNo: string }): void {
  openForm(drawer, {
    eyebrow: account.accountNo,
    title: 'Journal adjustment',
    intro: 'Corrects a posted charge. It appears on the owner’s next statement with your reason, and in the audit log.',
    fields: [
      { key: 'direction', label: 'Type', type: 'select', required: true, half: true, options: [{ value: 'credit', label: 'Credit (reduce what’s owed)' }, { value: 'debit', label: 'Charge (increase what’s owed)' }] },
      { key: 'amount', label: 'Amount (R)', type: 'number', required: true, half: true },
      { key: 'reason', label: 'Reason', type: 'textarea', required: true, placeholder: 'e.g. Water over-estimated in November: meter read 12 kl, billed 30 kl' },
    ],
    initial: { direction: 'credit' },
    submitLabel: 'Post adjustment',
    submit: (v) => data.adjust(account.id, (v['direction'] === 'credit' ? -1 : 1) * Math.abs(Number(v['amount'])), v['reason']),
    success: () => 'Adjustment posted.',
    failure: 'The adjustment wasn’t posted',
  });
}
