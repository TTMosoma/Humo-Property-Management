import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map, of } from 'rxjs';
import { BUDGET_STATUS_LABELS, BillingDataSource, BudgetDataSource, CollectionDataSource, PayablesDataSource, ReceiptDataSource, Scheme, periodLabel } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { RandPipe, formatDate } from '../../ui/format/money';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { collectionStageLabel } from '../finance/credit-control/collection-view';
import { BUDGET_TONE } from '../finance/budgets/budget-view';

/**
 * A scheme's Finance tab: its levy roll, receipts, credit control, payables
 * and budget on one page, each linking to the agency-wide screen for the work.
 */
@Component({
  selector: 'app-scheme-finance',
  imports: [RouterLink, IonIcon, RandPipe, StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cards">
      <!-- Levy roll -->
      <section class="surface card">
        <header><h2>Levies</h2><a routerLink="/finance/billing">Billing</a></header>
        @if (billing(); as b) {
          <p class="big">{{ b.levyRoll | rand: 'whole' }}<span> a month</span></p>
          <dl>
            <div><dt>Last billed</dt><dd>{{ b.lastPosted ? periodName(b.lastPosted.period) + ' · ' + (b.lastPosted.total | rand: 'whole') : 'Not yet' }}</dd></div>
            <div><dt>Next run</dt><dd>{{ periodName(b.nextPeriod) }}</dd></div>
          </dl>
        } @else {
          <p class="muted">Loading…</p>
        }
      </section>

      <!-- Receipts -->
      @if (session.hasFeature('payment-allocation')) {
        <section class="surface card">
          <header><h2>Receipts</h2><a routerLink="/finance/receipts">Receipts</a></header>
          @if (receipts(); as r) {
            <p class="big">{{ r.month | rand: 'whole' }}<span> received in the last 30 days</span></p>
            <dl>
              <div><dt>Payments</dt><dd>{{ r.count }}</dd></div>
              <div><dt>To allocate</dt><dd [class.warn]="r.unallocated > 0">{{ r.unallocated }}{{ r.unallocated ? ' · ' : '' }}{{ r.unallocated ? (r.unallocatedAmount | rand: 'whole') : '' }}</dd></div>
              <div><dt>In suspense</dt><dd>{{ r.suspense }}</dd></div>
            </dl>
          }
        </section>
      }

      <!-- Credit control -->
      @if (session.hasFeature('credit-control')) {
        <section class="surface card">
          <header><h2>Arrears</h2><a routerLink="/finance/credit-control">Credit control</a></header>
          @if (collections(); as c) {
            <p class="big" [class.warn]="c.total > 0">{{ c.total | rand: 'whole' }}<span> overdue on {{ c.accounts }} {{ c.accounts === 1 ? 'account' : 'accounts' }}</span></p>
            @if (c.stages.length) {
              <ul class="stages">
                @for (s of c.stages; track s.label) {
                  <li><span>{{ s.label }}</span><strong>{{ s.count }}</strong></li>
                }
              </ul>
            } @else {
              <p class="muted">Nobody is behind.</p>
            }
          }
        </section>
      }

      <!-- Payables -->
      @if (session.hasFeature('payables')) {
        <section class="surface card">
          <header><h2>Payables</h2><a routerLink="/finance/payables">Payables</a></header>
          @if (payables(); as p) {
            <p class="big">{{ p.owing | rand: 'whole' }}<span> to suppliers, not yet paid</span></p>
            <dl>
              <div><dt>Awaiting approval</dt><dd [class.warn]="p.awaiting > 0">{{ p.awaiting }}</dd></div>
              <div><dt>Approved, to pay</dt><dd>{{ p.approved }}</dd></div>
              <div><dt>In a payment batch</dt><dd>{{ p.inBatch }}</dd></div>
              <div><dt>Paid in the last 30 days</dt><dd>{{ p.paid | rand: 'whole' }}</dd></div>
            </dl>
          }
        </section>
      }
    </div>

    <!-- Budget -->
    @if (session.hasFeature('budgets')) {
      <section class="surface card budget">
        <header><h2>Budget</h2><a routerLink="/finance/budgets">All budgets</a></header>
        @if (budgets(); as list) {
          @if (!list.length) {
            <p class="muted">No budget in Humo Property Management for {{ scheme().name }} yet.</p>
          }
          @for (v of list; track v.budget.id) {
            <a class="budget-row" [routerLink]="['/finance/budgets', v.budget.id]">
              <span class="year">{{ v.budget.year }}</span>
              <ui-status-pill [label]="statusLabel(v.budget.status)" [tone]="tone(v.budget.status)" />
              <span class="muted">Expenses {{ v.totals.expense | rand: 'whole' }}</span>
              @if (v.elapsed > 0) {
                <span class="muted">Spent {{ v.totals.expenseActual | rand: 'whole' }} · {{ round(v.elapsed * 100) }}% of the year gone</span>
              }
              @if (v.overspent.length) {
                <span class="warn">Over: {{ v.overspent.join(', ') }}</span>
              }
              <ion-icon name="chevron-forward-outline" aria-hidden="true" />
            </a>
          }
        }
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--s-4); }
    .card { padding: var(--s-4) var(--s-5); }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-2); margin-bottom: var(--s-2); }
    h2 { margin: 0; font-size: var(--fs-md); }
    header a { font-size: var(--fs-sm); }
    .big { margin: 0 0 var(--s-3); font-family: var(--font-display); font-size: var(--fs-2xl); font-variant-numeric: tabular-nums; }
    .big span { font-family: var(--font-body); font-size: var(--fs-sm); color: var(--c-text-muted); }
    dl { display: flex; flex-direction: column; gap: var(--s-1); margin: 0; }
    dl div { display: flex; justify-content: space-between; gap: var(--s-3); font-size: var(--fs-sm); }
    dt { color: var(--c-text-muted); }
    dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; }
    .stages { display: flex; flex-direction: column; gap: var(--s-1); margin: 0; padding: 0; list-style: none; font-size: var(--fs-sm); }
    .stages li { display: flex; justify-content: space-between; }
    .muted { font-size: var(--fs-sm); color: var(--c-text-muted); }
    .warn { color: var(--c-warning); }
    .budget-row {
      display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3);
      padding: var(--s-3) 0; color: inherit; text-decoration: none; border-top: 1px solid var(--c-border);
    }
    .budget-row:hover .year { text-decoration: underline; }
    .budget-row ion-icon { margin-left: auto; color: var(--c-text-muted); }
    .year { font-weight: var(--fw-medium); }
  `,
})
export class SchemeFinance {
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionService);
  private readonly billingData = inject(BillingDataSource);
  private readonly receiptData = inject(ReceiptDataSource);
  private readonly collectionData = inject(CollectionDataSource);
  private readonly payablesData = inject(PayablesDataSource);
  private readonly budgetData = inject(BudgetDataSource);

  protected readonly scheme = toSignal(this.route.data.pipe(map((d) => d['scheme'] as Scheme)), { initialValue: this.route.snapshot.data['scheme'] as Scheme });
  private readonly ids = computed(() => [this.scheme().id]);
  private readonly since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  private readonly billingResult = loadable(() => this.billingData.status(this.ids()));
  protected readonly billing = computed(() => this.billingResult.value()?.[0]);

  private readonly receiptResult = loadable(() => (this.session.hasFeature('payment-allocation') ? this.receiptData.list(this.ids(), { pageSize: 1000 }) : of(undefined)));
  protected readonly receipts = computed(() => {
    const items = this.receiptResult.value()?.items;
    if (!items) return undefined;
    const recent = items.filter((r) => r.receipt.date >= this.since.slice(0, 10));
    const open = items.filter((r) => r.receipt.status === 'unallocated');
    return {
      month: recent.reduce((n, r) => n + r.receipt.amount, 0),
      count: recent.length,
      unallocated: open.length,
      unallocatedAmount: open.reduce((n, r) => n + r.receipt.amount, 0),
      suspense: items.filter((r) => r.receipt.status === 'suspense').length,
    };
  });

  private readonly collectionResult = loadable(() => (this.session.hasFeature('credit-control') ? this.collectionData.list(this.ids(), { pageSize: 1000 }) : of(undefined)));
  protected readonly collections = computed(() => {
    const items = this.collectionResult.value()?.items;
    if (!items) return undefined;
    const behind = items.filter((c) => c.overdueAmount > 0);
    const counts = new Map<string, number>();
    for (const c of behind) counts.set(collectionStageLabel(c.case.stage), (counts.get(collectionStageLabel(c.case.stage)) ?? 0) + 1);
    return {
      total: behind.reduce((n, c) => n + c.overdueAmount, 0),
      accounts: behind.length,
      stages: [...counts].map(([label, count]) => ({ label, count })),
    };
  });

  private readonly payablesResult = loadable(() => (this.session.hasFeature('payables') ? this.payablesData.invoices(this.ids()) : of(undefined)));
  protected readonly payables = computed(() => {
    const items = this.payablesResult.value();
    if (!items) return undefined;
    const by = (s: string) => items.filter((i) => i.invoice.status === s);
    const unpaid = items.filter((i) => ['awaiting-approval', 'approved', 'in-batch'].includes(i.invoice.status));
    return {
      owing: unpaid.reduce((n, i) => n + (i.invoice.approvedAmount ?? i.invoice.amount), 0),
      awaiting: by('awaiting-approval').length,
      approved: by('approved').length,
      inBatch: by('in-batch').length,
      paid: by('paid').filter((i) => (i.invoice.paidAt ?? '') >= this.since).reduce((n, i) => n + i.invoice.amount, 0),
    };
  });

  private readonly budgetResult = loadable(() => (this.session.hasFeature('budgets') ? this.budgetData.list(this.ids()) : of([])));
  protected readonly budgets = computed(() => (this.budgetResult.value() ? [...this.budgetResult.value()!].sort((a, b) => a.budget.from.localeCompare(b.budget.from)) : undefined));

  protected readonly periodName = periodLabel;
  protected readonly formatDate = formatDate;
  protected readonly round = Math.round;
  protected readonly statusLabel = (s: keyof typeof BUDGET_STATUS_LABELS) => BUDGET_STATUS_LABELS[s];
  protected readonly tone = (s: keyof typeof BUDGET_TONE) => BUDGET_TONE[s];
}
