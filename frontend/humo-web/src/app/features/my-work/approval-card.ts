import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { WorkItem } from '../../domain';
import { AttentionService } from '../../core/attention/attention.service';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { ScopeService } from '../../core/scope/scope.service';
import { formatDate, formatRand, RandPipe } from '../../ui/format/money';
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

  readonly item = input.required<WorkItem>();
  /** Inside a drawer: no title block or "details" link. */
  readonly compact = input(false);
  readonly details = output<WorkItem>();

  protected readonly view = computed(() => workItemView(this.item()));
  protected readonly scheme = computed(() => this.scope.findScheme(this.item().schemeId));
  protected readonly canDecide = computed(() => this.attention.canDecide(this.item()));

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

  protected confirmReject(): void {
    if (!this.comment().trim()) return;
    this.decide('rejected', this.comment().trim());
  }

  private decide(decision: 'approved' | 'rejected', comment?: string): void {
    const item = this.item();
    this.busy.set(true);
    this.attention.decide(item.id, decision, comment).subscribe({
      next: () => {
        this.busy.set(false);
        this.rejecting.set(false);
        const what = decision === 'approved' ? 'Approved' : 'Rejected';
        this.feedback.success(`${what} ${item.ref} · ${formatRand(item.amount)}`, () =>
          this.attention.reopen([item.id]).subscribe(),
        );
      },
      error: () => {
        this.busy.set(false);
        this.feedback.error('The decision could not be saved. Nothing was changed — try again.');
      },
    });
  }
}
