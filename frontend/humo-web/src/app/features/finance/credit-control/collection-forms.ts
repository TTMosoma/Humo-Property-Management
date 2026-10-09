import { CollectionDataSource, CollectionView, LetterKind } from '../../../domain';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { formatRand } from '../../../ui/format/money';
import { openForm } from '../../shared/form-drawer';
import { LETTER_LABELS } from './collection-view';

const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'post', label: 'Post (registered)' },
  { value: 'sms', label: 'SMS with a link' },
];

const eyebrow = (v: CollectionView) => `${v.account.accountNo} · Unit ${v.unit.number}`;

export function sendLetterForm(drawer: DrawerService, data: CollectionDataSource, v: CollectionView, kind: LetterKind): void {
  const intro = {
    reminder: `A friendly reminder that ${formatRand(v.overdueAmount)} is overdue, with how to pay. A final demand is due ${v.stepDays} days later if nothing is paid.`,
    'final-demand': `Asks for ${formatRand(v.overdueAmount)} in full within ${v.stepDays} days and says a letter of demand may follow.`,
    'letter-of-demand': `The trustees approved it. It demands ${formatRand(v.overdueAmount)} and says the account goes to the attorneys if it isn’t paid. Registered post is safest.`,
  }[kind];
  openForm(drawer, {
    eyebrow: eyebrow(v),
    title: `Send ${LETTER_LABELS[kind].toLowerCase()}`,
    intro: `${intro} It’s issued with your current letter template and kept on the account.`,
    fields: [{ key: 'channel', label: 'Send by', type: 'select', required: true, options: CHANNELS }],
    initial: { channel: kind === 'letter-of-demand' ? 'post' : 'email' },
    submitLabel: `Send ${LETTER_LABELS[kind].toLowerCase()}`,
    submit: (f) => data.act(v.account.id, { type: 'send-letter', kind, channel: f['channel'] as 'email' | 'post' | 'sms' }, v.case.version),
    success: () => `${LETTER_LABELS[kind]} sent to ${v.holder.displayName}.`,
    failure: 'The letter wasn’t sent',
  });
}

export function requestDemandApprovalForm(drawer: DrawerService, data: CollectionDataSource, v: CollectionView): void {
  openForm(drawer, {
    eyebrow: eyebrow(v),
    title: 'Ask the trustees to approve a letter of demand',
    intro: `${formatRand(v.overdueAmount)} overdue, ${v.daysInArrears}+ days, reminder and final demand sent. A letter of demand can lead to legal costs, so the trustees decide in Approvals. You’ll see their decision here.`,
    fields: [],
    submitLabel: 'Send to the trustees',
    submit: () => data.act(v.account.id, { type: 'request-demand-approval' }, v.case.version),
    success: () => 'Sent to the trustees for approval.',
    failure: 'The request wasn’t sent',
  });
}

export function handOverForm(drawer: DrawerService, data: CollectionDataSource, v: CollectionView): void {
  openForm(drawer, {
    eyebrow: eyebrow(v),
    title: 'Hand over to the attorney',
    intro: 'The attorney collects from here. Humo stops sending letters and keeps billing as usual; interest and legal costs are recovered as the scheme’s rules allow.',
    fields: [{ key: 'attorney', label: 'Attorney', type: 'text', required: true, placeholder: 'e.g. Van der Merwe Attorneys' }],
    submitLabel: 'Hand over',
    submit: (f) => data.act(v.account.id, { type: 'hand-over', attorney: f['attorney'] }, v.case.version),
    success: () => 'Handed over.',
    failure: 'The account wasn’t handed over',
  });
}

export function arrangementForm(drawer: DrawerService, data: CollectionDataSource, v: CollectionView): void {
  const months = 6;
  openForm(drawer, {
    eyebrow: eyebrow(v),
    title: 'Record a payment arrangement',
    intro: `What the owner agreed to pay towards the ${formatRand(v.overdueAmount)} overdue, on top of the monthly levy. Letters stop while it’s kept; a missed instalment resumes collection.`,
    fields: [
      { key: 'instalment', label: 'Monthly instalment (R)', type: 'number', required: true },
      { key: 'day', label: 'Day of the month', type: 'number', required: true, half: true },
      { key: 'months', label: 'Months', type: 'number', required: true, half: true },
    ],
    initial: { instalment: String(Math.ceil(v.overdueAmount / months / 50) * 50), day: '1', months: String(months) },
    submitLabel: 'Record arrangement',
    submit: (f) => data.act(v.account.id, { type: 'arrangement', instalment: Number(f['instalment']), day: Number(f['day']), months: Number(f['months']) }, v.case.version),
    success: () => 'Arrangement recorded.',
    failure: 'The arrangement wasn’t recorded',
  });
}

export function missedInstalmentForm(drawer: DrawerService, data: CollectionDataSource, v: CollectionView): void {
  openForm(drawer, {
    eyebrow: eyebrow(v),
    title: 'Record a missed instalment',
    intro: 'The arrangement ends and collection resumes where it left off.',
    fields: [],
    submitLabel: 'Record missed instalment',
    submit: () => data.act(v.account.id, { type: 'missed-instalment' }, v.case.version),
    success: () => 'Recorded. Collection resumes.',
    failure: 'It wasn’t recorded',
  });
}

export function disputeForm(drawer: DrawerService, data: CollectionDataSource, v: CollectionView): void {
  openForm(drawer, {
    eyebrow: eyebrow(v),
    title: 'Record a dispute',
    intro: 'Collection pauses while the dispute is looked into. Resolve it to resume.',
    fields: [{ key: 'reason', label: 'What the owner disputes', type: 'textarea', required: true, placeholder: 'e.g. Says the June special levy was paid in cash at the office' }],
    submitLabel: 'Record dispute',
    submit: (f) => data.act(v.account.id, { type: 'dispute', reason: f['reason'] }, v.case.version),
    success: () => 'Dispute recorded; collection paused.',
    failure: 'The dispute wasn’t recorded',
  });
}

export function resolveDisputeForm(drawer: DrawerService, data: CollectionDataSource, v: CollectionView): void {
  openForm(drawer, {
    eyebrow: eyebrow(v),
    title: 'Resolve the dispute',
    intro: v.case.dispute ? `Disputed: “${v.case.dispute.reason}”. A write-off is a journal adjustment from the account page.` : undefined,
    fields: [
      {
        key: 'outcome',
        label: 'Outcome',
        type: 'select',
        required: true,
        options: [
          { value: 'resume', label: 'Amount stands — resume collection' },
          { value: 'written-off-in-part', label: 'Partly written off — resume for the rest' },
        ],
      },
      { key: 'note', label: 'How it was resolved', type: 'textarea', required: true },
    ],
    initial: { outcome: 'resume' },
    submitLabel: 'Resolve',
    submit: (f) => data.act(v.account.id, { type: 'resolve-dispute', outcome: f['outcome'] as 'resume' | 'written-off-in-part', note: f['note'] }, v.case.version),
    success: () => 'Dispute resolved; collection resumes.',
    failure: 'The dispute wasn’t resolved',
  });
}

/** Bulk reminders (the Compose pattern): one reminder letter per account, by email or SMS. */
export function remindForm(drawer: DrawerService, data: CollectionDataSource, views: CollectionView[], done: () => void): void {
  const total = views.reduce((s, v) => s + v.overdueAmount, 0);
  openForm(drawer, {
    eyebrow: 'Credit control',
    title: `Send ${views.length} reminder${views.length === 1 ? '' : 's'}`,
    intro: `${views.length} owner${views.length === 1 ? '' : 's'}, ${formatRand(total)} overdue in all. Each gets their own reminder letter with their amount and how to pay. Accounts already past the reminder stage are skipped.`,
    fields: [{ key: 'channel', label: 'Send by', type: 'select', required: true, options: CHANNELS.filter((c) => c.value !== 'post') }],
    initial: { channel: 'email' },
    submitLabel: 'Send reminders',
    submit: (f) => data.remind(views.map((v) => v.account.id), f['channel'] as 'email' | 'sms'),
    success: (n) => `${n} reminder${n === 1 ? '' : 's'} sent.`,
    done: () => done(),
    failure: 'The reminders weren’t sent',
  });
}
