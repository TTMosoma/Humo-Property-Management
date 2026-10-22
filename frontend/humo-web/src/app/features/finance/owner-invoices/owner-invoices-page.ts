import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { IonIcon } from '@ionic/angular/standalone';
import { OwnerInvoice, OwnerInvoiceDataSource, Scheme, SchemeDataSource, UnitDataSource, UnitSummary } from '../../../domain';
import { FeedbackService } from '../../../core/feedback/feedback.service';
import { SessionService } from '../../../core/session/session.service';
import { formatDate, formatRand } from '../../../ui/format/money';

interface DraftLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Basic invoicing (D17): issue an invoice to an owner for a unit, record payments by hand, and email the owner. Each
 * invoice posts to the unit's account, so its owner's statement shows it. Writing needs the billing permissions.
 */
@Component({
  selector: 'app-owner-invoices-page',
  imports: [FormsModule, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-head">
      <h1>Invoices</h1>
      <p class="muted">Invoices to owners for their units. Each one is added to the owner’s account and shows on their statement.</p>
    </header>

    @if (canIssue()) {
      <section class="surface panel">
        <h2>New invoice</h2>
        <div class="grid two">
          <label>Unit
            <select [ngModel]="draftUnit()" (ngModelChange)="draftUnit.set($event)">
              <option value="">Choose a unit</option>
              @for (u of units(); track u.unit.id) {
                <option [value]="u.unit.id">{{ schemeName(u.scheme.id) }} · Unit {{ u.unit.number }}</option>
              }
            </select>
          </label>
          <label>Invoice date <input type="date" [ngModel]="draftDate()" (ngModelChange)="draftDate.set($event)" /></label>
          <label>Due <input type="date" [ngModel]="draftDue()" (ngModelChange)="draftDue.set($event)" /></label>
        </div>
        <table class="lines">
          <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th><th></th></tr></thead>
          <tbody>
            @for (line of lines(); track $index; let i = $index) {
              <tr>
                <td><input [ngModel]="line.description" (ngModelChange)="setLine(i, 'description', $event)" /></td>
                <td><input type="number" min="0" [ngModel]="line.quantity" (ngModelChange)="setLine(i, 'quantity', +$event)" /></td>
                <td><input type="number" min="0" [ngModel]="line.unitPrice" (ngModelChange)="setLine(i, 'unitPrice', +$event)" /></td>
                <td>{{ money(lineAmount(line)) }}</td>
                <td><button type="button" class="btn btn-ghost btn-sm" (click)="removeLine(i)">Remove</button></td>
              </tr>
            }
          </tbody>
        </table>
        <div class="actions">
          <button type="button" class="btn btn-ghost" (click)="addLine()">Add a line</button>
          <strong>Total {{ money(draftTotal()) }}</strong>
          <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="issue()">Issue invoice</button>
        </div>
        @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
      </section>
    }

    <section class="surface panel">
      <h2>Issued invoices</h2>
      @if (invoices().length === 0) {
        <p class="muted">No invoices yet.</p>
      }
      <ul class="invoices">
        @for (inv of invoices(); track inv.id) {
          <li>
            <div class="row">
              <strong>{{ inv.number }}</strong>
              <span>{{ inv.accountNo }}</span>
              <span>{{ money(inv.total) }}</span>
              <span>Owed {{ money(inv.outstanding) }}</span>
              <span class="pill" [class.paid]="inv.status === 'paid'">{{ inv.status === 'paid' ? 'Paid' : 'Owed' }}</span>
              <span class="muted">Due {{ formatDate(inv.dueOn, true) }}</span>
            </div>
            @if (inv.status !== 'paid' && canPay()) {
              <div class="row">
                <input type="number" min="0" placeholder="Amount" [ngModel]="paymentAmount()" (ngModelChange)="paymentAmount.set($event)" />
                <input placeholder="Reference (EFT, cheque)" [ngModel]="paymentReference()" (ngModelChange)="paymentReference.set($event)" />
                <button type="button" class="btn btn-secondary btn-sm" (click)="pay(inv)">Record payment</button>
              </div>
            }
            @if (canSend()) {
              <div class="row">
                <button type="button" class="btn btn-ghost btn-sm" (click)="emailOwner(inv)">{{ inv.emailedAt ? 'Email again' : 'Email the owner' }}</button>
              </div>
            }
          </li>
        }
      </ul>
    </section>
  `,
  styles: `
    .page-head { margin-bottom: var(--s-4); }
    .panel { margin-bottom: var(--s-4); padding: var(--s-4); }
    .grid.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--s-3); margin-bottom: var(--s-3); }
    label { display: flex; flex-direction: column; gap: var(--s-1); font-size: var(--fs-sm); }
    .lines { width: 100%; border-collapse: collapse; margin-bottom: var(--s-3); }
    .lines th, .lines td { padding: var(--s-1); text-align: left; }
    .actions, .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); margin: var(--s-2) 0; }
    .invoices { list-style: none; padding: 0; margin: 0; }
    .invoices li { border-top: 1px solid var(--c-border); padding: var(--s-3) 0; }
    .pill { padding: 2px 8px; border-radius: var(--r-pill); background: var(--c-warning-soft); font-size: var(--fs-xs); }
    .pill.paid { background: var(--c-success-soft); }
    .error { color: var(--c-danger); }
  `,
})
export class OwnerInvoicesPage {
  private readonly data = inject(OwnerInvoiceDataSource);
  private readonly schemesData = inject(SchemeDataSource);
  private readonly unitsData = inject(UnitDataSource);
  private readonly feedback = inject(FeedbackService);
  private readonly session = inject(SessionService);

  protected readonly formatDate = formatDate;
  protected readonly money = (value: number) => formatRand(value, { cents: true });
  protected readonly canIssue = computed(() => this.session.can('Billing.Run') && this.session.hasFeature('invoicing-basic'));
  protected readonly canPay = computed(() => this.session.can('Receipts.Allocate') && this.session.hasFeature('invoicing-basic'));
  protected readonly canSend = computed(() => this.session.can('Billing.Run') && this.session.hasFeature('invoicing-basic'));

  protected readonly schemes = signal<Scheme[]>([]);
  protected readonly units = signal<UnitSummary[]>([]);
  protected readonly invoices = signal<OwnerInvoice[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly draftUnit = signal('');
  protected readonly draftDate = signal(today());
  protected readonly draftDue = signal(addDays(today(), 30));
  protected readonly lines = signal<DraftLine[]>([{ description: '', quantity: 1, unitPrice: 0 }]);
  protected readonly draftTotal = computed(() => this.lines().reduce((sum, l) => sum + this.lineAmount(l), 0));

  protected readonly paymentAmount = signal<number | null>(null);
  protected readonly paymentReference = signal('');

  constructor() {
    this.schemesData.list().pipe(takeUntilDestroyed()).subscribe((schemes) => {
      this.schemes.set(schemes);
      this.loadInvoices(schemes.map((s) => s.id));
      this.loadUnits(schemes.map((s) => s.id));
    });
  }

  protected schemeName(id: string): string {
    return this.schemes().find((s) => s.id === id)?.name ?? '';
  }

  protected lineAmount(line: DraftLine): number {
    return Math.round((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0) * 100) / 100;
  }

  protected setLine(i: number, field: keyof DraftLine, value: string | number): void {
    this.lines.update((ls) => ls.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  protected addLine(): void {
    this.lines.update((ls) => [...ls, { description: '', quantity: 1, unitPrice: 0 }]);
  }

  protected removeLine(i: number): void {
    this.lines.update((ls) => ls.filter((_, idx) => idx !== i));
  }

  protected issue(): void {
    const lines = this.lines().filter((l) => l.description.trim() || l.unitPrice);
    if (!this.draftUnit()) return this.error.set('Choose the unit to invoice.');
    this.error.set('');
    this.busy.set(true);
    this.data
      .issue({ unitId: this.draftUnit(), date: this.draftDate(), dueOn: this.draftDue(), lines })
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.feedback.success('Invoice issued and added to the owner’s account.');
          this.lines.set([{ description: '', quantity: 1, unitPrice: 0 }]);
          this.reload();
        },
        error: (e: { message?: string }) => {
          this.busy.set(false);
          this.error.set(e?.message ?? 'The invoice wasn’t issued.');
        },
      });
  }

  protected pay(inv: OwnerInvoice): void {
    const amount = Number(this.paymentAmount());
    if (!(amount > 0)) {
      this.feedback.error('Enter the amount received.');
      return;
    }
    this.data.recordPayment(inv.id, amount, today(), this.paymentReference() || undefined).pipe(takeUntilDestroyed()).subscribe({
      next: () => {
        this.feedback.success(`Payment recorded against ${inv.number}.`);
        this.paymentAmount.set(null);
        this.paymentReference.set('');
        this.reload();
      },
      error: (e: { message?: string }) => this.feedback.error(e?.message ?? 'The payment wasn’t recorded.'),
    });
  }

  protected emailOwner(inv: OwnerInvoice): void {
    this.data.send(inv.id).pipe(takeUntilDestroyed()).subscribe({
      next: () => {
        this.feedback.success('Invoice emailed to the owner.');
        this.reload();
      },
      error: (e: { message?: string }) => this.feedback.error(e?.message ?? 'The invoice wasn’t emailed.'),
    });
  }

  private loadInvoices(schemeIds: string[]): void {
    this.data.list(schemeIds).pipe(takeUntilDestroyed()).subscribe((list) => this.invoices.set(list));
  }

  private loadUnits(schemeIds: string[]): void {
    this.unitsData.list(schemeIds).pipe(takeUntilDestroyed()).subscribe((page) => this.units.set(page.items));
  }

  private reload(): void {
    const ids = this.schemes().map((s) => s.id);
    this.loadInvoices(ids);
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

