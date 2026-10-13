import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BILLING_PREFERENCE_LABELS, InvoiceDocument, InvoiceStatus, PAYMENT_STATUS_LABELS } from '../../domain';
import { formatDate, formatRand } from '../../ui/format/money';
import { StatusPill } from '../../ui/status-pill/status-pill';

const STATUS_LABEL: Record<InvoiceStatus, string> = { issued: 'Unpaid', overdue: 'Overdue', paid: 'Paid', void: 'Void' };
const STATUS_TONE: Record<InvoiceStatus, 'info' | 'danger' | 'success' | 'neutral'> = { issued: 'info', overdue: 'danger', paid: 'success', void: 'neutral' };

/**
 * A Humo invoice as a document: from, to, lines, totals, how to pay and what's
 * been paid. Used by Humo staff (Platform › Invoices) and by the customer's
 * administrators (Settings › Billing & invoices). Prints cleanly ("Print or
 * save PDF"); the app chrome is hidden in print (styles.scss).
 */
@Component({
  selector: 'app-invoice-document',
  imports: [StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = doc();
    @let inv = d.invoice;
    <article class="sheet" [attr.aria-label]="'Invoice ' + inv.reference">
      @if (inv.simulated) {
        <p class="sim">Demo invoice: simulated data. Not a tax invoice, and nothing was sent or paid.</p>
      }
      <header class="top">
        <div>
          <div class="brand">Humo</div>
          <div class="muted">{{ d.from.legalName }}</div>
          @if (d.from.registrationNumber) {
            <div class="muted">Reg. no. {{ d.from.registrationNumber }}</div>
          }
          @if (d.from.vatRegistered && d.from.vatNumber) {
            <div class="muted">VAT no. {{ d.from.vatNumber }}</div>
          }
        </div>
        <div class="title">
          <h2>{{ d.from.vatRegistered ? 'Tax invoice' : 'Invoice' }}</h2>
          <div class="ref">{{ inv.reference }}</div>
          <ui-status-pill [label]="statusLabel[inv.status]" [tone]="statusTone[inv.status]" />
        </div>
      </header>

      <section class="parties">
        <div>
          <span class="label-caps">Bill to</span>
          <strong>{{ d.billTo.legalName }}</strong>
          @if (d.billTo.legalName !== d.billTo.name) {
            <span class="muted">Trading as {{ d.billTo.name }}</span>
          }
          <span class="muted">{{ d.billTo.city }}{{ d.billTo.province ? ', ' + d.billTo.province : '' }}</span>
          <span class="muted">{{ d.billTo.billingEmail }}</span>
        </div>
        <dl>
          <dt>Issued</dt><dd>{{ date(inv.issuedOn) }}</dd>
          <dt>Due</dt><dd>{{ date(inv.dueOn) }}</dd>
          <dt>Period</dt><dd>{{ date(inv.periodStart) }} – {{ date(lastDay()) }}</dd>
        </dl>
      </section>

      <table class="lines">
        <caption class="visually-hidden">Invoice lines</caption>
        <thead><tr><th scope="col">Description</th><th scope="col" class="end">Qty</th><th scope="col" class="end">Unit price</th><th scope="col" class="end">Amount</th></tr></thead>
        <tbody>
          @for (l of inv.lines; track $index) {
            <tr>
              <td>{{ l.description }}@if (l.priceSource === 'included') { <span class="muted"> · included in the package price</span> }</td>
              <td class="end">{{ l.quantity }}</td>
              <td class="end">{{ rand(l.unitPrice) }}</td>
              <td class="end">{{ rand(l.amount) }}</td>
            </tr>
          }
        </tbody>
        <tfoot>
          <tr><th scope="row" colspan="3">Subtotal{{ d.from.vatRegistered ? ' (excl. VAT)' : '' }}</th><td class="end">{{ rand(inv.subtotal) }}</td></tr>
          <tr><th scope="row" colspan="3">{{ inv.tax.registered ? 'VAT at ' + inv.tax.ratePercent + '%' : 'VAT' }}</th><td class="end">{{ inv.tax.registered ? rand(inv.tax.amount) : 'Not charged' }}</td></tr>
          <tr class="total"><th scope="row" colspan="3">Total</th><td class="end">{{ rand(inv.total) }}</td></tr>
          @if (paid() > 0) {
            <tr><th scope="row" colspan="3">Paid</th><td class="end">−{{ rand(paid()) }}</td></tr>
            <tr class="total"><th scope="row" colspan="3">Balance due</th><td class="end">{{ rand(d.balance) }}</td></tr>
          }
        </tfoot>
      </table>

      <section class="pay">
        <span class="label-caps">How to pay</span>
        @switch (d.billingPreference) {
          @case ('card-recurring') {
            <p>Collected from the card on file under your recurring payment mandate, on or after the issue date. Nothing to do unless the payment fails.</p>
          }
          @case ('instant-eft') {
            <p>Pay online by Instant EFT from the link in the invoice email. Use reference <strong>{{ inv.reference }}</strong>.</p>
          }
          @default {
            <p>Pay by EFT into Humo’s bank account, using reference <strong>{{ inv.reference }}</strong>. The invoice is marked paid once the payment shows on Humo’s bank statement.</p>
            <p class="muted">Humo’s bank details appear here once Humo’s account is confirmed.</p>
          }
        }
        @if (d.payments.length) {
          <ul>
            @for (p of d.payments; track $index) {
              <li>{{ date(p.on) }} · {{ methodLabel[p.method] }} · {{ rand(p.amount) }} · {{ paymentLabel[p.status] }}{{ p.simulated ? ' (simulated)' : '' }}</li>
            }
          </ul>
        }
      </section>
    </article>
  `,
  styles: `
    :host { display: block; }
    .sheet { max-width: 820px; margin: 0 auto; padding: var(--s-6, 32px); background: var(--c-surface, #fff); border: 1px solid var(--c-border); border-radius: var(--r); display: flex; flex-direction: column; gap: var(--s-5, 24px); }
    .sim { margin: 0; padding: var(--s-2) var(--s-3); font-size: var(--fs-sm); text-align: center; border: 1px dashed var(--c-warning); color: var(--c-warning); border-radius: var(--r); }
    .top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--s-4); }
    .top > div { display: flex; flex-direction: column; gap: 2px; }
    .brand { font-size: 1.6rem; font-weight: var(--fw-bold, 700); letter-spacing: -0.02em; }
    .title { align-items: flex-end; text-align: right; }
    h2 { margin: 0; font-size: var(--fs-lg); text-transform: uppercase; letter-spacing: 0.08em; }
    .ref { font-weight: var(--fw-medium); }
    .muted { color: var(--c-text-muted); font-size: var(--fs-sm); }
    .parties { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--s-4); }
    .parties > div { display: flex; flex-direction: column; gap: 2px; }
    dl { display: grid; grid-template-columns: auto auto; gap: 2px var(--s-3); margin: 0; font-size: var(--fs-sm); }
    dt { color: var(--c-text-muted); }
    dd { margin: 0; text-align: right; }
    .lines { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .lines th, .lines td { padding: 6px var(--s-2); text-align: left; border-bottom: 1px solid var(--c-border); font-weight: var(--fw-regular); }
    .lines thead th { font-weight: var(--fw-medium); }
    .lines tfoot th { text-align: right; }
    .lines .total th, .lines .total td { font-weight: var(--fw-bold, 700); }
    .end { text-align: right !important; white-space: nowrap; }
    .pay p { margin: var(--s-1) 0 0; font-size: var(--fs-sm); }
    .pay ul { margin: var(--s-2) 0 0; padding-left: var(--s-5); font-size: var(--fs-sm); }
    @media (max-width: 600px) { .sheet { padding: var(--s-4); } .title { align-items: flex-start; text-align: left; } dd { text-align: left; } }
    @media print { .sheet { border: 0; max-width: none; padding: 0; } }
  `,
})
export class InvoiceDocumentView {
  readonly doc = input.required<InvoiceDocument>();

  protected readonly paid = computed(() => Math.round((this.doc().invoice.total - this.doc().balance) * 100) / 100);
  protected readonly lastDay = computed(() => new Date(new Date(`${this.doc().invoice.periodEnd}T00:00:00`).getTime() - 86_400_000).toISOString());
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly statusTone = STATUS_TONE;
  protected readonly methodLabel = BILLING_PREFERENCE_LABELS;
  protected readonly paymentLabel = PAYMENT_STATUS_LABELS;
  protected readonly date = (d: string) => formatDate(d);
  protected readonly rand = (n: number) => formatRand(n);
}
