import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of, switchMap } from 'rxjs';
import { JobDataSource, JobSummary, PRIORITY_LABEL, Priority, Scheme, Trade } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { FilterBar, FilterDef } from '../../ui/data-table/filter-bar';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { BOARD_COLUMNS, PRIORITY_TONE, STAGE_LABEL, STAGE_TONE, daysOpen, isOpenJob, isOverdue } from './job-view';
import { JobPreview } from './job-preview';

const PRIORITY_ORDER: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/**
 * Maintenance › Jobs. Job: see every problem in flight, spot what's stuck,
 * and move it on. List for scanning and sorting; board for the flow.
 * Reused as a scheme's Maintenance tab (decision D3).
 */
import { SmartNudge } from '../shared/smart-nudge';
@Component({
  selector: 'app-jobs-page',
  imports: [SmartNudge, PageHeader, ScopeNotice, ViewTabs, FilterBar, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './jobs-page.html',
  styleUrl: './jobs-page.scss',
})
export class JobsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(JobDataSource);
  private readonly drawer = inject(DrawerService);
  protected readonly scope = inject(ScopeService);
  protected readonly session = inject(SessionService);

  protected readonly fixedScheme = toSignal(this.route.data.pipe(map((d) => d['scheme'] as Scheme | undefined)), {
    initialValue: this.route.snapshot.data['scheme'] as Scheme | undefined,
  });

  protected readonly state = urlState({ view: 'open', mode: 'list', q: '', priority: null, category: null, scheme: null });
  protected readonly activeId = signal<string | null>(null);

  private readonly schemeIds = computed(() => (this.fixedScheme() ? [this.fixedScheme()!.id] : this.scope.effectiveIds()));

  protected readonly result = loadable(() => this.data.list(this.schemeIds()));

  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;
  private readonly all = computed(() => this.result.value() ?? []);

  private readonly mine = computed(() => new Set(this.session.selfIds()));

  private readonly byView = computed(() => {
    const rows = this.all();
    switch (this.state().view) {
      case 'overdue':
        return rows.filter((r) => isOverdue(r.job));
      case 'mine':
        return rows.filter((r) => isOpenJob(r.job) && r.job.assigneeId && this.mine().has(r.job.assigneeId));
      case 'closed':
        return rows.filter((r) => !isOpenJob(r.job));
      default:
        return rows.filter((r) => isOpenJob(r.job));
    }
  });

  protected readonly rows = computed(() => {
    const s = this.state();
    const q = (s.q ?? '').toLowerCase().trim();
    return this.byView()
      .filter((r) => !s.priority || r.job.priority === s.priority)
      .filter((r) => !s.category || r.job.category === s.category)
      .filter((r) => !s.scheme || r.scheme.id === s.scheme)
      .filter((r) => !q || `${r.job.ref} ${r.job.title} ${r.job.location} ${r.supplier?.name ?? ''} ${r.scheme.code} ${r.unit?.number ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => Number(isOverdue(b.job)) - Number(isOverdue(a.job)) || PRIORITY_ORDER[a.job.priority] - PRIORITY_ORDER[b.job.priority] || a.job.reportedAt.localeCompare(b.job.reportedAt));
  });

  protected readonly board = computed(() =>
    BOARD_COLUMNS.map((c) => ({ ...c, rows: this.rows().filter((r) => c.stages.includes(r.job.stage)) })),
  );

  protected readonly tabs = computed(() => {
    const rows = this.all();
    return [
      { id: 'open', label: 'Open', count: rows.filter((r) => isOpenJob(r.job)).length },
      { id: 'overdue', label: 'Overdue', count: rows.filter((r) => isOverdue(r.job)).length },
      ...(this.session.isStaff() ? [{ id: 'mine', label: 'Assigned to me', count: rows.filter((r) => isOpenJob(r.job) && r.job.assigneeId && this.mine().has(r.job.assigneeId)).length }] : []),
      { id: 'closed', label: 'Closed (history)' },
    ];
  });

  protected readonly filters = computed<FilterDef[]>(() => {
    const cats = [...new Set(this.all().map((r) => r.job.category))].sort();
    const defs: FilterDef[] = [
      { key: 'priority', label: 'Priority', options: (Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] })) },
      { key: 'category', label: 'Trade', options: cats.map((c) => ({ value: c, label: c })) },
    ];
    if (!this.fixedScheme() && !this.scope.scopeId()) {
      defs.push({ key: 'scheme', label: 'Scheme', options: this.scope.accessible().map((s) => ({ value: s.id, label: s.name })) });
    }
    return defs;
  });

  protected readonly columns = computed<ColumnDef<JobSummary>[]>(() => {
    const cols: ColumnDef<JobSummary>[] = [{ key: 'job', header: 'Job', mobile: 'title', sort: (r) => r.job.ref }];
    if (!this.fixedScheme()) cols.push({ key: 'scheme', header: 'Scheme', width: '16%', mobile: 'meta', sort: (r) => r.scheme.name });
    cols.push(
      { key: 'stage', header: 'Stage', width: '200px', sort: (r) => r.job.stage },
      { key: 'priority', header: 'Priority', width: '100px', sort: (r) => PRIORITY_ORDER[r.job.priority] },
      { key: 'supplier', header: 'Supplier', width: '16%', sort: (r) => r.supplier?.name ?? '' },
      { key: 'age', header: 'Open', align: 'end', width: '80px', sort: (r) => daysOpen(r.job) },
    );
    return cols;
  });

  protected readonly rowId = (r: JobSummary) => r.job.id;
  protected readonly stageLabel = (r: JobSummary) => STAGE_LABEL[r.job.stage];
  protected readonly stageTone = (r: JobSummary) => STAGE_TONE[r.job.stage];
  protected readonly priorityLabel = (r: JobSummary) => PRIORITY_LABEL[r.job.priority];
  protected readonly priorityTone = (r: JobSummary) => PRIORITY_TONE[r.job.priority];
  protected readonly overdue = (r: JobSummary) => isOverdue(r.job);
  protected readonly age = (r: JobSummary) => daysOpen(r.job);
  protected readonly canLog = computed(() => this.session.can('Maintenance.Log'));

  protected patch(change: Partial<Record<'view' | 'mode' | 'q' | 'priority' | 'category' | 'scheme', string | null>>): void {
    this.state.update((s) => ({ ...s, ...change }));
  }

  protected setFilters(v: Record<string, string | null>): void {
    this.patch({ priority: v['priority'] ?? null, category: (v['category'] as Trade) ?? null, scheme: v['scheme'] ?? null });
  }

  protected open(r: JobSummary): void {
    this.activeId.set(r.job.id);
    this.drawer.open(JobPreview, { ref: r.job.ref }, r.job.title).closed.subscribe(() => {
      if (this.activeId() === r.job.id) this.activeId.set(null);
    });
  }
}
