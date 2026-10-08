import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { SessionService } from '../../core/session/session.service';
import { IonIcon } from '@ionic/angular/standalone';
import { newSupplierForm } from './supplier-forms';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { DocStatus, Scheme, SupplierDataSource, SupplierSummary, Trade } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { FilterBar, FilterDef } from '../../ui/data-table/filter-bar';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { RandPipe } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill, Tone } from '../../ui/status-pill/status-pill';

export const VETTING: Record<DocStatus, { label: string; tone: Tone }> = {
  valid: { label: 'Vetted', tone: 'success' },
  expiring: { label: 'Document expiring', tone: 'warning' },
  expired: { label: 'Document expired', tone: 'danger' },
  missing: { label: 'Document missing', tone: 'danger' },
};

/**
 * Maintenance › Suppliers. Job: find the right, compliant supplier for the
 * job — and see who needs documents chased before they can be booked.
 */
@Component({
  selector: 'app-suppliers-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, FilterBar, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, RandPipe, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!fixedScheme()) {
      <ui-page-header eyebrow="Maintenance" title="Suppliers" subtitle="Vetted contractors, their documents and how well they perform.">
        @if (canManage()) {
          <button type="button" class="btn btn-primary" (click)="addSupplier()"><ion-icon name="add-outline" aria-hidden="true" /> Add supplier</button>
        }
      </ui-page-header>
      <app-scope-notice />
    }
    <ui-view-tabs label="Supplier views" [tabs]="tabs()" [active]="state().view ?? 'all'" (activeChange)="patch({ view: $event })" />
    <ui-filter-bar
      searchLabel="Name, trade or contact…"
      [filters]="filters()"
      [values]="{ trade: state().trade }"
      (valuesChange)="patch({ trade: $event['trade'] ?? null })"
      [search]="state().q ?? ''"
      (searchChange)="patch({ q: $event })"
    />
    @if (loading()) {
      <ui-skeleton [count]="8" />
    } @else if (failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load suppliers" (retry)="result.retry()" /></div>
    } @else if (rows().length === 0) {
      <div class="surface">
        @if (state().view === 'attention' && !state().q && !state().trade) {
          <ui-empty-state kind="done" title="Every supplier is fully vetted" />
        } @else {
          <ui-empty-state kind="filtered" title="No suppliers match">
            <button type="button" class="btn btn-secondary" (click)="patch({ q: '', trade: null, view: 'all' })">Clear filters</button>
          </ui-empty-state>
        }
      </div>
    } @else {
      <ui-data-table caption="Suppliers" [rows]="rows()" [columns]="columns" [rowId]="rowId" (rowClick)="open($event)">
        <ng-template uiCell="name" let-s>
          <div class="name">{{ s.supplier.name }}</div>
          <div class="sub">{{ s.supplier.trades.join(' · ') }}</div>
        </ng-template>
        <ng-template uiCell="vetting" let-s>
          <ui-status-pill [label]="s.supplier.status === 'on-hold' ? 'On hold' : vetting(s).label" [tone]="s.supplier.status === 'on-hold' ? 'neutral' : vetting(s).tone" />
        </ng-template>
        <ng-template uiCell="ontime" let-s><span class="num" [class.low]="s.supplier.performance.onTimeRate < 80">{{ s.supplier.performance.onTimeRate }}%</span></ng-template>
        <ng-template uiCell="jobs" let-s><span class="num">{{ s.openJobs }}</span></ng-template>
        <ng-template uiCell="spend" let-s><span class="money">{{ s.spend12m | rand: 'whole' }}</span></ng-template>
        <ng-template uiCell="contact" let-s>
          <div>{{ s.supplier.contactName }}</div>
          <div class="sub">{{ s.supplier.phone }}</div>
        </ng-template>
      </ui-data-table>
    }
  `,
  styles: `
    .name { font-weight: var(--fw-medium); color: var(--c-text); }
    .sub { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .low { color: var(--c-warning); font-weight: var(--fw-semibold); }
  `,
})
export class SuppliersPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(SupplierDataSource);
  protected readonly scope = inject(ScopeService);

  protected readonly fixedScheme = toSignal(this.route.data.pipe(map((d) => d['scheme'] as Scheme | undefined)), {
    initialValue: this.route.snapshot.data['scheme'] as Scheme | undefined,
  });
  protected readonly state = urlState({ view: 'all', q: '', trade: null });

  private readonly schemeIds = computed(() => (this.fixedScheme() ? [this.fixedScheme()!.id] : this.scope.effectiveIds()));
  protected readonly result = loadable(() => this.data.list(this.schemeIds()).pipe(map((rows) => ({ rows }))));

  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;
  private readonly all = computed(() => ((this.result.value()?.rows ?? [])).sort((a, b) => a.supplier.name.localeCompare(b.supplier.name)));

  protected readonly rows = computed(() => {
    const s = this.state();
    const q = (s.q ?? '').toLowerCase();
    return this.all()
      // Archived suppliers only appear in their own view.
      .filter((r) => (s.view === 'archived' ? r.supplier.status === 'archived' : r.supplier.status !== 'archived'))
      .filter((r) => (s.view === 'attention' ? r.compliance !== 'valid' : s.view === 'hold' ? r.supplier.status === 'on-hold' : true))
      .filter((r) => !s.trade || r.supplier.trades.includes(s.trade as Trade))
      .filter((r) => !q || `${r.supplier.name} ${r.supplier.trades.join(' ')} ${r.supplier.contactName}`.toLowerCase().includes(q));
  });

  protected readonly tabs = computed(() => {
    const current = this.all().filter((r) => r.supplier.status !== 'archived');
    const archived = this.all().length - current.length;
    return [
      { id: 'all', label: 'All', count: current.length },
      { id: 'attention', label: 'Documents to chase', count: current.filter((r) => r.compliance !== 'valid').length },
      { id: 'hold', label: 'On hold', count: current.filter((r) => r.supplier.status === 'on-hold').length },
      ...(archived || this.state().view === 'archived' ? [{ id: 'archived', label: 'Archived', count: archived }] : []),
    ];
  });

  private readonly drawer = inject(DrawerService);
  private readonly session = inject(SessionService);
  protected readonly canManage = computed(() => this.session.can('Suppliers.Manage') && !this.session.readOnly());

  protected addSupplier(): void {
    newSupplierForm(this.drawer, this.data, this.scope.accessible(), this.router);
  }

  protected readonly filters = computed<FilterDef[]>(() => {
    const trades = [...new Set(this.all().flatMap((r) => r.supplier.trades))].sort();
    return [{ key: 'trade', label: 'Trade', options: trades.map((t) => ({ value: t, label: t })) }];
  });

  protected readonly columns: ColumnDef<SupplierSummary>[] = [
    { key: 'name', header: 'Supplier', mobile: 'title', sort: (s) => s.supplier.name },
    { key: 'vetting', header: 'Vetting', width: '170px', sort: (s) => s.compliance },
    { key: 'ontime', header: 'On time', align: 'end', width: '90px', sort: (s) => s.supplier.performance.onTimeRate },
    { key: 'jobs', header: 'Open jobs', align: 'end', width: '100px', sort: (s) => s.openJobs },
    { key: 'spend', header: 'Spend (12 mo.)', align: 'end', width: '130px', sort: (s) => s.spend12m },
    { key: 'contact', header: 'Contact', width: '20%', mobile: 'meta' },
  ];

  protected readonly rowId = (s: SupplierSummary) => s.supplier.id;

  protected vetting(s: SupplierSummary) {
    return VETTING[s.compliance];
  }

  protected patch(change: Partial<Record<'view' | 'q' | 'trade', string | null>>): void {
    this.state.update((s) => ({ ...s, ...change }));
  }

  protected open(s: SupplierSummary): void {
    this.router.navigate(['/suppliers', s.supplier.id]);
  }
}
