import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, combineLatest, map, of } from 'rxjs';
import { ADD_ONS, BusinessOverview, MODULE_LABELS, FeatureModule, PlatformCustomer, PlatformDataSource, packageById } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { AreaChart, BarChart, Sparkline } from '../../ui/charts/charts';
import { formatRand } from '../../ui/format/money';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';

const MONTH = new Intl.DateTimeFormat('en-ZA', { month: 'short' });
const TODAY = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
const num = (n: number) => n.toLocaleString('en-ZA').replace(/,/g, ' ');

/**
 * Humo Executive — the company command centre. Strategic and read-only:
 * aggregates, trends and where to look next. No customer users, no settings,
 * no subscription controls (by permission, not just by layout).
 */
@Component({
  selector: 'app-executive-page',
  imports: [AreaChart, BarChart, Sparkline, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './executive-page.html',
  styleUrl: './executive-page.scss',
})
export class ExecutivePage {
  private readonly data = inject(PlatformDataSource);
  protected readonly session = inject(SessionService);

  /** Overview shows everything; /revenue, /growth, /health, /opportunities focus one theme. */
  protected readonly focus = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('section'))), { initialValue: null });
  protected show(section: 'revenue' | 'growth' | 'health' | 'opportunities'): boolean {
    const f = this.focus();
    return !f || f === section;
  }
  protected readonly focusTitle = computed(() => ({ revenue: 'Revenue', growth: 'Growth', health: 'Account health', opportunities: 'Expansion opportunities' })[this.focus() ?? ''] ?? 'Business overview');
  protected readonly listSize = computed(() => (this.focus() ? 12 : 4));

  protected readonly result = loadable(() => combineLatest([this.data.overview(), this.data.customers()]).pipe(map(([o, customers]) => ({ o, customers }))));

  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;
  protected readonly o = computed(() => this.result.value()?.o ?? null);
  private readonly customers = computed(() => this.result.value()?.customers ?? []);

  protected readonly today = TODAY.format(new Date());
  protected readonly rand = (n: number, compact = false) => formatRand(n, { compact, cents: false });
  protected readonly num = num;

  protected readonly months = computed(() => (this.o()?.history ?? []).map((p) => MONTH.format(new Date(`${p.month}-01`))));
  protected readonly mrrSeries = computed(() => (this.o()?.history ?? []).map((p) => p.mrr));
  protected readonly usersSeries = computed(() => (this.o()?.history ?? []).map((p) => p.activeUsers));
  protected readonly customerSeries = computed(() => (this.o()?.history ?? []).map((p) => p.customers));

  protected readonly kpis = computed(() => {
    const o = this.o();
    if (!o) return [];
    const h = o.history;
    const prev = h.at(-2)!;
    const mom = ((o.mrr - prev.mrr) / prev.mrr) * 100;
    const yoy = ((o.mrr - h[0].mrr) / h[0].mrr) * 100;
    return [
      { label: 'MRR', value: this.rand(o.mrr), delta: `${mom >= 0 ? '+' : ''}${mom.toFixed(1)}% this month`, up: mom >= 0, spark: this.mrrSeries(), lead: true },
      { label: 'ARR', value: this.rand(o.arr), delta: `${yoy >= 0 ? '+' : ''}${yoy.toFixed(0)}% on last year`, up: yoy >= 0 },
      { label: 'Customers', value: num(o.customers), delta: `+${h.at(-1)!.newCustomers} this month`, up: true, spark: this.customerSeries() },
      { label: 'Schemes', value: num(o.schemes), delta: 'under management' },
      { label: 'Units', value: num(o.units), delta: 'on Humo' },
      { label: 'Active users', value: num(o.activeUsers), delta: 'staff and residents, 30 days', spark: this.usersSeries() },
      { label: 'Retention', value: `${o.retention}%`, delta: `Net revenue retention ${o.nrr}%`, up: true },
    ];
  });

  protected readonly packageRows = computed(() => {
    const o = this.o();
    if (!o) return [];
    return o.byPackage.map((p) => ({ ...p, name: packageById(p.packageId).name.replace('Humo ', ''), share: (p.mrr / o.mrr) * 100, arpa: p.customers ? p.mrr / p.customers : 0 }));
  });

  protected readonly growth = computed(() => (this.o()?.history ?? []).map((p, i) => ({ label: this.months()[i], value: p.newCustomers, negative: p.churned })));
  protected readonly growthTotals = computed(() => {
    const h = this.o()?.history ?? [];
    return {
      added: h.reduce((n, p) => n + p.newCustomers, 0),
      churned: h.reduce((n, p) => n + p.churned, 0),
      expansion: h.reduce((n, p) => n + p.expansionMrr, 0),
    };
  });

  protected readonly healthTotal = computed(() => {
    const h = this.o()?.health;
    return h ? h.healthy + h.atRisk + h.critical : 1;
  });

  protected readonly atRisk = computed(() =>
    this.customers()
      .filter((c) => c.health.band !== 'healthy')
      .sort((a, b) => b.subscription.mrr - a.subscription.mrr)
      .slice(0, this.listSize()),
  );

  protected readonly modules = computed(() =>
    (this.o()?.moduleUsage ?? []).map((m) => ({ ...m, label: MODULE_LABELS[m.module as FeatureModule] })),
  );

  protected readonly opportunities = computed(() => {
    const byId = new Map(this.customers().map((c) => [c.organisationId, c]));
    return (this.o()?.expansion.top ?? []).slice(0, this.focus() ? 12 : 6).map((op) => ({
      ...op,
      customer: byId.get(op.organisationId)?.name ?? op.organisationId,
      what: op.target.addOn ? ADD_ONS.find((a) => a.id === op.target.addOn)?.name : op.target.package ? packageById(op.target.package).name : op.title,
    }));
  });
}
