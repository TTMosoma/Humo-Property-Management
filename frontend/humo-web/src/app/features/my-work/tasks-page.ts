import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { IonIcon } from '@ionic/angular/standalone';
import { WORK_TYPE_AREA, WorkItem, isOpen, urgencyOf } from '../../domain';
import { AttentionService } from '../../core/attention/attention.service';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { pageState } from '../../core/prototype/page-state';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { STAFF, personName } from '../../mock/fixtures/staff';
import { BulkBar } from '../../ui/data-table/bulk-bar';
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
import { AREA_ICON, URGENCY_ORDER, workItemView } from './work-item-view';
import { WorkItemPreview } from './work-item-preview';

/**
 * My work › Tasks: one queue for everything that needs doing, across every
 * module, ordered by urgency. Built on the Attention model, so the numbers
 * here always match the sidebar badges and the scheme overviews.
 */
import { SmartNudge } from '../shared/smart-nudge';
@Component({
  selector: 'app-tasks-page',
  imports: [SmartNudge, 
    PageHeader, ViewTabs, FilterBar, DataTable, CellDef, BulkBar, StatusPill, EmptyState, ErrorState, Skeleton,
    ScopeNotice, IonIcon, CdkMenu, CdkMenuItem, CdkMenuTrigger,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tasks-page.html',
  styleUrl: './tasks-page.scss',
})
export class TasksPage {
  private readonly attention = inject(AttentionService);
  private readonly scope = inject(ScopeService);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);
  protected readonly page = pageState();

  protected readonly state = urlState({ view: 'mine', q: '', area: null, scheme: null, assignee: null });
  protected readonly selected = signal<string[]>([]);
  protected readonly activeId = signal<string | null>(null);
  protected readonly staff = STAFF;
  protected readonly areaIcon = AREA_ICON;

  private readonly allTasks = computed(() => this.attention.visible().filter((w) => w.kind === 'task'));
  private readonly me = computed(() => new Set(this.session.selfIds()));

  private readonly byView = computed(() => {
    const tasks = this.allTasks();
    switch (this.state().view) {
      case 'team':
        return tasks.filter(isOpen);
      case 'overdue':
        return tasks.filter((w) => isOpen(w) && urgencyOf(w) === 'overdue');
      case 'done':
        return tasks.filter((w) => !isOpen(w));
      default:
        return this.attention.myTasks();
    }
  });

  protected readonly rows = computed(() => {
    if (this.page.forceEmpty()) return [];
    const s = this.state();
    const q = (s.q ?? '').toLowerCase().trim();
    return this.byView()
      .filter((w) => !s.area || WORK_TYPE_AREA[w.type] === s.area)
      .filter((w) => !s.scheme || w.schemeId === s.scheme)
      .filter((w) => !s.assignee || (s.assignee === 'none' ? w.assigneeId === null : w.assigneeId === s.assignee))
      .filter((w) => !q || [w.title, w.detail, w.ref, w.unitLabel, w.personName, w.supplierName, this.schemeName(w.schemeId)].join(' ').toLowerCase().includes(q))
      .sort((a, b) => URGENCY_ORDER[urgencyOf(a)] - URGENCY_ORDER[urgencyOf(b)] || a.dueAt.localeCompare(b.dueAt));
  });

  protected readonly tabs = computed(() => {
    const tasks = this.allTasks();
    const tabs = [
      { id: 'mine', label: 'Mine', count: this.attention.myTasks().length },
      { id: 'team', label: this.session.role() === 'trustee' ? 'All open' : 'Team', count: tasks.filter(isOpen).length },
      { id: 'overdue', label: 'Overdue', count: tasks.filter((w) => isOpen(w) && urgencyOf(w) === 'overdue').length },
      { id: 'done', label: 'Completed' },
    ];
    return tabs;
  });

  protected readonly summary = computed(() => {
    const mine = this.attention.myTasks();
    const overdue = mine.filter((w) => urgencyOf(w) === 'overdue').length;
    const today = mine.filter((w) => urgencyOf(w) === 'today').length;
    return { overdue, today, total: mine.length };
  });

  protected readonly filters = computed<FilterDef[]>(() => {
    const defs: FilterDef[] = [
      {
        key: 'area',
        label: 'Area',
        options: ['Finance', 'Maintenance', 'Governance', 'Compliance'].map((a) => ({ value: a, label: a })),
      },
    ];
    if (!this.scope.scopeId() && this.scope.accessible().length > 1) {
      const ids = new Set(this.allTasks().map((w) => w.schemeId));
      defs.push({
        key: 'scheme',
        label: 'Scheme',
        options: this.scope.accessible().filter((s) => ids.has(s.id)).map((s) => ({ value: s.id, label: s.name })),
      });
    }
    if (this.session.isStaff()) {
      defs.push({
        key: 'assignee',
        label: 'Assignee',
        options: [{ value: 'none', label: 'Unassigned' }, ...STAFF.map((s) => ({ value: s.id, label: s.name }))],
      });
    }
    return defs;
  });

  protected readonly filterValues = computed(() => {
    const s = this.state();
    return { area: s.area, scheme: s.scheme, assignee: s.assignee };
  });

  protected readonly hasFilters = computed(() => {
    const s = this.state();
    return !!(s.q || s.area || s.scheme || s.assignee);
  });

  protected readonly columns: ColumnDef<WorkItem>[] = [
    { key: 'task', header: 'Task', mobile: 'title', sort: (w) => w.title },
    { key: 'scheme', header: 'Scheme', width: '20%', mobile: 'meta', sort: (w) => this.schemeName(w.schemeId) },
    { key: 'due', header: 'Due', width: '160px', sort: (w) => w.dueAt },
    { key: 'assignee', header: 'Assigned to', width: '180px', sort: (w) => personName(w.assigneeId) },
  ];

  protected readonly rowId = (w: WorkItem) => w.id;
  protected readonly isDone = (w: WorkItem) => !isOpen(w);

  protected view(w: WorkItem) {
    return workItemView(w);
  }

  protected schemeName(id: string): string {
    return this.scope.findScheme(id)?.name ?? '';
  }

  protected assigneeName(id: string | null): string {
    return personName(id);
  }

  protected initials(id: string | null): string {
    return STAFF.find((s) => s.id === id)?.initials ?? (id ? '•' : '—');
  }

  protected setView(view: string): void {
    this.state.update((s) => ({ ...s, view }));
    this.selected.set([]);
  }

  protected setSearch(q: string): void {
    this.state.update((s) => ({ ...s, q }));
  }

  protected setFilters(v: Record<string, string | null>): void {
    this.state.update((s) => ({ ...s, area: v['area'] ?? null, scheme: v['scheme'] ?? null, assignee: v['assignee'] ?? null }));
  }

  protected clearFilters(): void {
    this.state.update((s) => ({ ...s, q: '', area: null, scheme: null, assignee: null }));
  }

  protected open(w: WorkItem): void {
    this.activeId.set(w.id);
    const ref = this.drawer.open(WorkItemPreview, { id: w.id }, w.title);
    ref.closed.subscribe(() => {
      if (this.activeId() === w.id) this.activeId.set(null);
    });
  }

  protected completeSelected(): void {
    const ids = this.selected();
    this.attention.complete(ids).subscribe({
      next: () => {
        this.selected.set([]);
        this.feedback.success(`${ids.length} ${ids.length === 1 ? 'task' : 'tasks'} marked as done`, () =>
          this.attention.reopen(ids).subscribe(),
        );
      },
      error: () => this.feedback.error('Couldn’t update the tasks. Nothing was changed — try again.'),
    });
  }

  protected assignSelected(staffId: string | null): void {
    const ids = this.selected();
    this.attention.assign(ids, staffId).subscribe({
      next: () => {
        this.selected.set([]);
        this.feedback.success(`${ids.length} reassigned to ${personName(staffId)}`);
      },
      error: () => this.feedback.error('Couldn’t reassign. Try again.'),
    });
  }
}
