import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { BILLING_PREFERENCE_HELP, BILLING_PREFERENCE_LABELS, InvoiceDocument, InvoiceStatus, PlanDataSource } from '../../domain';
import { PrototypeControls } from '../../core/prototype/prototype-controls';
import { SessionService } from '../../core/session/session.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { REASON_FIELD, openForm } from '../shared/form-drawer';
import { formatDate, formatRand } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';

const STATUS_LABEL: Record<InvoiceStatus, string> = { issued: 'Unpaid', overdue: 'Overdue', paid: 'Paid', void: 'Void' };
const STATUS_TONE: Record<InvoiceStatus, 'info' | 'danger' | 'success' | 'neutral'> = { issued: 'info', overdue: 'danger', paid: 'success', void: 'neutral' };

/**
 * Settings › Billing & invoices: the agency's own Humo invoices, for its
 * administrators. Each opens as a printable document. How they pay is changed
 * by their Humo account manager.
 */
@Component({
  selector: 'app-billing-page',
  imports: [PageHeader, StatusPill, EmptyState, ErrorState, Skeleton, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Settings" title="Billing & invoices" [subtitle]="'Humo’s invoices to ' + (session.organisation()?.shortName ?? 'your agency') + ', and how you pay.'" />

    @if (invoices() === undefined) {
      <ui-skeleton [count]="4" />
    } @else if (invoices() === null) {
      <div class="surface"><ui-error-state title="We couldn’t load your invoices" /></div>
    } @else {
      @if (latest(); as l) {
        <section class="surface how">
          <div>
            <span class="label-caps">You pay by</span><strong>{{ prefLabel[l.billingPreference] }}</strong>
            @if (l.billingPreference === 'card-recurring') {
              <span class="muted">Each invoice is charged to the card you saved with Payfast (a debit order). Humo never sees your card.</span>
              @if (session.can('Subscription.Request') && !session.readOnly()) {
                <button type="button" class="btn btn-ghost btn-sm" (click)="cancelDebitOrder()">Cancel the debit order</button>
              }
            } @else {
              <span class="muted">{{ prefHelp[l.billingPreference] }} To pay by card each month, tick “Save my card” when you pay an invoice.</span>
            }
          </div>
          <div><span class="label-caps">Outstanding</span><strong [class.bad]="overdue() > 0">{{ rand(outstanding()) }}</strong><span class="muted">{{ overdue() ? overdue() + ' overdue' : 'Nothing overdue' }}</span></div>
          <div><span class="label-caps">Invoices go to</span><strong>{{ l.billTo.billingEmail }}</strong><span class="muted">To change how you pay, ask your Humo account manager (Plan &amp; features).</span></div>
        </section>
      }
      @if (demo) {
        <p class="demo-note">Demo data: these invoices are simulated. In the live service, each invoice is emailed to you as a secure link.</p>
      }
      @if (invoices()!.length) {
        <div class="surface table-wrap">
          <table class="table">
            <caption class="visually-hidden">Your Humo invoices</caption>
            <thead><tr><th scope="col">Invoice</th><th scope="col">Period</th><th scope="col">Due</th><th scope="col" class="end">Total</th><th scope="col">Status</th></tr></thead>
            <tbody>
              @for (d of invoices(); track d.invoice.id) {
                <tr>
                  <th scope="row"><a [routerLink]="['/settings/billing', d.invoice.id]">{{ d.invoice.reference }}</a></th>
                  <td>{{ month(d.invoice.periodStart) }}</td>
                  <td>{{ date(d.invoice.dueOn) }}</td>
                  <td class="end">{{ rand(d.invoice.total) }}</td>
                  <td><ui-status-pill [label]="statusLabel[d.invoice.status]" [tone]="statusTone[d.invoice.status]" />@if (d.balance > 0 && d.payments.length) { <span class="muted block">Payment being verified</span> }</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="surface"><ui-empty-state title="No invoices yet" message="Humo’s invoices to your agency appear here." /></div>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .how { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--s-4); padding: var(--s-4) var(--s-5); }
    .how > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
    .bad { color: var(--c-danger); }
    .demo-note { margin: 0; padding: var(--s-2) var(--s-3); font-size: var(--fs-sm); border-radius: var(--r); background: var(--c-info-soft, var(--c-neutral-soft)); }
    .muted { color: var(--c-text-muted); font-size: var(--fs-sm); }
    .block { display: block; }
    .table-wrap { overflow-x: auto; }
    .table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .table th, .table td { padding: var(--s-2) var(--s-3); text-align: left; border-bottom: 1px solid var(--c-border); font-weight: var(--fw-regular); white-space: nowrap; }
    .table thead th { font-weight: var(--fw-medium); }
    .end { text-align: right !important; }
  `,
})
export class BillingPage {
  /** The simulation: its invoices are made up and never sent. */
  protected readonly demo = !!inject(PrototypeControls, { optional: true });
  protected readonly session = inject(SessionService);
  private readonly data = inject(PlanDataSource);
  private readonly drawer = inject(DrawerService);

  /** Stops the card debit order (cancelled at Payfast). Later invoices are paid with Pay now or by EFT. */
  protected cancelDebitOrder(): void {
    const org = this.session.organisation()?.id ?? '';
    openForm(this.drawer, {
      eyebrow: 'Billing & invoices',
      title: 'Cancel the card debit order',
      intro: 'Payfast stops charging your card. You’ll pay each invoice yourself, online with Pay now or by EFT.',
      fields: [REASON_FIELD],
      submitLabel: 'Cancel the debit order',
      submit: (f) => this.data.cancelCardMandate(org, f['reason']),
      success: () => 'Cancelled. Your card won’t be charged again.',
      failure: 'The debit order wasn’t cancelled',
    });
  }

  /** undefined while loading, null on failure. */
  protected readonly invoices = toSignal(
    this.data.invoices(this.session.organisation()?.id ?? '').pipe(
      map((r): InvoiceDocument[] | null => r),
      catchError(() => of(null)),
    ),
  );
  protected readonly latest = computed(() => this.invoices()?.[0]);
  protected readonly outstanding = computed(() => (this.invoices() ?? []).filter((d) => d.invoice.status !== 'paid' && d.invoice.status !== 'void').reduce((n, d) => n + d.balance, 0));
  protected readonly overdue = computed(() => (this.invoices() ?? []).filter((d) => d.invoice.status === 'overdue').length);

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly statusTone = STATUS_TONE;
  protected readonly prefLabel = BILLING_PREFERENCE_LABELS;
  protected readonly prefHelp = BILLING_PREFERENCE_HELP;
  protected readonly date = (d: string) => formatDate(d);
  protected readonly rand = (n: number) => formatRand(n, { cents: false });
  protected readonly month = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
}
