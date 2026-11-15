import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map, of, switchMap } from 'rxjs';
import { JobDataSource, Photo, UnitDataSource, cancelReason } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { residentStatus } from '../maintenance/job-view';

/**
 * Resident portal › one of their own requests: where it's at, why if it was cancelled, the booking, the photos and a
 * plain history. Only what the API sends residents (`forResident`): no quotes, prices or staff notes.
 */
@Component({
  selector: 'app-my-request-page',
  imports: [PageHeader, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="back" routerLink="/my/requests"><ion-icon name="chevron-back-outline" aria-hidden="true" /> My requests</a>
    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="2" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this request" (retry)="result.retry()" /></div>
    } @else if (!request()) {
      <div class="surface">
        <ui-empty-state illustration="not-found" title="We can’t find this request" message="It may belong to a unit you no longer live in.">
          <a class="btn btn-primary" routerLink="/my/requests">My requests</a>
        </ui-empty-state>
      </div>
    } @else {
      @let r = request()!;
      @let st = status();
      <ui-page-header [eyebrow]="r.job.ref + ' · ' + r.job.location" [title]="r.job.title">
        <ui-status-pill [label]="st.label" [tone]="st.tone" />
      </ui-page-header>

      <div class="layout">
        <section class="surface panel">
          @if (reason(); as why) {
            <p class="note" role="note"><strong>Cancelled:</strong> {{ why }}. If it still needs fixing, <a routerLink="/my/requests/new">report it again</a> or <a routerLink="/my/messages">send a message</a>.</p>
          } @else if (r.job.stage === 'closed' && r.job.verification?.outcome !== 'fixed') {
            <p class="note" role="note">The managing agent closed this request. If it still needs fixing, <a routerLink="/my/requests/new">report it again</a> or <a routerLink="/my/messages">send a message</a>.</p>
          } @else if (r.job.stage === 'completed') {
            <p class="note ask" role="note"><strong>Was it fixed?</strong> <a routerLink="/my/requests">Let us know in My requests</a>.</p>
          }

          @if (r.job.workOrder; as w) {
            <h2 class="section-title">Booking</h2>
            <p>{{ r.supplier?.name ?? 'The supplier' }} is booked for <strong>{{ formatDate(w.scheduledFor) }}</strong>.</p>
            @if (w.accessNotes) { <p class="muted">Access: {{ w.accessNotes }}</p> }
          }
          @if (r.job.completion; as c) {
            <h2 class="section-title">What the supplier says</h2>
            <p>“{{ c.notes }}”</p>
          }

          <h2 class="section-title">What you reported</h2>
          <p class="desc">{{ r.job.description }}</p>
          <p class="muted">{{ r.job.category }} · reported {{ formatDate(r.job.reportedAt) }}</p>

          @if (r.job.photos.length) {
            <div class="photos">
              @for (p of r.job.photos; track p.id) {
                @if (url(p); as src) {
                  <a [href]="src" target="_blank" rel="noopener"><img [src]="src" [alt]="p.caption" loading="lazy" /></a>
                } @else {
                  <span class="photo-name">{{ p.caption }}</span>
                }
              }
            </div>
          }
        </section>

        <section class="surface panel">
          <h2 class="section-title">History</h2>
          <ol class="history">
            @for (e of r.job.events; track e.id) {
              <li><span>{{ e.text }}</span><span class="muted">{{ formatDate(e.at) }}</span></li>
            }
          </ol>
        </section>
      </div>
    }
  `,
  styles: `
    .back { display: inline-flex; align-items: center; gap: var(--s-1); margin-bottom: var(--s-3); font-size: var(--fs-sm); color: var(--c-text-muted); text-decoration: none; }
    .back:hover { color: var(--c-text); }
    .layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--s-4); max-width: 1000px; }
    .panel { padding: var(--s-5); }
    .section-title { margin: var(--s-4) 0 var(--s-2); font-size: var(--fs-md); }
    .section-title:first-child { margin-top: 0; }
    .note { margin: 0 0 var(--s-4); padding: var(--s-3) var(--s-4); background: var(--c-surface-sunken); border-radius: var(--r); }
    .note.ask { background: var(--c-warning-soft); }
    .desc { white-space: pre-line; }
    .muted { color: var(--c-text-muted); font-size: var(--fs-sm); }
    .photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: var(--s-2); margin-top: var(--s-3); }
    .photos img { width: 100%; height: 100px; object-fit: cover; border-radius: var(--r); }
    .photo-name { padding: var(--s-2); font-size: var(--fs-xs); background: var(--c-surface-sunken); border-radius: var(--r); }
    .history { margin: 0; padding: 0; list-style: none; }
    .history li { display: flex; flex-direction: column; gap: 2px; padding: var(--s-2) 0; border-bottom: 1px solid var(--c-border); }
    .history li:last-child { border-bottom: 0; }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
    }
  `,
})
export class MyRequestPage {
  private readonly session = inject(SessionService);
  private readonly units = inject(UnitDataSource);
  private readonly jobs = inject(JobDataSource);
  private readonly ref = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('ref') ?? '')), { initialValue: '' });

  protected readonly formatDate = formatDate;

  /** The resident's own requests (as on My requests), then this one. */
  protected readonly result = loadable(() => {
    const a = this.session.assignment();
    const personId = this.session.identity().personId ?? '';
    const unit$ = a.scope.unitId ? this.units.byId(a.scope.unitId) : of(undefined);
    return unit$.pipe(switchMap((u) => this.jobs.forResident(personId, u?.unit.id)));
  });

  protected readonly request = computed(() => (this.result.value() ?? []).find((r) => r.job.ref === this.ref()));
  protected readonly status = computed(() => residentStatus(this.request()!.job));
  protected readonly reason = computed(() => (this.request()?.job.stage === 'cancelled' ? cancelReason(this.request()!.job) : undefined));

  protected url(p: Photo): string | undefined {
    return this.jobs.photoUrl(this.request()!.job.ref, p);
  }
}
