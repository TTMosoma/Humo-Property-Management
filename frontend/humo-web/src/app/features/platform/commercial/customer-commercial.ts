import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of, switchMap } from 'rxjs';
import {
  BILLING_PREFERENCE_HELP,
  BILLING_PREFERENCE_LABELS,
  CommercialDataSource,
  CustomerCommercialView,
  CustomerInvoice,
  GB,
  InvoiceStatus,
  PAYMENT_STATUS_LABELS,
  PRICE_STATUS_LABELS,
  PaymentRecord,
  STORAGE_COUNTS,
  STORAGE_EXCLUDES,
  ScheduledItem,
  StorageState,
  describeFailure,
} from '../../../domain';
import { FeedbackService } from '../../../core/feedback/feedback.service';
import { StepUpService } from '../../../core/security/step-up.service';
import { SessionService } from '../../../core/session/session.service';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { formatDate, formatRand } from '../../../ui/format/money';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { StatusPill } from '../../../ui/status-pill/status-pill';
import { AgreementChangeDrawer, AgreementChangeInput } from './agreement-change-drawer';
import { adjustmentForm, billingPreferenceForm, eftProofForm, reconcileForm, renewalForm, storageExceptionForm } from './commercial-forms';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STORAGE_TONE: Record<StorageState, Tone> = { ok: 'success', warning: 'warning', critical: 'danger', exhausted: 'danger', unknown: 'neutral' };
const INVOICE_TONE: Record<InvoiceStatus, Tone> = { issued: 'info', overdue: 'danger', paid: 'success', void: 'neutral' };

/**
 * Customer › Billing & agreement (docs/23): what the customer agreed to pay,
 * scheduled changes, storage, invoices and payments, and who changed what.
 * Humo staff with Platform.Revenue.View; changes by permission and, for
 * Account Managers, only on their own accounts (D11).
 */
@Component({
  selector: 'app-customer-commercial',
  imports: [IonIcon, StatusPill, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result() === undefined) {
      <ui-skeleton variant="tiles" [count]="3" />
    } @else if (result() === null) {
      <div class="surface"><ui-error-state title="We couldn’t load the agreement" /></div>
    } @else {
      @let v = result()!;
      <p class="demo-note"><ion-icon name="flask-outline" aria-hidden="true" /> Demo data. Prices marked proposed are not approved. Invoices and payments are simulated: no money moves and no invoice is sent.</p>

      <section class="surface panel">
        <header class="p-head">
          <div>
            <h2>Agreement</h2>
            <p class="muted">What {{ v.name }} agreed to pay. Catalogue price changes don’t reach it unless someone changes the agreement.</p>
          </div>
          @if (canChange()) {
            <div class="actions">
              <button type="button" class="btn btn-primary btn-sm" (click)="open(v, 'add-on')"><ion-icon name="add-outline" aria-hidden="true" /> Add an add-on</button>
              <button type="button" class="btn btn-secondary btn-sm" (click)="open(v, 'package')">Change package</button>
              @if (v.current.recurring.some(isAddOn)) {
                <button type="button" class="btn btn-ghost btn-sm" (click)="open(v, 'remove-add-on')">Remove an add-on</button>
              }
              <button type="button" class="btn btn-ghost btn-sm" (click)="adjust(v)">Discount or credit</button>
            </div>
          }
        </header>
        <div class="facts">
          <div><span class="label-caps">Recurring, per month</span><strong class="big">{{ rand(v.current.recurringMonthly) }}</strong><span class="muted small">excl. tax{{ v.current.awaitingPrice ? ' · ' + v.current.awaitingPrice + ' item(s) awaiting a price' : '' }}</span></div>
          <div><span class="label-caps">Billing</span><strong>{{ prefLabel[v.agreement.billing.preference] }}</strong><span class="muted small">{{ v.agreement.billing.billingEmail }}{{ v.agreement.billing.mandate.status === 'active' ? ' · mandate on file (simulated)' : '' }}</span></div>
          <div><span class="label-caps">Next billing date</span><strong>{{ date(v.agreement.billing.nextBillingDate) }}</strong><span class="muted small">{{ v.agreement.cycle === 'annual' ? 'Billed annually' : 'Billed monthly' }}</span></div>
          <div>
            <span class="label-caps">Annual renewal</span><strong>{{ date(v.agreement.renewal.on) }}</strong>
            <span class="muted small">{{ v.agreement.renewal.fee ? rand(v.agreement.renewal.fee) + ' renewal fee, invoiced once' : 'No renewal fee' }}@if (canChange()) { · <button type="button" class="link" (click)="renewal(v)">{{ v.agreement.renewal.fee ? 'Change' : 'Add a renewal fee' }}</button> }</span>
          </div>
          <div><span class="label-caps">Account manager</span><strong>{{ v.accountManager?.name ?? 'Unassigned' }}</strong><span class="muted small">From the Humo team record</span></div>
        </div>
        @if (canChange()) {
          <p class="muted small"><button type="button" class="link" (click)="preference(v)">Change billing preference</button> · {{ prefHelp[v.agreement.billing.preference] }}</p>
        }

        <table class="table">
          <caption class="sr-only">Recurring charges</caption>
          <thead><tr><th scope="col">Recurring charge</th><th scope="col">Price basis</th><th scope="col" class="end">Per month</th></tr></thead>
          <tbody>
            @for (l of v.current.recurring; track $index) {
              <tr [class.discount]="l.kind === 'discount'">
                <th scope="row">{{ l.label }}</th>
                <td class="muted">{{ l.detail }}{{ l.frequency === 'annual' ? ' · billed annually' : '' }}</td>
                <td class="end">{{ l.amount === null ? 'Price to be agreed' : rand(l.amount) }}</td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr><th scope="row" colspan="2">Recurring total, excl. tax</th><td class="end"><strong>{{ rand(v.current.recurringMonthly) }}</strong></td></tr>
            <tr>
              <th scope="row" colspan="2">{{ v.current.tax.registered ? 'VAT at ' + v.current.tax.ratePercent + '%' : 'VAT' }}</th>
              <td class="end muted">{{ v.current.tax.registered ? rand(v.current.tax.amount) : 'Not charged: Humo isn’t configured as VAT registered' }}</td>
            </tr>
          </tfoot>
        </table>

        @if (v.current.onceOff.length || v.current.credits.length) {
          <h3>On the next invoice only</h3>
          <ul class="plain">
            @for (l of v.current.onceOff.concat(v.current.credits); track $index) {
              <li><span>{{ l.label }}</span><span class="muted">{{ l.kind === 'credit' ? 'Credit' : 'Once-off fee' }} · {{ l.detail }}</span><span class="end">{{ rand(l.amount ?? 0) }}</span></li>
            }
          </ul>
        }
        @for (u of v.current.usage; track u.label) {
          <p class="muted small"><ion-icon name="pulse-outline" aria-hidden="true" /> Usage: {{ u.label }}: {{ u.note }}</p>
        }
      </section>

      <section class="surface panel">
        <h2>Scheduled changes</h2>
        @if (v.scheduled.length) {
          <ul class="plain">
            @for (s of v.scheduled; track s.lineId + s.kind) {
              <li>
                <span><strong>{{ date(s.from) }}</strong> · {{ s.label }}</span>
                <span class="muted">{{ change(s) }}</span>
                @if (canChange() && s.kind !== 'removal') {
                  <button type="button" class="btn btn-ghost btn-sm" (click)="cancel(v, s)">Cancel</button>
                }
              </li>
            }
          </ul>
        } @else {
          <p class="muted">Nothing scheduled. Add-ons and package changes can start on a future date: they take effect then, not when they’re saved.</p>
        }
      </section>

      <section class="surface panel">
        <header class="p-head">
          <div>
            <h2>Storage</h2>
            <p class="muted">{{ v.storage.measurement.source === 'demo' ? 'Demo measurement' : 'Measured' }}, {{ date(v.storage.measurement.measuredAt) }}. Not yet enforced by a server: only the API can refuse an upload over quota.</p>
          </div>
          <ui-status-pill [label]="storageLabel(v)" [tone]="storageTone[v.storage.state]" />
        </header>
        <div class="meter" role="meter" [attr.aria-valuenow]="v.storage.percent ?? 0" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="'Storage used: ' + (v.storage.percent ?? 0) + '%'">
          <span [style.width.%]="min(v.storage.percent ?? 0, 100)" [attr.data-state]="v.storage.state"></span>
          <i [style.left.%]="v.storage.thresholds[0]" title="First warning"></i><i [style.left.%]="v.storage.thresholds[1]" title="Second warning"></i>
        </div>
        <div class="facts">
          <div><span class="label-caps">Used</span><strong>{{ gb(v.storage.usedBytes) }}</strong><span class="muted small">{{ v.storage.percent ?? '—' }}% · documents {{ gb(v.storage.measurement.documentsBytes) }}, images {{ gb(v.storage.measurement.imagesBytes) }}, generated {{ gb(v.storage.measurement.generatedBytes) }}</span></div>
          <div><span class="label-caps">Included</span><strong>{{ v.storage.includedGb === null ? 'Negotiated' : v.storage.includedGb + ' GB' }}</strong><span class="muted small">{{ v.storage.negotiated ? 'Agreed for this customer' : priceStatus[v.storage.includedStatus] }}</span></div>
          <div><span class="label-caps">Purchased</span><strong>{{ v.storage.purchasedGb }} GB</strong><span class="muted small">Storage packs</span></div>
          <div><span class="label-caps">Exceptions</span><strong>{{ v.storage.exceptionGb }} GB</strong><span class="muted small">Temporary, no charge</span></div>
          <div><span class="label-caps">Available</span><strong>{{ v.storage.totalGb === null ? '—' : v.storage.totalGb + ' GB' }}</strong><span class="muted small">Warnings at {{ v.storage.thresholds[0] }}% and {{ v.storage.thresholds[1] }}%</span></div>
        </div>
        @if (v.storage.state === 'exhausted') {
          <p class="banner danger">The allowance is used up. Uploads are refused until storage is added or files are archived. Nothing is charged or upgraded automatically.</p>
        } @else if (v.storage.state === 'warning' || v.storage.state === 'critical') {
          <p class="banner">Over {{ v.storage.state === 'critical' ? v.storage.thresholds[1] : v.storage.thresholds[0] }}% used. Worth a conversation about a storage pack before uploads are refused.</p>
        }
        @if (canChange()) {
          <div class="actions">
            <button type="button" class="btn btn-secondary btn-sm" (click)="open(v, 'add-on', 'storage-10')"><ion-icon name="server-outline" aria-hidden="true" /> Add storage</button>
            <button type="button" class="btn btn-ghost btn-sm" (click)="exception(v)">Temporary exception</button>
          </div>
        }
        <details class="counts">
          <summary>What counts toward the quota</summary>
          <div class="cols">
            <ul>@for (c of counts; track c) { <li>{{ c }}</li> }</ul>
            <ul class="no">@for (c of excludes; track c) { <li>{{ c }}</li> }</ul>
          </div>
        </details>
      </section>

      <section class="surface panel">
        <header class="p-head">
          <div>
            <h2>Invoices & payments</h2>
            <p class="muted">An invoice is paid only once a payment is verified: by the provider’s notification, or for EFT by matching Humo’s bank statement.</p>
          </div>
          @if (canBill()) {
            <button type="button" class="btn btn-secondary btn-sm" (click)="issue(v)">Issue next invoice (simulated)</button>
          }
        </header>
        @if (v.invoices.length) {
          @for (inv of v.invoices; track inv.id) {
            <article class="invoice">
              <div class="inv-head">
                <strong>{{ inv.reference }}</strong>
                <span class="muted">{{ date(inv.periodStart) }} – {{ date(dayBefore(inv.periodEnd)) }} · due {{ date(inv.dueOn) }}</span>
                <span class="end"><strong>{{ rand(inv.total) }}</strong></span>
                <ui-status-pill [label]="invoiceLabel(inv)" [tone]="invoiceTone[inv.status]" />
              </div>
              @if (inv.payments.length) {
                <ul class="payments">
                  @for (p of inv.payments; track p.id) {
                    <li>
                      <span>{{ paymentStatus[p.status] }} · {{ prefLabel[p.method] }} · {{ rand(p.amount) }}{{ p.simulated ? ' · simulated' : '' }}</span>
                      <span class="muted small">{{ p.verifiedBy ? 'Verified by ' + p.verifiedBy + ', ' + date(p.verifiedAt!) : p.note ?? p.provider }}</span>
                      @if (canBill() && p.status === 'initiated' && p.simulated) {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="notify(p, 'paid')">Simulate provider confirmation</button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="notify(p, 'failed')">Simulate failure</button>
                      }
                      @if (canBill() && p.status === 'pending-verification') {
                        <button type="button" class="btn btn-secondary btn-sm" (click)="reconcile(v, p)">Verify against bank statement</button>
                      }
                    </li>
                  }
                </ul>
              }
              @if (inv.status === 'issued' || inv.status === 'overdue') {
                <div class="actions">
                  @if (canBill() && v.agreement.billing.preference !== 'manual-eft' && !pending(inv)) {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="checkout(inv)">Start checkout (simulated)</button>
                  }
                  @if (canChange() && v.agreement.billing.preference === 'manual-eft' && !pending(inv)) {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="proof(v, inv)">Record proof of payment</button>
                  }
                </div>
              }
            </article>
          }
        } @else {
          <p class="muted">No invoices in the demo data for this customer.</p>
        }
      </section>

      <section class="surface panel">
        <h2>Agreement history</h2>
        <ol class="history">
          @for (e of v.agreement.history; track $index) {
            <li>
              <strong>{{ e.action }}</strong>
              <span class="muted small">{{ e.by }} · {{ date(e.at) }}{{ e.effectiveFrom ? ' · effective ' + date(e.effectiveFrom) : '' }} · “{{ e.reason }}” · Approval: {{ e.approval }}</span>
            </li>
          }
        </ol>
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .panel { display: flex; flex-direction: column; gap: var(--s-3); padding: var(--s-4) var(--s-5); }
    .p-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--s-3); }
    h2 { margin: 0; font-size: var(--fs-lg); }
    h3 { margin: var(--s-2) 0 0; font-size: var(--fs-md); }
    .muted { margin: 0; color: var(--c-text-muted); font-size: var(--fs-sm); }
    .small { font-size: var(--fs-xs); }
    .big { font-size: var(--fs-xl, 1.5rem); }
    .demo-note { margin: 0; display: flex; gap: var(--s-2); align-items: center; padding: var(--s-2) var(--s-3); font-size: var(--fs-sm); border-radius: var(--r); background: var(--c-info-soft, var(--c-neutral-soft)); }
    .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--s-3); }
    .facts > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
    .link { padding: 0; border: 0; background: none; color: var(--c-accent, var(--c-primary)); font: inherit; text-decoration: underline; cursor: pointer; }
    .table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .table th, .table td { padding: 6px var(--s-2); text-align: left; border-bottom: 1px solid var(--c-border); font-weight: var(--fw-regular); }
    .table tfoot th { font-weight: var(--fw-medium); }
    .end { text-align: right !important; }
    .discount td.end { color: var(--c-success); }
    .plain { list-style: none; margin: 0; padding: 0; font-size: var(--fs-sm); }
    .plain li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); padding: 6px 0; border-bottom: 1px solid var(--c-border); }
    .plain li > .end { margin-left: auto; }
    .meter { position: relative; height: 12px; border-radius: 6px; background: var(--c-neutral-soft); overflow: hidden; }
    .meter span { display: block; height: 100%; background: var(--c-success); }
    .meter span[data-state='warning'] { background: var(--c-warning); }
    .meter span[data-state='critical'], .meter span[data-state='exhausted'] { background: var(--c-danger); }
    .meter i { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--c-text-faint, #999); }
    .banner { margin: 0; padding: var(--s-2) var(--s-3); font-size: var(--fs-sm); border-left: 3px solid var(--c-warning); background: var(--c-warning-soft); }
    .banner.danger { border-left-color: var(--c-danger); background: var(--c-danger-soft); }
    .counts summary { cursor: pointer; font-size: var(--fs-sm); }
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--s-3); font-size: var(--fs-sm); }
    .cols ul { margin: var(--s-2) 0 0; padding-left: var(--s-5); }
    .cols ul.no { color: var(--c-text-muted); }
    .cols ul.no li::marker { content: '✕ '; }
    .invoice { display: flex; flex-direction: column; gap: var(--s-2); padding: var(--s-3) 0; border-bottom: 1px solid var(--c-border); }
    .inv-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); }
    .inv-head .end { margin-left: auto; }
    .payments { list-style: none; margin: 0; padding: 0 0 0 var(--s-4); font-size: var(--fs-sm); display: flex; flex-direction: column; gap: 4px; }
    .payments li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
    .history { margin: 0; padding-left: var(--s-5); display: flex; flex-direction: column; gap: var(--s-2); font-size: var(--fs-sm); }
    .history li { display: flex; flex-direction: column; }
  `,
})
export class CustomerCommercial {
  readonly organisationId = input.required<string>();
  /** Account Managers change only the accounts they look after (D11). */
  readonly ownAccount = input(true);

  private readonly data = inject(CommercialDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  private readonly stepUp = inject(StepUpService);
  private readonly session = inject(SessionService);

  /** undefined while loading, null on failure. */
  protected readonly result = toSignal(
    toObservable(this.organisationId).pipe(switchMap((id) => this.data.customer(id).pipe(map((v) => v ?? null), catchError(() => of(null))))),
  );

  protected readonly canChange = computed(() => this.session.can('Platform.Subscriptions.Manage') && this.ownAccount() && !this.session.readOnly());
  protected readonly canBill = computed(() => this.session.can('Platform.Billing.Manage') && !this.session.readOnly());

  protected readonly prefLabel = BILLING_PREFERENCE_LABELS;
  protected readonly prefHelp = BILLING_PREFERENCE_HELP;
  protected readonly paymentStatus = PAYMENT_STATUS_LABELS;
  protected readonly priceStatus = PRICE_STATUS_LABELS;
  protected readonly storageTone = STORAGE_TONE;
  protected readonly invoiceTone = INVOICE_TONE;
  protected readonly counts = STORAGE_COUNTS;
  protected readonly excludes = STORAGE_EXCLUDES;
  protected readonly min = Math.min;
  protected readonly isAddOn = (l: { kind: string }) => l.kind === 'add-on';
  protected readonly date = (d: string) => formatDate(d);
  protected readonly rand = (n: number) => formatRand(n, { cents: false });
  protected readonly gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;
  protected readonly dayBefore = (d: string) => new Date(new Date(`${d}T00:00:00`).getTime() - 86_400_000).toISOString();

  protected change(s: ScheduledItem): string {
    if (s.monthlyChange === null || s.monthlyChange === 0) return 'No change to the recurring total';
    return `${s.monthlyChange > 0 ? '+' : ''}${this.rand(s.monthlyChange)} a month from then`;
  }

  protected storageLabel(v: CustomerCommercialView): string {
    return { ok: 'Within allowance', warning: `Over ${v.storage.thresholds[0]}%`, critical: `Over ${v.storage.thresholds[1]}%`, exhausted: 'Full: uploads refused', unknown: 'Allowance negotiated' }[v.storage.state];
  }

  protected invoiceLabel(inv: CustomerInvoice): string {
    const sim = inv.simulated ? ' (simulated)' : '';
    return { issued: 'Issued', overdue: 'Overdue', paid: `Paid${sim}`, void: 'Void' }[inv.status];
  }

  protected pending(inv: CustomerInvoice): boolean {
    return inv.payments.some((p) => p.status === 'initiated' || p.status === 'pending-verification');
  }

  protected open(v: CustomerCommercialView, mode: AgreementChangeInput['mode'], addOnId?: string): void {
    this.drawer.open(AgreementChangeDrawer, { view: v, mode, addOnId } satisfies AgreementChangeInput, `Change ${v.name}’s agreement`);
  }

  protected adjust(v: CustomerCommercialView): void {
    adjustmentForm(this.drawer, this.data, v);
  }

  protected preference(v: CustomerCommercialView): void {
    billingPreferenceForm(this.drawer, this.data, v);
  }

  protected renewal(v: CustomerCommercialView): void {
    renewalForm(this.drawer, this.data, v);
  }

  protected exception(v: CustomerCommercialView): void {
    storageExceptionForm(this.drawer, this.data, v);
  }

  protected proof(v: CustomerCommercialView, inv: CustomerInvoice): void {
    eftProofForm(this.drawer, this.data, v, inv);
  }

  protected reconcile(v: CustomerCommercialView, p: PaymentRecord): void {
    reconcileForm(this.drawer, this.data, v, p);
  }

  protected cancel(v: CustomerCommercialView, s: ScheduledItem): void {
    this.stepUp
      .guard({ action: 'change-subscription', detail: `Cancel “${s.label}” for ${v.name}` }, () =>
        this.data.change(v.organisationId, { type: 'cancel-scheduled', lineId: s.lineId, reason: `Cancelled before it took effect: ${s.label}` }, v.agreement.version),
      )
      .subscribe({ next: () => this.feedback.success('Scheduled change cancelled.'), error: (e) => this.feedback.error(describeFailure(e, 'The change wasn’t cancelled')) });
  }

  protected issue(v: CustomerCommercialView): void {
    this.stepUp
      .guard({ action: 'verify-payment', detail: `Issue ${v.name}’s next invoice (simulated)` }, () => this.data.issueInvoice(v.organisationId))
      .subscribe({ next: () => this.feedback.success('Invoice issued (simulated: nothing was sent).'), error: (e) => this.feedback.error(describeFailure(e, 'The invoice wasn’t issued')) });
  }

  protected checkout(inv: CustomerInvoice): void {
    this.data.startCheckout(inv.id).subscribe({
      next: () => this.feedback.success('Checkout started (simulated). The invoice stays unpaid until the provider confirms the payment.'),
      error: (e) => this.feedback.error(describeFailure(e, 'The checkout didn’t start')),
    });
  }

  protected notify(p: PaymentRecord, outcome: 'paid' | 'failed'): void {
    this.data.simulateProviderNotification(p.id, outcome, `SIM-EVT-${p.id}-${outcome}`).subscribe({
      next: () => this.feedback.success(outcome === 'paid' ? 'Simulated provider confirmation recorded. No money moved.' : 'Simulated failure recorded.'),
      error: (e) => this.feedback.error(describeFailure(e, 'That didn’t work')),
    });
  }
}
