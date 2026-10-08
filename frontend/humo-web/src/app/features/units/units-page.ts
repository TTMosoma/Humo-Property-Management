import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { Scheme, UnitDataSource, UnitSummary } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { newUnitForm } from '../schemes/scheme-forms';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { FilterBar, FilterDef } from '../../ui/data-table/filter-bar';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { RandPipe } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { OCCUPANCY_LABEL, accountStatus, links } from '../accounts/account-view';
import { UnitPreview } from './unit-preview';

const PAGE = 50;

/**
 * Units across the portfolio, or within one scheme (the scheme's Units tab
 * reuses this component with the scheme fixed — decision D3).
 * Job: find the unit quickly and see who owns it, who lives there, and whether
 * the account is in order.
 */
@Component({
  selector: 'app-units-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, FilterBar, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, RandPipe, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './units-page.html',
  styleUrl: './units-page.scss',
})
export class UnitsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(UnitDataSource);
  private readonly drawer = inject(DrawerService);
  protected readonly scope = inject(ScopeService);
  private readonly sessionService = inject(SessionService);

  /** In a scheme's Units tab: add units (not to a closed or archived scheme). */
  protected readonly canAddUnit = computed(() => {
    const s = this.scope.findScheme(this.fixedScheme()?.id);
    return !!s && this.sessionService.can('Units.Manage') && !this.sessionService.readOnly() && s.status !== 'closed' && s.status !== 'archived';
  });

  protected addUnit(): void {
    const s = this.scope.findScheme(this.fixedScheme()?.id);
    if (s) newUnitForm(this.drawer, this.data, s, this.router);
  }

  /** Set when shown as a scheme's tab. */
  protected readonly fixedScheme = toSignal(this.route.data.pipe(map((d) => d['scheme'] as Scheme | undefined)), {
    initialValue: this.route.snapshot.data['scheme'] as Scheme | undefined,
  });

  protected readonly state = urlState({ view: 'all', q: '', status: null, occupancy: null, scheme: null });
  protected readonly activeId = signal<string | null>(null);
  protected readonly limit = signal(PAGE);

  private readonly schemeIds = computed(() => {
    const fixed = this.fixedScheme();
    return fixed ? [fixed.id] : this.scope.effectiveIds();
  });

  protected readonly result = loadable(() => this.data.list(this.schemeIds()).pipe(map((p) => ({ rows: p.items }))));

  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;
  private readonly all = computed(() => this.result.value()?.rows ?? []);

  private readonly byView = computed(() => {
    const rows = this.all();
    switch (this.state().view) {
      case 'arrears':
        return rows.filter((r) => r.account.status === 'arrears' || r.account.status === 'handed-over' || r.account.status === 'arrangement');
      case 'tenanted':
        return rows.filter((r) => r.unit.occupancy === 'tenanted');
      case 'vacant':
        return rows.filter((r) => r.unit.occupancy === 'vacant');
      default:
        return rows;
    }
  });

  protected readonly filtered = computed(() => {
    const s = this.state();
    const q = (s.q ?? '').toLowerCase().trim();
    const num = /^\d+$/.test(q) ? q : null;
    return this.byView()
      .filter((r) => !s.status || r.account.status === s.status)
      .filter((r) => !s.occupancy || r.unit.occupancy === s.occupancy)
      .filter((r) => !s.scheme || r.scheme.id === s.scheme)
      .filter((r) => {
        if (!q) return true;
        if (num) return r.unit.number === String(Number(num));
        const hay = [r.unit.accountNo, `${r.scheme.code} ${r.unit.number}`, r.scheme.name, r.unit.description, ...r.owners.map((o) => o.displayName), r.tenant?.displayName]
          .join(' ')
          .toLowerCase();
        return q.split(/\s+/).every((t) => hay.includes(t));
      });
  });

  protected readonly rows = computed(() => this.filtered().slice(0, this.limit()));

  protected readonly tabs = computed(() => {
    const rows = this.all();
    return [
      { id: 'all', label: 'All units', count: rows.length },
      { id: 'arrears', label: 'In arrears', count: rows.filter((r) => ['arrears', 'handed-over', 'arrangement'].includes(r.account.status)).length },
      { id: 'tenanted', label: 'Tenanted', count: rows.filter((r) => r.unit.occupancy === 'tenanted').length },
      { id: 'vacant', label: 'Vacant', count: rows.filter((r) => r.unit.occupancy === 'vacant').length },
    ];
  });

  protected readonly filters = computed<FilterDef[]>(() => {
    const defs: FilterDef[] = [
      {
        key: 'status',
        label: 'Account',
        options: [
          { value: 'up-to-date', label: 'Up to date' },
          { value: 'in-credit', label: 'In credit' },
          { value: 'arrears', label: 'In arrears' },
          { value: 'arrangement', label: 'Payment arrangement' },
        ],
      },
      { key: 'occupancy', label: 'Occupancy', options: Object.entries(OCCUPANCY_LABEL).map(([value, label]) => ({ value, label })) },
    ];
    if (!this.fixedScheme() && !this.scope.scopeId()) {
      defs.push({ key: 'scheme', label: 'Scheme', options: this.scope.accessible().map((s) => ({ value: s.id, label: s.name })) });
    }
    return defs;
  });

  protected readonly columns = computed<ColumnDef<UnitSummary>[]>(() => {
    const cols: ColumnDef<UnitSummary>[] = [
      { key: 'unit', header: 'Unit', width: this.fixedScheme() ? '22%' : '20%', mobile: 'title', sort: (r) => r.scheme.code + r.unit.number.padStart(4, '0') },
    ];
    if (!this.fixedScheme()) cols.push({ key: 'scheme', header: 'Scheme', mobile: 'meta', sort: (r) => r.scheme.name });
    cols.push(
      { key: 'owner', header: 'Owner', sort: (r) => r.owners[0]?.displayName ?? '' },
      { key: 'occupancy', header: 'Occupancy', width: '17%', sort: (r) => r.unit.occupancy },
      { key: 'levy', header: 'Levy', align: 'end', width: '110px', sort: (r) => r.unit.monthlyLevy },
      { key: 'balance', header: 'Balance', align: 'end', width: '130px', sort: (r) => r.account.balance },
      { key: 'status', header: 'Account', width: '150px', sort: (r) => r.account.status },
    );
    return cols;
  });

  protected readonly rowId = (r: UnitSummary) => r.unit.id;
  protected readonly occupancyLabel = OCCUPANCY_LABEL;

  protected occupancyOf(r: UnitSummary): string {
    return OCCUPANCY_LABEL[r.unit.occupancy];
  }

  protected status(r: UnitSummary) {
    return accountStatus(r.account);
  }

  protected patch(change: Partial<Record<'view' | 'q' | 'status' | 'occupancy' | 'scheme', string | null>>): void {
    this.state.update((s) => ({ ...s, ...change }));
    this.limit.set(PAGE);
  }

  protected setFilters(v: Record<string, string | null>): void {
    this.patch({ status: v['status'] ?? null, occupancy: v['occupancy'] ?? null, scheme: v['scheme'] ?? null });
  }

  protected open(r: UnitSummary): void {
    this.activeId.set(r.unit.id);
    this.drawer.open(UnitPreview, { schemeId: r.scheme.id, number: r.unit.number }, `${r.scheme.code} ${r.unit.number}`).closed.subscribe(() => {
      if (this.activeId() === r.unit.id) this.activeId.set(null);
    });
  }

  protected openFull(r: UnitSummary, e: Event): void {
    e.stopPropagation();
    this.router.navigateByUrl(links.unit(r.scheme, r.unit));
  }
}
