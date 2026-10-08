import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of, switchMap } from 'rxjs';
import { JobDataSource, JobSummary, UnitDataSource } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { StageTracker } from '../../ui/stage-tracker/stage-tracker';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { isOpenJob, residentStatus } from '../maintenance/job-view';

const RESIDENT_STAGES = [
  { id: 'received', label: 'Received' },
  { id: 'arranged', label: 'Arranged' },
  { id: 'booked', label: 'Booked' },
  { id: 'fixed', label: 'Fixed' },
];

/**
 * Resident portal › Maintenance. Job: "is anyone dealing with my problem, and
 * when?" — then close the loop: residents confirm whether it was fixed.
 */
@Component({
  selector: 'app-my-requests-page',
  imports: [PageHeader, StageTracker, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Maintenance" title="My requests" subtitle="Problems you’ve reported, and what’s happening with each one.">
      <a class="btn btn-primary" routerLink="/my/requests/new"><ion-icon name="add-outline" aria-hidden="true" /> Report a problem</a>
    </ui-page-header>

    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="2" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load your requests" (retry)="result.retry()" /></div>
    } @else if (open().length === 0 && closed().length === 0) {
      <div class="surface">
        <ui-empty-state kind="first-use" title="No requests yet" message="If something needs fixing in your unit or on the property, report it here and follow it until it’s done.">
          <a class="btn btn-primary" routerLink="/my/requests/new">Report a problem</a>
        </ui-empty-state>
      </div>
    } @else {
      <div class="list">
        @for (r of open(); track r.job.id) {
          @let st = status(r);
          <article class="card surface" [class.ask]="r.job.stage === 'completed'">
            <header>
              <div>
                <div class="ref">{{ r.job.ref }} · {{ r.job.location }}</div>
                <h2>{{ r.job.title }}</h2>
              </div>
              <ui-status-pill [label]="st.label" [tone]="st.tone" />
            </header>
            <ui-stage-tracker [stages]="stages" [current]="residentStage(r)" [compact]="true" label="Progress" />
            <p class="line">{{ explain(r) }}</p>
            @if (r.job.stage === 'completed') {
              <div class="verify">
                <strong>Was it fixed?</strong>
                @if (askingWhy() === r.job.ref) {
                  <textarea rows="2" placeholder="What’s still wrong?" [value]="why()" (input)="why.set($any($event.target).value)"></textarea>
                  <div class="btns">
                    <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="answer(r, 'not-fixed')">Send back to the supplier</button>
                    <button type="button" class="btn btn-ghost" (click)="askingWhy.set(null)">Cancel</button>
                  </div>
                } @else {
                  <div class="btns">
                    <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="answer(r, 'fixed')"><ion-icon name="checkmark-outline" aria-hidden="true" /> Yes, it’s fixed</button>
                    <button type="button" class="btn btn-secondary" (click)="askingWhy.set(r.job.ref)">No, still a problem</button>
                  </div>
                }
              </div>
            }
          </article>
        }
      </div>
      @if (closed().length) {
        <h2 class="section-title done-title">Done</h2>
        <ul class="done">
          @for (r of closed(); track r.job.id) {
            <li><span>{{ r.job.title }}</span><span class="muted">{{ r.job.ref }} · {{ formatDate(r.job.reportedAt) }}</span></li>
          }
        </ul>
      }
    }
  `,
  styles: `
    .list { display: grid; gap: var(--s-4); max-width: 760px; }
    .card { padding: var(--s-5); }
    .card.ask { border-color: var(--c-warning); box-shadow: 0 0 0 3px var(--c-warning-soft); }
    header { display: flex; justify-content: space-between; gap: var(--s-3); align-items: flex-start; margin-bottom: var(--s-4); }
    .ref { font-size: var(--fs-xs); color: var(--c-text-muted); }
    h2 { font-size: var(--fs-lg); }
    .line { margin-top: var(--s-3); font-size: var(--fs-sm); color: var(--c-text-2); }
    .verify { display: flex; flex-direction: column; gap: var(--s-2); margin-top: var(--s-4); padding: var(--s-4); background: var(--c-warning-soft); border-radius: var(--r); }
    .btns { display: flex; flex-wrap: wrap; gap: var(--s-2); }
    .btns .btn { min-height: 44px; }
    textarea { width: 100%; padding: var(--s-2); font: inherit; border: 1px solid var(--c-border-strong); border-radius: var(--r); background: var(--c-surface); color: var(--c-text); }
    .done-title { margin: var(--s-8) 0 var(--s-3); font-size: var(--fs-md); }
    .done { max-width: 760px; margin: 0; padding: 0; list-style: none; }
    .done li { display: flex; justify-content: space-between; gap: var(--s-3); padding: var(--s-3) 0; border-bottom: 1px solid var(--c-border); font-size: var(--fs-sm); }
    .muted { color: var(--c-text-muted); }
  `,
})
export class MyRequestsPage {
  private readonly session = inject(SessionService);
  private readonly units = inject(UnitDataSource);
  private readonly jobs = inject(JobDataSource);
  private readonly feedback = inject(FeedbackService);

  protected readonly stages = RESIDENT_STAGES;
  protected readonly formatDate = formatDate;
  protected readonly busy = signal(false);
  protected readonly askingWhy = signal<string | null>(null);
  protected readonly why = signal('');

  /** Load the resident's unit, then their requests (reported by them or for their unit). */
  protected readonly result = loadable(() => {
    const a = this.session.assignment();
    const personId = this.session.identity().personId ?? '';
    const unit$ = a.scope.unitId ? this.units.byId(a.scope.unitId) : of(undefined);
    return unit$.pipe(switchMap((u) => this.jobs.forResident(personId, u?.unit.id)));
  });

  protected readonly open = computed(() => (this.result.value() ?? []).filter((r) => isOpenJob(r.job) && !['verified', 'invoiced', 'paid'].includes(r.job.stage)));
  protected readonly closed = computed(() => (this.result.value() ?? []).filter((r) => !isOpenJob(r.job) || ['verified', 'invoiced', 'paid'].includes(r.job.stage)));

  protected status(r: JobSummary) {
    return residentStatus(r.job);
  }

  protected residentStage(r: JobSummary): string {
    switch (r.job.stage) {
      case 'reported':
        return 'received';
      case 'quoting':
      case 'approval':
      case 'approved':
        return 'arranged';
      case 'scheduled':
      case 'in-progress':
      case 'completed':
        return 'booked';
      default:
        return 'fixed';
    }
  }

  protected explain(r: JobSummary): string {
    const j = r.job;
    switch (j.stage) {
      case 'reported':
        return `We received this on ${formatDate(j.reportedAt)}. The managing agent will review it shortly.`;
      case 'quoting':
        return 'We’re getting quotes from vetted suppliers.';
      case 'approval':
        return 'The quote is with the trustees for approval.';
      case 'approved':
        return 'Approved — we’re booking the supplier now.';
      case 'scheduled':
        return `${r.supplier?.name ?? 'The supplier'} is booked for ${formatDate(j.workOrder?.scheduledFor)}.${j.workOrder?.accessNotes ? ' ' + j.workOrder.accessNotes : ''}`;
      case 'in-progress':
        return `${r.supplier?.name ?? 'The supplier'} is working on it.`;
      case 'completed':
        return `${r.supplier?.name ?? 'The supplier'} says it’s done: “${j.completion?.notes ?? ''}”`;
      default:
        return '';
    }
  }

  protected answer(r: JobSummary, outcome: 'fixed' | 'not-fixed'): void {
    this.busy.set(true);
    this.jobs.act(r.job.ref, { type: 'verify', outcome, comment: outcome === 'not-fixed' ? this.why() : undefined, onBehalf: false }).subscribe({
      next: () => {
        this.busy.set(false);
        this.askingWhy.set(null);
        this.why.set('');
        this.feedback.success(outcome === 'fixed' ? 'Thanks for confirming!' : 'Thanks — we’ve asked the supplier to come back.');
      },
      error: () => {
        this.busy.set(false);
        this.feedback.error('That didn’t send. Please try again.');
      },
    });
  }
}
