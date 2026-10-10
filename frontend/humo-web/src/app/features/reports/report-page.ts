import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { REPORT_CATEGORIES, ReportCell, ReportColumn, ReportDataSource, ReportId } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeService } from '../../core/scope/scope.service';
import { urlState } from '../../ui/data-table/url-state';
import { formatDate } from '../../ui/format/money';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { downloadCsv, formatCell } from './report-view';
import { DesktopHint } from '../../ui/states/desktop-hint';
import { FeatureFlags } from '../../core/flags/feature-flags';

const PERIODS = [
  { value: '1', label: 'Last month' },
  { value: '3', label: 'Last 3 months' },
  { value: '6', label: 'Last 6 months' },
  { value: '12', label: 'Last 12 months' },
];

/** One report: choose the schemes (and period), sort, print, or export CSV. Rows open their record. */
@Component({
  selector: 'app-report-page',
  imports: [DesktopHint, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toolbar no-print">
      <a class="btn btn-ghost btn-sm" routerLink="/reports"><ion-icon name="chevron-back-outline" aria-hidden="true" /> Reports</a>
    </div>

    @if (result.loading()) {
      <ui-skeleton [count]="10" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t run this report" (retry)="result.retry()" /></div>
    } @else if (!report()) {
      <div class="surface"><ui-empty-state illustration="not-found" title="This report isn’t available" message="It doesn’t exist, or your role or your agency’s plan doesn’t include it." /></div>
    } @else {
      @let r = report()!;
      <header class="head">
        <div>
          <div class="label-caps">{{ category() }} report</div>
          <h1>{{ r.def.title }}</h1>
          <p class="sub">{{ r.def.description }}</p>
          <p class="meta">{{ r.scope }} · worked out {{ formatDate(r.generatedAt) }}</p>
        </div>
        <div class="actions no-print">
          @if (flags.on('reports.csv-export')) {
            <button type="button" class="btn btn-secondary" (click)="exportCsv()"><ion-icon name="download-outline" aria-hidden="true" /> Export CSV</button>
          }
          <button type="button" class="btn btn-ghost" (click)="print()"><ion-icon name="print-outline" aria-hidden="true" /> Print</button>
        </div>
      </header>

      <ui-desktop-hint [what]="'A ' + r.columns.length + '-column report'" />
      <div class="filters no-print">
        <label>
          <span>Schemes</span>
          <select (change)="state.update((s) => ({ ...s, scheme: $any($event.target).value || null }))">
            <option value="" [selected]="!state().scheme">{{ allLabel() }}</option>
            @for (s of schemes(); track s.id) {
              <option [value]="s.id" [selected]="state().scheme === s.id">{{ s.name }}</option>
            }
          </select>
        </label>
        @if (r.def.period) {
          <label>
            <span>Period</span>
            <select (change)="state.update((s) => ({ ...s, months: $any($event.target).value }))">
              @for (p of periods; track p.value) {
                <option [value]="p.value" [selected]="(state().months ?? '3') === p.value">{{ p.label }}</option>
              }
            </select>
          </label>
        }
      </div>

      @if (!rows().length) {
        <div class="surface"><ui-empty-state title="Nothing to report" message="No records match for these schemes and this period." /></div>
      } @else {
        <div class="surface table-wrap">
          <table class="report">
            <caption class="visually-hidden">{{ r.def.title }}</caption>
            <thead>
              <tr>
                @for (c of r.columns; track c.key) {
                  <th scope="col" [class.end]="isNum(c)" [attr.aria-sort]="sortKey() === c.key ? (sortDir() === 1 ? 'ascending' : 'descending') : null">
                    <button type="button" (click)="sortBy(c.key)">{{ c.label }}@if (sortKey() === c.key) { <ion-icon [name]="sortDir() === 1 ? 'arrow-up-outline' : 'arrow-down-outline'" aria-hidden="true" /> }</button>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track $index) {
                <tr [class.link]="!!row.link" (click)="open(row.link)">
                  @for (c of r.columns; track c.key; let first = $first) {
                    <td [class.end]="isNum(c)" [class.money]="c.kind === 'money'">
                      @if (first && row.link) {
                        <a [routerLink]="row.link" (click)="$event.stopPropagation()">{{ cell(c, row.cells[c.key]) }}</a>
                      } @else {
                        {{ cell(c, row.cells[c.key]) }}
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
            @if (r.totals; as t) {
              <tfoot>
                <tr>
                  @for (c of r.columns; track c.key; let first = $first) {
                    <td [class.end]="isNum(c)" [class.money]="c.kind === 'money'">{{ first ? 'Total' : c.total ? cell(c, t[c.key]) : '' }}</td>
                  }
                </tr>
              </tfoot>
            }
          </table>
        </div>
        <p class="count">{{ rows().length }} row{{ rows().length === 1 ? '' : 's' }}</p>
      }
      @for (n of r.notes; track n) {
        <p class="note">{{ n }}</p>
      }
    }
  `,
  styles: `
    :host { display: block; }
    .toolbar { margin-bottom: var(--s-3); }
    .head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-4); }
    h1 { margin: 2px 0; font-size: var(--fs-2xl); }
    .sub { margin: 0; color: var(--c-text-2); }
    .meta { margin: 4px 0 0; font-size: var(--fs-xs); color: var(--c-text-muted); }
    .actions { display: flex; gap: var(--s-2); }
    .filters { display: flex; flex-wrap: wrap; gap: var(--s-4); margin-bottom: var(--s-4); }
    .filters label { display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-sm); }
    .filters span { font-weight: var(--fw-medium); color: var(--c-text-2); }
    .table-wrap { overflow-x: auto; }
    .report { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .report th, .report td { padding: 8px 10px; border-bottom: 1px solid var(--c-border); text-align: left; white-space: nowrap; }
    .report th button { display: inline-flex; gap: 4px; align-items: center; padding: 0; font: inherit; font-size: var(--fs-xs); font-weight: var(--fw-semibold); color: var(--c-text-muted); text-transform: uppercase; letter-spacing: 0.04em; background: none; border: 0; cursor: pointer; }
    .report .end { text-align: right; }
    .report th.end button { flex-direction: row-reverse; }
    .report .money { font-variant-numeric: tabular-nums; }
    .report tbody tr.link { cursor: pointer; }
    .report tbody tr.link:hover { background: var(--c-surface-sunken); }
    .report tfoot td { font-weight: var(--fw-semibold); border-top: 2px solid var(--c-border); border-bottom: 0; }
    .count, .note { margin: var(--s-2) 0 0; font-size: var(--fs-xs); color: var(--c-text-muted); }
    @media print { .table-wrap { overflow: visible; box-shadow: none; } .report th, .report td { padding: 4px 6px; } }
  `,
})
export class ReportPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(ReportDataSource);
  private readonly scope = inject(ScopeService);
  protected readonly flags = inject(FeatureFlags);

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('reportId') as ReportId)), { initialValue: this.route.snapshot.paramMap.get('reportId') as ReportId });
  protected readonly state = urlState({ scheme: null, months: null });

  protected readonly schemes = computed(() => this.scope.accessible().filter((s) => this.scope.effectiveIds().includes(s.id)));
  protected readonly allLabel = computed(() => (this.scope.scheme() ? this.scope.scheme()!.name : `All ${this.schemes().length} schemes in scope`));

  protected readonly result = loadable(() => {
    const scheme = this.state().scheme;
    return this.data.run(this.id(), { schemeIds: scheme ? [scheme] : this.scope.effectiveIds(), months: Number(this.state().months ?? 3) });
  });
  protected readonly report = computed(() => this.result.value());

  protected readonly sortKey = signal<string | null>(null);
  protected readonly sortDir = signal<1 | -1>(1);

  protected readonly rows = computed(() => {
    const r = this.report();
    if (!r) return [];
    const rows = r.rows.map((cells, i) => ({ cells, link: r.links?.[i] ?? null }));
    const k = this.sortKey();
    if (!k) return rows;
    const d = this.sortDir();
    return [...rows].sort((a, b) => {
      const x = a.cells[k];
      const y = b.cells[k];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * d;
    });
  });

  protected readonly category = computed(() => REPORT_CATEGORIES.find((c) => c.id === this.report()?.def.category)?.label ?? '');
  protected readonly periods = PERIODS;
  protected readonly formatDate = formatDate;
  protected readonly cell = (c: ReportColumn, v: ReportCell | undefined) => formatCell(c, v ?? null);
  protected readonly isNum = (c: ReportColumn) => c.kind === 'money' || c.kind === 'number' || c.kind === 'percent';

  protected sortBy(key: string): void {
    if (this.sortKey() === key) this.sortDir.set(this.sortDir() === 1 ? -1 : 1);
    else {
      this.sortKey.set(key);
      const c = this.report()?.columns.find((x) => x.key === key);
      this.sortDir.set(c && this.isNum(c) ? -1 : 1);
    }
  }

  protected open(link: string | null): void {
    if (link) void this.router.navigateByUrl(link);
  }

  protected exportCsv(): void {
    const r = this.report();
    if (r) downloadCsv({ ...r, rows: this.rows().map((x) => x.cells) });
  }

  protected print(): void {
    window.print();
  }
}
