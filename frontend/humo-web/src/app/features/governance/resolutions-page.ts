import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { RESOLUTION_PROGRESS_LABELS, ResolutionDataSource, ResolutionProgress, ResolutionView } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { FilterBar, FilterDef } from '../../ui/data-table/filter-bar';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { writtenResolutionForm } from './meeting-forms';
import { PROGRESS_TONE, progressLabel } from './meeting-view';

/**
 * Governance › Resolutions & actions: the register. A view over every
 * resolution — passed in a meeting or in writing — with its actions'
 * progress. Nothing is typed in here except a new written resolution.
 */
@Component({
  selector: 'app-resolutions-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, FilterBar, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Governance" title="Resolutions & actions" subtitle="Every decision the trustees took, and whether what they decided has been done.">
      @if (canPropose()) {
        <button type="button" class="btn btn-primary" (click)="propose()"><ion-icon name="create-outline" aria-hidden="true" /> Propose written resolution</button>
      }
    </ui-page-header>
    <app-scope-notice />

    <ui-view-tabs label="Resolution views" [tabs]="tabs()" [active]="state().view ?? 'open'" (activeChange)="patch({ view: $event })" />
    <ui-filter-bar searchLabel="Reference, title, wording…" [filters]="filters()" [values]="{ scheme: state().scheme }" (valuesChange)="patch({ scheme: $event['scheme'] ?? null })" [search]="state().q ?? ''" (searchChange)="patch({ q: $event })" />

    @if (result.loading()) {
      <ui-skeleton [count]="6" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load resolutions" (retry)="result.retry()" /></div>
    } @else if (rows().length === 0) {
      <div class="surface">
        @if (state().view === 'open') {
          <ui-empty-state kind="done" title="Nothing outstanding" message="Every resolution’s actions are done, and nothing is waiting for the trustees." />
        } @else {
          <ui-empty-state kind="filtered" title="No resolutions match" />
        }
      </div>
    } @else {
      <ui-data-table caption="Resolutions" [rows]="rows()" [columns]="columns()" [rowId]="rowId" (rowClick)="open($event)">
        <ng-template uiCell="resolution" let-r>
          <div class="r">
            <span class="ref">{{ r.resolution.ref }}</span>
            <div>
              <div class="title">{{ r.resolution.title }}</div>
              <div class="sub">{{ r.resolution.text }}</div>
            </div>
          </div>
        </ng-template>
        <ng-template uiCell="scheme" let-r>{{ r.scheme.name }}</ng-template>
        <ng-template uiCell="source" let-r>
          @if (r.meeting) {
            <span>{{ r.meeting.title }}</span>
          } @else {
            <span>Written resolution</span>
          }
          <div class="sub">{{ formatDate(r.resolution.decidedAt ?? r.resolution.proposedAt, true) }}</div>
        </ng-template>
        <ng-template uiCell="progress" let-r>
          <ui-status-pill [label]="progressLabel(r.progress)" [tone]="progressTone(r)" />
          @if (r.actions.length) {
            <div class="sub" [class.late]="overdue(r)">{{ done(r) }} of {{ r.actions.length }} actions done{{ overdue(r) ? ' · overdue' : '' }}</div>
          }
        </ng-template>
      </ui-data-table>
    }
  `,
  styles: `
    :host { display: block; }
    .r { display: flex; gap: var(--s-3); align-items: baseline; }
    .ref { flex: none; font-size: var(--fs-xs); color: var(--c-text-muted); font-variant-numeric: tabular-nums; }
    .title { font-weight: var(--fw-medium); }
    .sub { font-size: var(--fs-xs); color: var(--c-text-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .late { color: var(--c-danger); }
  `,
})
export class ResolutionsPage {
  private readonly data = inject(ResolutionDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly router = inject(Router);
  private readonly scope = inject(ScopeService);
  private readonly session = inject(SessionService);

  protected readonly state = urlState({ view: 'open', q: '', scheme: null });
  protected readonly result = loadable(() => this.data.list(this.scope.effectiveIds()).pipe(map((p) => p.items)));
  private readonly all = computed(() => this.result.value() ?? []);

  private readonly OPEN: ResolutionProgress[] = ['awaiting-decision', 'in-progress'];

  protected readonly tabs = computed(() => {
    const rows = this.all();
    return [
      { id: 'open', label: 'Outstanding', count: rows.filter((r) => this.OPEN.includes(r.progress)).length },
      { id: 'awaiting', label: 'Awaiting trustees', count: rows.filter((r) => r.progress === 'awaiting-decision').length },
      { id: 'all', label: 'All' },
    ];
  });

  protected readonly rows = computed(() => {
    const s = this.state();
    const q = (s.q ?? '').toLowerCase().trim();
    return this.all()
      .filter((r) => (s.view === 'open' ? this.OPEN.includes(r.progress) : s.view === 'awaiting' ? r.progress === 'awaiting-decision' : true))
      .filter((r) => !s.scheme || r.scheme.id === s.scheme)
      .filter((r) => !q || `${r.resolution.ref} ${r.resolution.title} ${r.resolution.text}`.toLowerCase().includes(q));
  });

  protected readonly filters = computed<FilterDef[]>(() =>
    this.scope.scopeId() ? [] : [{ key: 'scheme', label: 'Scheme', options: this.scope.accessible().map((s) => ({ value: s.id, label: s.name })) }],
  );

  protected readonly columns = computed<ColumnDef<ResolutionView>[]>(() => [
    { key: 'resolution', header: 'Resolution', mobile: 'title', sort: (r) => r.resolution.ref },
    { key: 'scheme', header: 'Scheme', width: '16%', mobile: 'meta', sort: (r) => r.scheme.name },
    { key: 'source', header: 'Decided', width: '22%', sort: (r) => r.resolution.decidedAt ?? r.resolution.proposedAt },
    { key: 'progress', header: 'Progress', width: '190px', sort: (r) => RESOLUTION_PROGRESS_LABELS[r.progress] },
  ]);

  protected readonly progressTone = (r: ResolutionView) => PROGRESS_TONE[r.progress];
  protected readonly progressLabel = progressLabel;
  protected readonly formatDate = formatDate;
  protected readonly rowId = (r: ResolutionView) => r.resolution.id;
  protected readonly done = (r: ResolutionView) => r.actions.filter((a) => a.status === 'done').length;
  protected readonly overdue = (r: ResolutionView) => r.actions.some((a) => a.overdue);
  protected readonly canPropose = computed(() => this.session.can('Meetings.Manage') && !this.session.readOnly());

  protected patch(change: Partial<Record<'view' | 'q' | 'scheme', string | null>>): void {
    this.state.update((s) => ({ ...s, ...change }));
  }

  protected open(r: ResolutionView): void {
    if (r.meeting) void this.router.navigate(['/governance/meetings', r.meeting.id]);
  }

  protected propose(): void {
    const schemes = this.scope.accessible().filter((s) => !this.scope.scopeId() || s.id === this.scope.scopeId());
    this.data.assignees(schemes.map((s) => s.id)).subscribe((assignees) => writtenResolutionForm(this.drawer, this.data, schemes, assignees));
  }
}
