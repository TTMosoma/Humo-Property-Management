import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { catchError, map, of } from 'rxjs';
import { JobDataSource, PRIORITY_LABEL } from '../../domain';
import { Drawer } from '../../ui/drawer/drawer';
import { RandPipe, formatDate } from '../../ui/format/money';
import { PhotoTile } from '../../ui/photo/photo-tile';
import { StageTracker } from '../../ui/stage-tracker/stage-tracker';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { PRIORITY_TONE, STAGE_LABEL, STAGE_TONE, TRACKER_STAGES, daysOpen, isOverdue } from './job-view';

/** Quick look at a job: where it is, who's on it, what it costs, and the latest activity. */
@Component({
  selector: 'app-job-preview',
  imports: [Drawer, StageTracker, StatusPill, PhotoTile, RandPipe, Skeleton, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (detail() === undefined) {
      <ui-drawer title="Loading job…"><ui-skeleton [count]="5" /></ui-drawer>
    } @else if (detail() === null) {
      <ui-drawer title="Job unavailable"><ui-error-state variant="inline" title="We couldn’t load this job" message="Close and try again." (retry)="ref.close()" /></ui-drawer>
    } @else {
      @let d = detail()!;
      <ui-drawer [eyebrow]="d.job.ref + ' · ' + d.job.category" [title]="d.job.title" [openLink]="'/maintenance/' + d.job.ref">
        <div drawerMeta class="meta">
          <ui-status-pill [label]="stageLabel()" [tone]="stageTone()" />
          <ui-status-pill [label]="priority()" [tone]="priorityTone()" />
          @if (overdue()) { <span class="late">Overdue</span> }
        </div>
        <ui-stage-tracker [stages]="stages" [current]="d.job.stage" [alert]="overdue()" [compact]="true" label="Job progress" />
        <dl class="facts">
          <dt>Where</dt><dd>{{ d.scheme.name }} · {{ d.job.location }}</dd>
          <dt>Reported</dt><dd>{{ formatDate(d.job.reportedAt) }} by {{ d.job.reportedBy.name }} · {{ days() }} days ago</dd>
          <dt>Assigned to</dt><dd>{{ d.assigneeName }}</dd>
          <dt>Supplier</dt><dd>{{ d.supplier?.name ?? 'Not chosen yet' }}</dd>
          @if (approvedAmount(); as a) { <dt>Approved</dt><dd class="money">{{ a | rand }}</dd> }
          @if (d.job.workOrder) { <dt>Booked for</dt><dd>{{ formatDate(d.job.workOrder.scheduledFor) }}</dd> }
        </dl>
        <p class="desc">{{ d.job.description }}</p>
        @if (d.job.photos.length) {
          <div class="photos">
            @for (p of d.job.photos.slice(0, 3); track p.id) {
              <ui-photo-tile [caption]="p.caption" [seed]="d.job.ref" [badge]="p.stage === 'completion' ? 'After' : 'Before'" />
            }
          </div>
        }
        <h3 class="section-title">Latest activity</h3>
        <ul class="events">
          @for (e of d.job.events.slice(0, 4); track e.id) {
            <li><span class="when">{{ formatDate(e.at, true) }}</span>{{ e.text }}</li>
          }
        </ul>
      </ui-drawer>
    }
  `,
  styles: `
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); margin-top: var(--s-2); }
    .late { font-size: var(--fs-xs); font-weight: var(--fw-semibold); color: var(--c-danger); }
    ui-stage-tracker { margin-bottom: var(--s-4); }
    .facts { display: grid; grid-template-columns: 110px 1fr; gap: var(--s-2) var(--s-4); margin: 0 0 var(--s-4); font-size: var(--fs-sm); }
    dt { color: var(--c-text-muted); }
    dd { margin: 0; }
    .desc { color: var(--c-text-2); }
    .photos { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-top: var(--s-4); }
    .section-title { margin: var(--s-5) 0 var(--s-2); font-size: var(--fs-md); }
    .events { margin: 0; padding: 0; list-style: none; font-size: var(--fs-sm); }
    .events li { padding: 6px 0; border-bottom: 1px solid var(--c-border); color: var(--c-text-2); }
    .when { display: inline-block; min-width: 64px; color: var(--c-text-muted); font-size: var(--fs-xs); }
  `,
})
export class JobPreview {
  private readonly data = inject<{ ref: string }>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef);
  protected readonly detail = toSignal(
    inject(JobDataSource)
      .get(this.data.ref)
      .pipe(
        map((d) => d ?? null),
        catchError(() => of(null)),
      ),
  );

  protected readonly stages = TRACKER_STAGES;
  protected readonly formatDate = formatDate;
  protected readonly stageLabel = computed(() => STAGE_LABEL[this.detail()!.job.stage]);
  protected readonly stageTone = computed(() => STAGE_TONE[this.detail()!.job.stage]);
  protected readonly priority = computed(() => PRIORITY_LABEL[this.detail()!.job.priority]);
  protected readonly priorityTone = computed(() => PRIORITY_TONE[this.detail()!.job.priority]);
  protected readonly overdue = computed(() => isOverdue(this.detail()!.job));
  protected readonly days = computed(() => daysOpen(this.detail()!.job));
  protected readonly approvedAmount = computed(() => (this.detail()!.job.approval?.status === 'approved' ? this.detail()!.job.quotes.find((q) => q.recommended)?.amount : undefined));
}
