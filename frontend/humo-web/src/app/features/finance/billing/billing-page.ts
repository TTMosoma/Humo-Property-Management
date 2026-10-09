import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { combineLatest, map } from 'rxjs';
import { BillingDataSource, BillingRunSummary, SchemeBillingStatus, periodLabel } from '../../../domain';
import { loadable } from '../../../core/data/loadable';
import { ScopeNotice } from '../../../core/scope/scope-notice';
import { ScopeService } from '../../../core/scope/scope.service';
import { SessionService } from '../../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../../ui/data-table/data-table';
import { urlState } from '../../../ui/data-table/url-state';
import { ViewTabs } from '../../../ui/data-table/view-tabs';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { RandPipe, formatDate } from '../../../ui/format/money';
import { PageHeader } from '../../../ui/page-header/page-header';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { StatusPill } from '../../../ui/status-pill/status-pill';
import { newRunForm } from './billing-forms';
import { BILLING_STAGE_TONE, billingStageLabel } from './billing-view';

/**
 * Finance › Levies & billing. Job: bill every unit correctly each month.
 * Where each scheme stands (last posted, run in progress, next period), and
 * every run with its stage. Runs are prepared, approved and posted from the run page.
 */
@Component({
  selector: 'app-billing-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Finance" title="Levies & billing" subtitle="Each scheme’s monthly run: charges checked, exceptions decided, approved, posted and statements sent.">
      @if (canRun()) {
        <button type="button" class="btn btn-primary" (click)="newRun()"><ion-icon name="add-outline" aria-hidden="true" /> New billing run</button>
      }
    </ui-page-header>
    <app-scope-notice />

    @if (!result.loading() && !result.failed()) {
      <div class="tiles">
        <div class="tile surface">
          <div class="label-caps">Monthly levy roll</div>
          <div class="big money">{{ levyRoll() | rand: 'whole' }}</div>
          <div class="muted">{{ statuses().length }} scheme{{ statuses().length === 1 ? '' : 's' }}</div>
        </div>
        <div class="tile surface">
          <div class="label-caps">Runs in progress</div>
          <div class="big">{{ inProgress() }}</div>
          <div class="muted">{{ awaiting() }} awaiting approval</div>
        </div>
        <div class="tile surface">
          <div class="label-caps">Not yet prepared</div>
          <div class="big" [class.warn]="due().length">{{ due().length }}</div>
          <div class="muted">schemes with no run for their next period</div>
        </div>
      </div>
    }

    <ui-view-tabs label="Billing views" [tabs]="tabs()" [active]="state().view ?? 'schemes'" (activeChange)="state.update((s) => ({ ...s, view: $event }))" />

    @if (result.loading()) {
      <ui-skeleton [count]="6" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load billing" (retry)="result.retry()" /></div>
    } @else if (state().view === 'runs') {
      @if (runs().length === 0) {
        <div class="surface"><ui-empty-state kind="first-use" illustration="empty-tray" title="No billing runs yet" message="Prepare a run to bill a scheme’s levies for the month." /></div>
      } @else {
        <ui-data-table caption="Billing runs" [rows]="runs()" [columns]="runColumns" [rowId]="runId" (rowClick)="openRun($event)">
          <ng-template uiCell="ref" let-r>
            <div class="title">{{ r.run.ref }}</div>
            <div class="muted">{{ r.scheme.name }}</div>
          </ng-template>
          <ng-template uiCell="period" let-r>{{ period(r.run.period) }}</ng-template>
          <ng-template uiCell="stage" let-r><ui-status-pill [label]="stageLabel(r.run.stage)" [tone]="stageTone(r)" /></ng-template>
          <ng-template uiCell="accounts" let-r>{{ r.accounts }}</ng-template>
          <ng-template uiCell="total" let-r><span class="money">{{ r.total | rand }}</span></ng-template>
          <ng-template uiCell="exceptions" let-r>
            @if (r.openExceptions) {
              <span class="warn">{{ r.openExceptions }} to decide</span>
            } @else {
              <span class="muted">{{ r.run.exceptions.length ? 'All decided' : '—' }}</span>
            }
          </ng-template>
        </ui-data-table>
      }
    } @else {
      <ui-data-table caption="Schemes" [rows]="statuses()" [columns]="schemeColumns" [rowId]="schemeId" (rowClick)="openScheme($event)">
        <ng-template uiCell="scheme" let-s>
          <div class="title">{{ s.scheme.name }}</div>
          <div class="muted">{{ s.scheme.unitCount }} units</div>
        </ng-template>
        <ng-template uiCell="roll" let-s><span class="money">{{ s.levyRoll | rand }}</span></ng-template>
        <ng-template uiCell="last" let-s>
          @if (s.lastPosted; as l) {
            <div>{{ period(l.period) }} · <span class="money">{{ l.total | rand }}</span></div>
            <div class="muted">Posted {{ formatDate(l.at, true) }}</div>
          } @else {
            <span class="muted">Never billed</span>
          }
        </ng-template>
        <ng-template uiCell="current" let-s>
          @if (s.current; as c) {
            <a [routerLink]="['/finance/billing', c.run.id]" (click)="$event.stopPropagation()">{{ c.run.ref }}</a>
            <ui-status-pill [label]="stageLabel(c.run.stage)" [tone]="stageTone(c)" />
            @if (c.openExceptions) {
              <div class="warn">{{ c.openExceptions }} exception{{ c.openExceptions === 1 ? '' : 's' }} to decide</div>
            }
          } @else {
            <span class="muted">Next: {{ period(s.nextPeriod) }}</span>
          }
        </ng-template>
        <ng-template uiCell="action" let-s>
          @if (!s.current && canRun()) {
            <button type="button" class="btn btn-secondary btn-sm" (click)="$event.stopPropagation(); newRun(s.scheme.id)">Prepare {{ period(s.nextPeriod, false) }}</button>
          }
        </ng-template>
      </ui-data-table>
    }
  `,
  styles: `
    :host { display: block; }
    .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-3); margin-bottom: var(--s-4); }
    .tile { padding: var(--s-3) var(--s-4); }
    .big { margin: var(--s-1) 0 2px; font-size: var(--fs-xl); font-weight: var(--fw-semibold); }
    .title { font-weight: var(--fw-medium); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .warn { color: var(--c-warning); font-size: var(--fs-sm); }
    .big.warn { font-size: var(--fs-xl); }
    ui-status-pill { margin-left: var(--s-2); }
    @media (max-width: 700px) { .tiles { grid-template-columns: 1fr; } }
  `,
})
export class BillingPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(BillingDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly scope = inject(ScopeService);
  private readonly session = inject(SessionService);

  protected readonly state = urlState({ view: 'schemes' });

  protected readonly result = loadable(() => {
    const ids = this.scope.effectiveIds();
    return combineLatest([this.data.status(ids), this.data.runs(ids)]).pipe(map(([statuses, runs]) => ({ statuses, runs: runs.items })));
  });

  protected readonly statuses = computed(() => [...(this.result.value()?.statuses ?? [])].sort((a, b) => a.scheme.name.localeCompare(b.scheme.name)));
  protected readonly runs = computed(() => this.result.value()?.runs ?? []);

  protected readonly levyRoll = computed(() => this.statuses().reduce((s, x) => s + x.levyRoll, 0));
  protected readonly inProgress = computed(() => this.statuses().filter((s) => s.current).length);
  protected readonly awaiting = computed(() => this.statuses().filter((s) => s.current?.run.stage === 'awaiting-approval').length);
  protected readonly due = computed(() => this.statuses().filter((s) => !s.current));

  protected readonly tabs = computed(() => [
    { id: 'schemes', label: 'Schemes', count: this.statuses().length },
    { id: 'runs', label: 'Runs', count: this.runs().length },
  ]);

  protected readonly schemeColumns: ColumnDef<SchemeBillingStatus>[] = [
    { key: 'scheme', header: 'Scheme', mobile: 'title', sort: (s) => s.scheme.name },
    { key: 'roll', header: 'Levy roll', align: 'end', width: '130px', sort: (s) => s.levyRoll },
    { key: 'last', header: 'Last posted', width: '200px', sort: (s) => s.lastPosted?.period ?? '' },
    { key: 'current', header: 'Current run', width: '260px', mobile: 'field' },
    { key: 'action', header: '', align: 'end', width: '150px' },
  ];

  protected readonly runColumns: ColumnDef<BillingRunSummary>[] = [
    { key: 'ref', header: 'Run', mobile: 'title', sort: (r) => r.run.ref },
    { key: 'period', header: 'Period', width: '140px', sort: (r) => r.run.period },
    { key: 'stage', header: 'Stage', width: '180px', sort: (r) => r.run.stage },
    { key: 'accounts', header: 'Accounts', align: 'end', width: '100px', sort: (r) => r.accounts },
    { key: 'total', header: 'Total', align: 'end', width: '140px', sort: (r) => r.total },
    { key: 'exceptions', header: 'Exceptions', width: '140px' },
  ];

  protected readonly canRun = computed(() => this.session.can('Billing.Run') && this.session.hasFeature('billing') && !this.session.readOnly());
  protected readonly runId = (r: BillingRunSummary) => r.run.id;
  protected readonly schemeId = (s: SchemeBillingStatus) => s.scheme.id;
  protected readonly stageTone = (r: BillingRunSummary) => BILLING_STAGE_TONE[r.run.stage];
  protected readonly stageLabel = billingStageLabel;
  protected readonly period = periodLabel;
  protected readonly formatDate = formatDate;

  constructor() {
    // "New billing run" arrives as /finance/billing?new=1 (the old billing/new route and quick actions).
    if (this.route.snapshot.queryParamMap.get('new') === '1') {
      queueMicrotask(() => {
        if (this.canRun()) this.newRun();
        this.router.navigate([], { relativeTo: this.route, queryParams: { new: null }, queryParamsHandling: 'merge', replaceUrl: true });
      });
    }
  }

  protected openRun(r: BillingRunSummary): void {
    void this.router.navigate(['/finance/billing', r.run.id]);
  }

  protected openScheme(s: SchemeBillingStatus): void {
    if (s.current) void this.router.navigate(['/finance/billing', s.current.run.id]);
    else this.state.update((x) => ({ ...x, view: 'runs' }));
  }

  protected newRun(schemeId?: string): void {
    const ready = this.statuses();
    if (!ready.length) return;
    newRunForm(this.drawer, this.data, this.router, ready, schemeId ?? this.scope.scopeId() ?? undefined);
  }
}
