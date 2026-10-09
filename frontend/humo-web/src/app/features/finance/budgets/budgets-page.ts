import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { BUDGET_STATUS_LABELS, BudgetDataSource, BudgetView } from '../../../domain';
import { loadable } from '../../../core/data/loadable';
import { ScopeNotice } from '../../../core/scope/scope-notice';
import { ScopeService } from '../../../core/scope/scope.service';
import { SessionService } from '../../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../../ui/data-table/data-table';
import { urlState } from '../../../ui/data-table/url-state';
import { ViewTabs } from '../../../ui/data-table/view-tabs';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { RandPipe } from '../../../ui/format/money';
import { PageHeader } from '../../../ui/page-header/page-header';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { StatusPill } from '../../../ui/status-pill/status-pill';
import { newBudgetForm } from './budget-forms';
import { BUDGET_TONE } from './budget-view';

/** Finance › Budgets: each scheme's budget, spending to date against it, and next year's drafts for the AGM. */
@Component({
  selector: 'app-budgets-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Finance" title="Budgets" subtitle="Each scheme’s budget, what’s been spent against it so far, and next year’s for the AGM. Actuals come from levies billed and supplier invoices.">
      @if (canManage()) {
        <button type="button" class="btn btn-primary" (click)="draft()"><ion-icon name="add-outline" aria-hidden="true" /> Draft next year’s budget</button>
      }
    </ui-page-header>
    <app-scope-notice />

    <ui-view-tabs label="Budget views" [tabs]="tabs()" [active]="state().view ?? 'current'" (activeChange)="state.update((s) => ({ ...s, view: $event }))" />

    @if (result.loading()) {
      <ui-skeleton [count]="8" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load budgets" (retry)="result.retry()" /></div>
    } @else if (!rows().length) {
      <div class="surface"><ui-empty-state title="Nothing here" [message]="state().view === 'next' ? 'No drafts for next year yet.' : 'No budgets in this view.'" /></div>
    } @else {
      <ui-data-table caption="Budgets" [rows]="rows()" [columns]="columns" [rowId]="rowId" (rowClick)="open($event)">
        <ng-template uiCell="scheme" let-v>
          <div class="title">{{ v.scheme.name }}</div>
          <div class="muted">{{ v.budget.year }} · {{ v.budget.from }} to {{ v.budget.to }}</div>
        </ng-template>
        <ng-template uiCell="status" let-v><ui-status-pill [label]="statusLabel(v)" [tone]="tone(v)" /></ng-template>
        <ng-template uiCell="expenses" let-v><span class="money">{{ v.totals.expense | rand: 'whole' }}</span></ng-template>
        <ng-template uiCell="spent" let-v>
          @if (v.elapsed > 0) {
            <div class="bar" [attr.aria-label]="pct(v) + '% of the budget to date'"><span [style.width.%]="min(100, pct(v))" [class.over]="pct(v) > 110"></span></div>
            <div class="muted">{{ v.totals.expenseActual | rand: 'whole' }} paid · {{ pct(v) }}% of budget to date, with approved invoices</div>
          } @else {
            <span class="muted">Starts {{ v.budget.from }}</span>
          }
        </ng-template>
        <ng-template uiCell="flags" let-v>
          @if (v.overspent.length) {
            <span class="warn">Over: {{ v.overspent.join(', ') }}</span>
          } @else {
            <span class="muted">—</span>
          }
        </ng-template>
      </ui-data-table>
    }
  `,
  styles: `
    :host { display: block; }
    .title { font-weight: var(--fw-medium); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .warn { font-size: var(--fs-sm); color: var(--c-warning); }
    .bar { height: 8px; overflow: hidden; background: var(--c-surface-sunken); border-radius: var(--r-pill); }
    .bar span { display: block; height: 100%; background: var(--c-primary); }
    .bar span.over { background: var(--c-warning); }
  `,
})
export class BudgetsPage {
  private readonly router = inject(Router);
  private readonly data = inject(BudgetDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly scope = inject(ScopeService);
  private readonly session = inject(SessionService);

  protected readonly state = urlState({ view: 'current' });
  protected readonly result = loadable(() => this.data.list(this.scope.effectiveIds()));
  private readonly all = computed(() => this.result.value() ?? []);
  private readonly today = new Date().toISOString().slice(0, 10);
  protected readonly tabs = computed(() => [
    { id: 'current', label: 'This year', count: this.all().filter((v) => this.isCurrent(v)).length },
    { id: 'next', label: 'Next year', count: this.all().filter((v) => v.budget.from > this.today).length },
    { id: 'all', label: 'All' },
  ]);
  protected readonly rows = computed(() => {
    const v = this.state().view ?? 'current';
    return this.all()
      .filter((x) => (v === 'current' ? this.isCurrent(x) : v === 'next' ? x.budget.from > this.today : true))
      .sort((a, b) => b.overspent.length - a.overspent.length || a.scheme.name.localeCompare(b.scheme.name));
  });
  private isCurrent(v: BudgetView): boolean {
    return v.budget.from <= this.today && this.today <= v.budget.to;
  }

  protected readonly columns: ColumnDef<BudgetView>[] = [
    { key: 'scheme', header: 'Scheme', mobile: 'title', sort: (v) => v.scheme.name },
    { key: 'status', header: 'Status', width: '170px', sort: (v) => v.budget.status },
    { key: 'expenses', header: 'Expenses budget', align: 'end', width: '140px', sort: (v) => v.totals.expense },
    { key: 'spent', header: 'Spent to date', width: '220px', sort: (v) => this.pct(v) },
    { key: 'flags', header: 'Over budget', width: '24%', mobile: 'field' },
  ];
  protected readonly rowId = (v: BudgetView) => v.budget.id;
  protected readonly statusLabel = (v: BudgetView) => BUDGET_STATUS_LABELS[v.budget.status];
  protected readonly tone = (v: BudgetView) => BUDGET_TONE[v.budget.status];
  protected readonly pct = (v: BudgetView) => {
    const toDate = v.lines.filter((l) => l.line.kind === 'expense' && l.actual !== null).reduce((n, l) => n + l.toDate, 0);
    const spent = v.lines.filter((l) => l.line.kind === 'expense' && l.actual !== null).reduce((n, l) => n + (l.actual ?? 0) + l.committed, 0);
    return toDate ? Math.round((spent / toDate) * 100) : 0;
  };
  protected readonly min = Math.min;
  protected readonly canManage = computed(() => this.session.can('Budgets.Manage') && this.session.hasFeature('budgets') && !this.session.readOnly());

  protected open(v: BudgetView): void {
    void this.router.navigate(['/finance/budgets', v.budget.id]);
  }

  protected draft(): void {
    newBudgetForm(this.drawer, this.data, this.router, this.scope.accessible(), this.scope.scopeId() ?? undefined);
  }
}
