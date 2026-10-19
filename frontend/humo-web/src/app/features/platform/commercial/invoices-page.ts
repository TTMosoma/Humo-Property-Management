import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { BILLING_PREFERENCE_LABELS, CommercialDataSource, InvoiceListItem, InvoiceStatus, isoDay } from '../../../domain';
import { PrototypeControls } from '../../../core/prototype/prototype-controls';
import { urlState } from '../../../ui/data-table/url-state';
import { ViewTabs } from '../../../ui/data-table/view-tabs';
import { formatDate, formatRand } from '../../../ui/format/money';
import { PageHeader } from '../../../ui/page-header/page-header';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { StatusPill } from '../../../ui/status-pill/status-pill';

type View = 'all' | 'unpaid' | 'overdue' | 'paid';
const STATUS_LABEL: Record<InvoiceStatus, string> = { issued: 'Unpaid', overdue: 'Overdue', paid: 'Paid', void: 'Void' };
const STATUS_TONE: Record<InvoiceStatus, 'info' | 'danger' | 'success' | 'neutral'> = { issued: 'info', overdue: 'danger', paid: 'success', void: 'neutral' };

/**
 * Platform › Invoices: Humo's invoices to every customer in one list, for
 * staff who can see revenue. Each opens as the document the customer sees.
 * Invoices aren't sent yet: the billing run and emails are backend work (R-14).
 */
@Component({
  selector: 'app-invoices-page',
  imports: [PageHeader, ViewTabs, StatusPill, EmptyState, ErrorState, Skeleton, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Humo platform" title="Invoices" subtitle="Humo’s invoices to its customers. Paid only once a payment is verified." />
    @if (demo) {
      <p class="demo-note">Demo data: invoices are simulated and none has been sent. Customers’ agency administrators see their own under Settings › Billing &amp; invoices.</p>
    } @else {
      <p class="demo-note">Each invoice is emailed to the customer’s billing address when it’s issued. Their agency administrators see their own under Settings › Billing &amp; invoices.</p>
    }

    @if (rows() === undefined) {
      <ui-skeleton [count]="6" />
    } @else if (rows() === null) {
      <div class="surface"><ui-error-state title="We couldn’t load the invoices" /></div>
    } @else {
      <div class="tiles">
        <div class="tile surface"><span class="label-caps">Outstanding</span><strong>{{ rand(totals().outstanding) }}</strong><span class="muted">{{ totals().unpaid }} unpaid</span></div>
        <div class="tile surface" [class.bad]="totals().overdue > 0"><span class="label-caps">Overdue</span><strong>{{ rand(totals().overdueAmount) }}</strong><span class="muted">{{ totals().overdue }} invoice{{ totals().overdue === 1 ? '' : 's' }}</span></div>
        <div class="tile surface"><span class="label-caps">Paid this month</span><strong>{{ rand(totals().paidThisMonth) }}</strong><span class="muted">Verified payments</span></div>
      </div>

      <div class="bar">
        <ui-view-tabs label="Invoice status" [tabs]="tabs()" [active]="view()" (activeChange)="setView($event)" />
        <input type="search" placeholder="Customer or reference" aria-label="Search invoices" [value]="q()" (input)="q.set($any($event.target).value)" />
      </div>

      @if (filtered().length) {
        <div class="surface table-wrap">
          <table class="table">
            <caption class="visually-hidden">Invoices</caption>
            <thead>
              <tr><th scope="col">Invoice</th><th scope="col">Customer</th><th scope="col">Period</th><th scope="col">Due</th><th scope="col" class="end">Total</th><th scope="col">Status</th><th scope="col">Pays by</th></tr>
            </thead>
            <tbody>
              @for (i of filtered(); track i.id) {
                <tr>
                  <th scope="row"><a [routerLink]="['/platform/invoices', i.id]">{{ i.reference }}</a></th>
                  <td><a [routerLink]="['/platform/customers', i.organisationId]" [queryParams]="{ view: 'commercial' }">{{ i.customerName }}</a><span class="muted block">{{ i.accountManager }}</span></td>
                  <td>{{ month(i.periodStart) }}</td>
                  <td>{{ date(i.dueOn) }}</td>
                  <td class="end">{{ rand(i.total) }}</td>
                  <td>
                    <ui-status-pill [label]="statusLabel[i.status] + (i.status === 'paid' && i.simulated ? ' (simulated)' : '')" [tone]="statusTone[i.status]" />
                    @if (awaiting(i)) {
                      <span class="muted block">Payment awaiting verification</span>
                    }
                  </td>
                  <td class="muted">{{ prefLabel[i.billingPreference] }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="surface"><ui-empty-state title="No invoices here" message="Nothing matches this view." /></div>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .demo-note { margin: 0; padding: var(--s-2) var(--s-3); font-size: var(--fs-sm); border-radius: var(--r); background: var(--c-info-soft, var(--c-neutral-soft)); }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--s-3); }
    .tile { display: flex; flex-direction: column; gap: 2px; padding: var(--s-3) var(--s-4); }
    .tile strong { font-size: var(--fs-lg); }
    .tile.bad strong { color: var(--c-danger); }
    .bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); }
    .bar input { min-height: 34px; min-width: 0; flex: 0 1 260px; }
    .muted { color: var(--c-text-muted); font-size: var(--fs-sm); }
    .block { display: block; }
    .table-wrap { overflow-x: auto; }
    .table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .table th, .table td { padding: var(--s-2) var(--s-3); text-align: left; vertical-align: top; border-bottom: 1px solid var(--c-border); font-weight: var(--fw-regular); white-space: nowrap; }
    .table thead th { font-weight: var(--fw-medium); }
    .end { text-align: right !important; }
  `,
})
export class InvoicesPage {
  /** The simulation: its invoices are made up and never sent. */
  protected readonly demo = !!inject(PrototypeControls, { optional: true });
  private readonly data = inject(CommercialDataSource);
  private readonly state = urlState({ view: 'all' });

  /** undefined while loading, null on failure. */
  protected readonly rows = toSignal(this.data.invoices().pipe(map((r): InvoiceListItem[] | null => r), catchError(() => of(null))));
  protected readonly q = signal('');
  protected readonly view = computed(() => (this.state().view ?? 'all') as View);

  private readonly is = (v: View, i: InvoiceListItem) =>
    v === 'all' || (v === 'paid' ? i.status === 'paid' : v === 'overdue' ? i.status === 'overdue' : i.status === 'issued' || i.status === 'overdue');

  protected readonly tabs = computed(() => {
    const all = this.rows() ?? [];
    const n = (v: View) => all.filter((i) => this.is(v, i)).length;
    return (['all', 'unpaid', 'overdue', 'paid'] as View[]).map((v) => ({ id: v, label: { all: 'All', unpaid: 'Unpaid', overdue: 'Overdue', paid: 'Paid' }[v], count: n(v) }));
  });

  protected readonly filtered = computed(() => {
    const q = this.q().trim().toLowerCase();
    return (this.rows() ?? []).filter((i) => this.is(this.view(), i) && (!q || i.customerName.toLowerCase().includes(q) || i.reference.toLowerCase().includes(q)));
  });

  protected readonly totals = computed(() => {
    const all = this.rows() ?? [];
    const unpaid = all.filter((i) => i.status === 'issued' || i.status === 'overdue');
    const overdue = all.filter((i) => i.status === 'overdue');
    const month = isoDay(new Date()).slice(0, 7);
    const verified = all.flatMap((i) => i.payments).filter((p) => p.status === 'verified' && (p.verifiedAt ?? '').slice(0, 7) === month);
    return {
      unpaid: unpaid.length,
      outstanding: unpaid.reduce((n, i) => n + i.total, 0),
      overdue: overdue.length,
      overdueAmount: overdue.reduce((n, i) => n + i.total, 0),
      paidThisMonth: verified.reduce((n, p) => n + p.amount, 0),
    };
  });

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly statusTone = STATUS_TONE;
  protected readonly prefLabel = BILLING_PREFERENCE_LABELS;
  protected readonly date = (d: string) => formatDate(d);
  protected readonly rand = (n: number) => formatRand(n, { cents: false });
  protected readonly month = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
  protected readonly awaiting = (i: InvoiceListItem) => i.status !== 'paid' && i.payments.some((p) => p.status === 'pending-verification' || p.status === 'initiated');

  protected setView(v: string): void {
    this.state.set({ view: v });
  }
}
