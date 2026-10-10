import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { MEETING_TYPE_LABELS, MeetingDataSource, MeetingSummary, Scheme } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { scheduleMeetingForm } from './meeting-forms';
import { MEETING_STAGE_TONE, stageLabel, when } from './meeting-view';

const HELD = ['held', 'minutes-draft', 'minutes-approved'];

/**
 * Governance › Meetings: what's coming up and what still needs minuting.
 * Reused as a scheme's Meetings tab (the route passes the scheme).
 */
@Component({
  selector: 'app-meetings-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!fixedScheme()) {
      <ui-page-header eyebrow="Governance" title="Meetings" subtitle="Trustee meetings, AGMs and SGMs: from agenda and notice to approved minutes.">
        @if (canManage()) {
          <button type="button" class="btn btn-primary" (click)="schedule()"><ion-icon name="add-outline" aria-hidden="true" /> Schedule meeting</button>
        }
      </ui-page-header>
      <app-scope-notice />
    } @else if (canManage()) {
      <div class="tab-actions">
        <button type="button" class="btn btn-primary btn-sm" (click)="schedule()"><ion-icon name="add-outline" aria-hidden="true" /> Schedule meeting</button>
      </div>
    }

    <ui-view-tabs label="Meeting views" [tabs]="tabs()" [active]="state().view ?? 'upcoming'" (activeChange)="state.update((s) => ({ ...s, view: $event }))" />

    @if (result.loading()) {
      <ui-skeleton [count]="6" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load meetings" (retry)="result.retry()" /></div>
    } @else if (rows().length === 0) {
      <div class="surface">
        @if (state().view === 'upcoming') {
          <ui-empty-state kind="first-use" illustration="empty-tray" title="No meetings coming up" message="Schedule a trustee meeting, AGM or SGM: Humo Property Management keeps the agenda, notice, pack, minutes and actions together." />
        } @else {
          <ui-empty-state title="No meetings here" message="Meetings appear here once they’re held." />
        }
      </div>
    } @else {
      <ui-data-table caption="Meetings" [rows]="rows()" [columns]="columns()" [rowId]="rowId" (rowClick)="open($event)">
        <ng-template uiCell="meeting" let-r>
          <div class="m">
            <span class="ref">{{ r.meeting.ref }}</span>
            <div>
              <div class="title">{{ r.meeting.title }}</div>
              <div class="sub">{{ typeLabel(r) }} · {{ r.meeting.venue }}</div>
            </div>
          </div>
        </ng-template>
        <ng-template uiCell="scheme" let-r>{{ r.scheme.name }}</ng-template>
        <ng-template uiCell="when" let-r>{{ when(r.meeting.scheduledFor) }}</ng-template>
        <ng-template uiCell="stage" let-r><ui-status-pill [label]="stageLabel(r.meeting.stage)" [tone]="stageTone(r)" /></ng-template>
        <ng-template uiCell="decisions" let-r>
          @if (r.resolutions) {
            {{ r.resolutions }} resolution{{ r.resolutions === 1 ? '' : 's' }}@if (r.openActions) { <span class="open"> · {{ r.openActions }} open action{{ r.openActions === 1 ? '' : 's' }}</span> }
          } @else {
            <span class="muted">—</span>
          }
        </ng-template>
      </ui-data-table>
    }
  `,
  styles: `
    :host { display: block; }
    .tab-actions { display: flex; justify-content: flex-end; margin-bottom: var(--s-3); }
    .m { display: flex; gap: var(--s-3); align-items: baseline; }
    .ref { flex: none; font-size: var(--fs-xs); color: var(--c-text-muted); font-variant-numeric: tabular-nums; }
    .title { font-weight: var(--fw-medium); }
    .sub, .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .open { color: var(--c-warning); }
  `,
})
export class MeetingsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(MeetingDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly scope = inject(ScopeService);
  private readonly session = inject(SessionService);

  protected readonly fixedScheme = toSignal(this.route.data.pipe(map((d) => d['scheme'] as Scheme | undefined)), {
    initialValue: this.route.snapshot.data['scheme'] as Scheme | undefined,
  });
  protected readonly state = urlState({ view: 'upcoming' });
  private readonly schemeIds = computed(() => (this.fixedScheme() ? [this.fixedScheme()!.id] : this.scope.effectiveIds()));

  protected readonly result = loadable(() => this.data.list(this.schemeIds()).pipe(map((p) => p.items)));
  private readonly all = computed(() => this.result.value() ?? []);

  protected readonly tabs = computed(() => {
    const rows = this.all();
    return [
      { id: 'upcoming', label: 'Upcoming', count: rows.filter((r) => !HELD.includes(r.meeting.stage) && r.meeting.stage !== 'cancelled').length },
      { id: 'minutes', label: 'Minutes to finish', count: rows.filter((r) => r.meeting.stage === 'held' || r.meeting.stage === 'minutes-draft').length },
      { id: 'held', label: 'Held' },
      { id: 'all', label: 'All' },
    ];
  });

  protected readonly rows = computed(() => {
    const rows = this.all();
    switch (this.state().view) {
      case 'minutes':
        return rows.filter((r) => r.meeting.stage === 'held' || r.meeting.stage === 'minutes-draft');
      case 'held':
        return rows.filter((r) => HELD.includes(r.meeting.stage)).sort((a, b) => b.meeting.scheduledFor.localeCompare(a.meeting.scheduledFor));
      case 'all':
        return [...rows].sort((a, b) => b.meeting.scheduledFor.localeCompare(a.meeting.scheduledFor));
      default:
        return rows.filter((r) => !HELD.includes(r.meeting.stage) && r.meeting.stage !== 'cancelled').sort((a, b) => a.meeting.scheduledFor.localeCompare(b.meeting.scheduledFor));
    }
  });

  protected readonly columns = computed<ColumnDef<MeetingSummary>[]>(() => {
    const cols: ColumnDef<MeetingSummary>[] = [{ key: 'meeting', header: 'Meeting', mobile: 'title', sort: (r) => r.meeting.title }];
    if (!this.fixedScheme()) cols.push({ key: 'scheme', header: 'Scheme', width: '18%', mobile: 'meta', sort: (r) => r.scheme.name });
    cols.push(
      { key: 'when', header: 'When', width: '170px', sort: (r) => r.meeting.scheduledFor },
      { key: 'stage', header: 'Stage', width: '170px', sort: (r) => r.meeting.stage },
      { key: 'decisions', header: 'Decisions', width: '220px' },
    );
    return cols;
  });

  protected readonly stageTone = (r: MeetingSummary) => MEETING_STAGE_TONE[r.meeting.stage];
  protected readonly stageLabel = stageLabel;
  protected readonly when = when;
  protected readonly rowId = (r: MeetingSummary) => r.meeting.id;
  protected readonly typeLabel = (r: MeetingSummary) => MEETING_TYPE_LABELS[r.meeting.type];
  protected readonly canManage = computed(() => this.session.can('Meetings.Manage') && !this.session.readOnly());

  constructor() {
    // "Schedule meeting" from the quick actions arrives as /governance/meetings?new=1.
    if (this.route.snapshot.queryParamMap.get('new') === '1' && this.canManage()) {
      queueMicrotask(() => {
        this.schedule();
        this.router.navigate([], { relativeTo: this.route, queryParams: { new: null }, queryParamsHandling: 'merge', replaceUrl: true });
      });
    }
  }

  protected open(r: MeetingSummary): void {
    void this.router.navigate(['/governance/meetings', r.meeting.id]);
  }

  protected schedule(): void {
    const schemes = this.fixedScheme() ? [this.fixedScheme()!] : this.scope.accessible();
    scheduleMeetingForm(this.drawer, this.data, this.router, schemes, this.fixedScheme()?.id ?? this.scope.scopeId() ?? undefined);
  }
}
