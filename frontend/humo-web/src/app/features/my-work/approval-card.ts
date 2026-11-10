import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { AGENCY_WORK, LARGE_APPROVAL_AMOUNT, WorkItem, agencyConflict } from '../../domain';
import { AttentionService } from '../../core/attention/attention.service';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { ScopeService } from '../../core/scope/scope.service';
import { StepUpService } from '../../core/security/step-up.service';
import { SessionService } from '../../core/session/session.service';
import { formatDate, formatRand, RandPipe } from '../../ui/format/money';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { openForm } from '../shared/form-drawer';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { workItemView } from './work-item-view';

/**
 * Approval card (pattern P6): everything needed for a confident decision —
 * what, how much, budget impact, evidence — and the decision itself.
 * The same card is used for quotes, invoices, payment batches and billing runs,
 * in the Approvals queue, in previews, and later on job/meeting pages.
 */
@Component({
  selector: 'app-approval-card',
  imports: [IonIcon, RouterLink, StatusPill, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './approval-card.html',
  styleUrl: './approval-card.scss',
  host: { '[class.compact]': 'compact()' },
})
export class ApprovalCard {
  private readonly attention = inject(AttentionService);
  private readonly feedback = inject(FeedbackService);
  private readonly scope = inject(ScopeService);
  private readonly stepUp = inject(StepUpService);
  protected readonly session = inject(SessionService);
  private readonly drawer = inject(DrawerService);

  /** D39: agency managers record the board's signed approval for trustees not on Humo. */
  protected readonly canRecordBoard = computed(() => {
    const w = this.item();
    return !!w.board && w.status === 'open' && ['agency-admin', 'portfolio-manager'].includes(this.session.assignment()?.role ?? '') && !this.session.readOnly();
  });

  /** What the agency does next: who has been asked, and whose signed approval to collect. */
  protected readonly boardAsk = computed(() => {
    const b = this.item().board;
    if (!b) return '';
    const open = b.seats.filter((s) => !s.decision);
    // Not known (an older API): say only what's needed, not who is or isn't on Humo.
    const asked = open.filter((s) => s.onHumo === true).map((s) => s.name);
    const offline = open.filter((s) => s.onHumo === false).map((s) => s.name);
    const need = Math.max(0, b.needed - b.approvals);
    const parts = [`${need} more approval${need === 1 ? '' : 's'} needed.`];
    if (asked.length) parts.push(`${asked.join(' and ')} ${asked.length === 1 ? 'has' : 'have'} been asked in My work.`);
    if (offline.length) parts.push(`${offline.join(' and ')} ${offline.length === 1 ? 'isn’t' : 'aren’t'} on Humo: collect their signed approval and record it here.`);
    return parts.join(' ');
  });

  protected recordBoardApproval(): void {
    const w = this.item();
    const open = (w.board?.seats ?? []).filter((s) => !s.decision);
    openForm(this.drawer, {
      eyebrow: `${w.ref} · ${formatRand(w.amount)}`,
      title: 'Record the board’s signed approval',
      intro: `For trustees who aren’t on Humo: their signed resolution, letter or email approving this item. Every trustee on record is told at once, with the names you choose. ${w.board?.needed} of ${w.board?.trustees} must approve.`,
      fields: [
        { key: 'file', label: 'Signed approval (PDF)', type: 'file', required: true, accept: '.pdf' },
        { key: 'signers', label: 'Who signed it', type: 'checks', required: true, options: open.map((s) => ({ value: s.personId, label: s.name })) },
        { key: 'signedOn', label: 'Signed on', type: 'date', required: true, half: true },
      ],
      submitLabel: 'Verify and record',
      stepUp: { action: 'approve-large-amount', detail: `Record the board’s approval of ${w.ref} · ${formatRand(w.amount)}` },
      submit: (f, files) => this.attention.uploadBoardApproval(w.id, f['signers'].split(',').filter(Boolean), f['signedOn'], files['file']),
      success: () => 'Recorded. Every trustee on record has been told.',
      failure: 'The board’s approval wasn’t recorded',
    });
  }

  readonly item = input.required<WorkItem>();
  /** Inside a drawer: no title block or "details" link. */
  readonly compact = input(false);
  /** Inside a record that already shows the context (e.g. the job): just the decision, without the detail line and evidence. */
  readonly brief = input(false);
  readonly details = output<WorkItem>();

  protected readonly view = computed(() => workItemView(this.item()));
  protected readonly scheme = computed(() => this.scope.findScheme(this.item().schemeId));
  protected readonly canDecide = computed(() => this.attention.canDecide(this.item()) && this.session.can('Approvals.Decide'));
  /** D6: acting as trustee while working for the managing agency. They may reject, but another trustee approves. */
  protected readonly conflicted = computed(() => AGENCY_WORK.includes(this.item().type) && agencyConflict(this.session.identity(), this.session.assignment()));
  /** Large amounts need a fresh proof of identity to approve (never to reject): the agency's own threshold, R50 000 by default. */
  /** A large amount, or a supplier's bank details, which always need the passkey (D27). */
  protected readonly needsStepUp = computed(
    () => this.item().type === 'bank-details-verification' || (this.item().amount ?? 0) >= (this.session.organisation()?.approvalStepUpAmount ?? LARGE_APPROVAL_AMOUNT),
  );

  protected readonly rejecting = signal(false);
  protected readonly comment = signal('');
  protected readonly busy = signal(false);
  protected readonly formatDate = formatDate;

  /** Budget impact: spent so far, this item, and what's left (or the overrun). */
  protected readonly budget = computed(() => {
    const b = this.item().budget;
    const amount = this.item().amount ?? 0;
    if (!b) return null;
    const after = b.spent + amount;
    const scale = Math.max(b.annual, after);
    return {
      category: b.category,
      spentPct: (b.spent / scale) * 100,
      thisPct: (Math.min(amount, Math.max(0, b.annual - b.spent)) / scale) * 100,
      overPct: (Math.max(0, after - b.annual) / scale) * 100,
      remaining: b.annual - after,
      annual: b.annual,
    };
  });

  protected approve(): void {
    this.decide('approved');
  }

  /** D24: under the trustees' permission, always with a passkey; it takes effect after the 24-hour cooling-off. */
  protected approveAlone(): void {
    const item = this.item();
    this.busy.set(true);
    this.stepUp
      .guard({ action: 'approve-large-amount', detail: `Approve ${item.ref} alone under the trustees’ permission — ${item.title}` }, () =>
        this.attention.decide(item.id, 'approved', undefined, true),
      )
      .subscribe({
        complete: () => this.busy.set(false),
        next: () => {
          this.busy.set(false);
          this.feedback.success(`Approved ${item.ref} alone. It takes effect in 24 hours, and the trustees are told.`);
        },
        error: () => {
          this.busy.set(false);
          this.feedback.error('The approval could not be saved. Nothing was changed — try again.');
        },
      });
  }

  protected stopHold(): void {
    const item = this.item();
    this.busy.set(true);
    this.attention.cancelHold(item.id).subscribe({
      complete: () => this.busy.set(false),
      next: () => {
        this.busy.set(false);
        this.feedback.success(`Stopped ${item.ref}: it waits for a decision again.`);
      },
      error: () => {
        this.busy.set(false);
        this.feedback.error('It couldn’t be stopped. Try again.');
      },
    });
  }

  protected confirmReject(): void {
    if (!this.comment().trim()) return;
    this.decide('rejected', this.comment().trim());
  }

  private decide(decision: 'approved' | 'rejected', comment?: string): void {
    const item = this.item();
    this.busy.set(true);
    const decide$ = () => this.attention.decide(item.id, decision, comment);
    // A supplier's bank details always need the passkey, never an SMS code (D26, D27).
    const run$ =
      decision === 'approved' && item.type === 'bank-details-verification'
        ? this.stepUp.guard({ action: 'change-bank-details', detail: item.title }, decide$)
        : decision === 'approved' && this.needsStepUp()
          ? this.stepUp.guard({ action: 'approve-large-amount', detail: `Approve ${item.ref} · ${formatRand(item.amount)} — ${item.title}`, smsAllowed: true }, decide$)
          : decide$();
    run$.subscribe({
      complete: () => this.busy.set(false),
      next: () => {
        this.busy.set(false);
        this.rejecting.set(false);
        const what = decision === 'approved' ? 'Approved' : 'Rejected';
        this.feedback.success(`${what} ${item.ref}${item.amount != null ? ` · ${formatRand(item.amount)}` : ''}`, () =>
          this.attention.reopen([item.id]).subscribe(),
        );
      },
      error: () => {
        this.busy.set(false);
        if (!this.conflicted()) this.feedback.error('The decision could not be saved. Nothing was changed — try again.');
      },
    });
  }
}
