import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { FieldErrors, describeFailure, fieldErrorsOf } from '../../domain';
import { ContractorPortal } from '../../domain/contractor';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { FieldError } from '../../ui/form/field-error';
import { formatDate, formatRand } from '../../ui/format/money';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';

const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * A quote request, from the contractor's side: the work, the photos, the
 * suburb and the deadline — not residents' details or the agent's direct
 * line. They quote once, clearly; they never see other contractors' prices.
 */
@Component({
  selector: 'app-contractor-request-page',
  imports: [EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, FieldError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './contractor-request-page.html',
  styleUrl: './contractor-request-page.scss',
})
export class ContractorRequestPage {
  private readonly portal = inject(ContractorPortal);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);

  private readonly partyId = this.session.assignment().scope.partyId ?? '';
  private readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id')!)), { initialValue: '' });
  protected readonly result = loadable(() => {
    const id = this.id();
    return this.portal.request(this.partyId, id).pipe(map((v) => v ?? (false as const)));
  });
  protected readonly v = computed(() => this.result.value() || undefined);
  protected readonly photoSlots = computed(() => Array.from({ length: this.v()?.request.photos ?? 0 }, (_, i) => i));

  protected readonly amount = signal('');
  protected readonly work = signal('');
  protected readonly exclusions = signal('');
  protected readonly startBy = signal(iso(7));
  protected readonly completeBy = signal(iso(10));
  protected readonly guarantee = signal('12');
  protected readonly declining = signal(false);
  protected readonly declineReason = signal('');
  protected readonly busy = signal(false);
  /** What the server said about the last attempt, per field. */
  protected readonly errors = signal<FieldErrors>({});

  protected readonly workList = computed(() => this.work().split('\n').map((x) => x.trim()).filter(Boolean));
  protected readonly valid = computed(() => Number(this.amount()) > 0 && this.workList().length > 0 && this.completeBy() >= this.startBy());
  protected readonly formatDate = formatDate;
  protected readonly rand = (n: number) => formatRand(n, { cents: false });

  constructor() {
    effect(() => {
      const v = this.v();
      if (v && !this.work()) this.work.set(v.request.requirements.join('\n'));
    });
  }

  protected set(sig: 'amount' | 'work' | 'exclusions' | 'startBy' | 'completeBy' | 'guarantee' | 'declineReason', e: Event): void {
    this[sig].set((e.target as HTMLInputElement).value);
    this.errors.set({});
  }

  protected submit(): void {
    const v = this.v();
    if (!v || !this.valid()) return;
    this.busy.set(true);
    this.portal
      .submitQuote(this.partyId, v.request.id, {
        amount: Number(this.amount()),
        proposedWork: this.workList(),
        exclusions: this.exclusions().trim() || undefined,
        startBy: new Date(`${this.startBy()}T08:00:00`).toISOString(),
        completeBy: new Date(`${this.completeBy()}T17:00:00`).toISOString(),
        validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        guaranteeMonths: Number(this.guarantee()) || 0,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.feedback.success(`Quote sent to ${v.request.customerName}. You’ll see when they’ve viewed it.`);
        },
        // The form keeps everything; problems show next to the fields.
        error: (e) => {
          this.busy.set(false);
          this.errors.set(fieldErrorsOf(e));
          this.feedback.error(describeFailure(e, 'Your quote wasn’t sent'));
        },
      });
  }

  protected decline(): void {
    const v = this.v();
    if (!v) return;
    this.portal.decline(this.partyId, v.request.id, this.declineReason().trim() || 'Not available').subscribe({
      next: () => {
        this.declining.set(false);
        this.feedback.success('Thanks for letting them know. Declining quickly counts towards your response rate.');
      },
      error: (e) => this.feedback.error(describeFailure(e, 'That didn’t send')),
    });
  }
}
