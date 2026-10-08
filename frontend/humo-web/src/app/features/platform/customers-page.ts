import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CatalogueService } from '../../core/catalogue/catalogue.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of } from 'rxjs';
import { PlatformCustomer, PlatformDataSource } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { formatDate, formatRand } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { BAND_LABEL, BAND_TONE, STATUS_LABEL, STATUS_TONE } from './platform-view';

/**
 * Platform › Customers. Every Humo role sees this list, shaped by permission:
 * revenue columns need Platform.Revenue.View; operational columns (status,
 * seats, tickets) are for the people who keep customers running.
 */
@Component({
  selector: 'app-customers-page',
  imports: [PageHeader, ViewTabs, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customers-page.html',
  styleUrl: './customers-page.scss',
})
export class CustomersPage {
  protected readonly catalogue = inject(CatalogueService);
  private readonly data = inject(PlatformDataSource);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionService);
  protected readonly state = urlState({ view: 'all', q: null, pkg: null });

  protected readonly result = loadable(() => this.data.customers().pipe(map((p) => ({ customers: p.items }))));
  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;
  private readonly all = computed(() => ((this.result.value()?.customers ?? [])));

  protected readonly revenue = computed(() => this.session.can('Platform.Revenue.View'));
  protected readonly operational = computed(() => this.session.can('Platform.Support.Assist'));

  private readonly filtered = computed(() => {
    const { q, pkg } = this.state();
    const needle = (q ?? '').trim().toLowerCase();
    return this.all().filter(
      (c) =>
        (!pkg || c.subscription.packageId === pkg) &&
        (!needle || [c.name, c.city, c.province, c.accountManager, c.organisationId].some((x) => x.toLowerCase().includes(needle))),
    );
  });

  protected readonly tabs = computed(() => {
    const f = this.filtered();
    return [
      { id: 'all', label: 'All customers', count: f.length },
      { id: 'healthy', label: 'Healthy', count: f.filter((c) => c.health.band === 'healthy').length },
      { id: 'at-risk', label: 'At risk', count: f.filter((c) => c.health.band === 'at-risk').length },
      { id: 'critical', label: 'Critical', count: f.filter((c) => c.health.band === 'critical').length },
    ];
  });

  protected readonly rows = computed(() => {
    const v = this.state().view;
    return this.filtered()
      .filter((c) => v === 'all' || !v || c.health.band === v)
      .sort((a, b) => (this.revenue() ? b.subscription.mrr - a.subscription.mrr : a.name.localeCompare(b.name)));
  });

  protected readonly totals = computed(() => {
    const r = this.rows();
    return { mrr: r.reduce((n, c) => n + c.subscription.mrr, 0), units: r.reduce((n, c) => n + c.snapshot.units, 0) };
  });

  protected readonly columns = computed<ColumnDef<PlatformCustomer>[]>(() => [
    { key: 'customer', header: 'Customer', mobile: 'title', width: '24%', sort: (r) => r.name },
    { key: 'package', header: 'Package', width: '16%', sort: (r) => r.subscription.packageId },
    { key: 'health', header: 'Health', width: '120px', sort: (r) => r.health.score },
    { key: 'size', header: 'Schemes · units', width: '130px', sort: (r) => r.snapshot.units },
    ...(this.operational()
      ? [
          { key: 'status', header: 'Status', width: '130px', sort: (r: PlatformCustomer) => r.subscription.status },
          { key: 'users', header: 'Active / seats', width: '110px', sort: (r: PlatformCustomer) => r.snapshot.activeUsers30d / r.snapshot.seats },
        ]
      : []),
    { key: 'am', header: 'Account manager', width: '140px', mobile: 'meta' as const, sort: (r) => r.accountManager },
    ...(this.revenue() ? [{ key: 'mrr', header: 'MRR', align: 'end' as const, width: '110px', sort: (r: PlatformCustomer) => r.subscription.mrr }] : []),
  ]);

  protected readonly rowId = (r: PlatformCustomer) => r.organisationId;
  protected readonly shortPackage = this.catalogue.shortPackage;
  protected readonly addOnName = this.catalogue.addOnName;
  protected readonly rand = (n: number, compact = false) => formatRand(n, { compact, cents: false });
  protected readonly formatDate = formatDate;
  protected readonly num = (n: number) => n.toLocaleString('en-ZA').replace(/,/g, ' ');

  protected band(c: PlatformCustomer) {
    return { label: BAND_LABEL[c.health.band], tone: BAND_TONE[c.health.band] };
  }

  protected status(c: PlatformCustomer) {
    return { label: STATUS_LABEL[c.subscription.status], tone: STATUS_TONE[c.subscription.status] };
  }

  protected set(key: 'view' | 'q' | 'pkg', value: string | null): void {
    this.state.update((s) => ({ ...s, [key]: value || null }));
  }

  protected open(c: PlatformCustomer): void {
    this.router.navigate(['/platform/customers', c.organisationId]);
  }
}
