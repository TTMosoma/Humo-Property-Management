import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, debounceTime, of, switchMap } from 'rxjs';
import {
  AgreementChange,
  ChangePreview,
  CommercialDataSource,
  CustomerCommercialView,
  PRICE_STATUS_LABELS,
  PRORATION_LABELS,
  PackageId,
  describeFailure,
  inForce,
  packageById,
  termsOn,
} from '../../../domain';
import { FeedbackService } from '../../../core/feedback/feedback.service';
import { StepUpService } from '../../../core/security/step-up.service';
import { Drawer } from '../../../ui/drawer/drawer';
import { formatDate, formatRand } from '../../../ui/format/money';

const TIERS: PackageId[] = ['essentials', 'professional', 'enterprise'];
const nextTier = (id: PackageId | undefined): PackageId => TIERS[Math.min(TIERS.indexOf(id ?? 'essentials') + 1, TIERS.length - 1)] === id ? TIERS[TIERS.length - 2] : TIERS[Math.min(TIERS.indexOf(id ?? 'essentials') + 1, TIERS.length - 1)];

export interface AgreementChangeInput {
  view: CustomerCommercialView;
  mode: 'package' | 'add-on' | 'remove-add-on';
  /** Preselects an add-on, e.g. a storage pack from the storage card. */
  addOnId?: string;
}

/**
 * Change a customer's package or add-ons, now or from a future date, with a
 * live preview of the recurring total before and after (the API computes it;
 * nothing is saved until Confirm). Prices come from the catalogue in force on
 * the date unless an agreed price is entered; either way the agreement keeps
 * that price from then on.
 */
@Component({
  selector: 'app-agreement-change-drawer',
  imports: [Drawer, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-drawer [eyebrow]="input.view.name + ' · Agreement'" [title]="title">
      <form class="form" (submit)="$event.preventDefault(); confirm()" novalidate>
        @switch (input.mode) {
          @case ('package') {
            <label class="field">
              <span class="f-label">Package</span>
              <select (change)="packageId.set($any($event.target).value)">
                @for (p of packages(); track p.packageId) {
                  <option [value]="p.packageId" [selected]="p.packageId === packageId()">{{ pkgName(p.packageId) }}{{ priceHint(p.packageId) }}</option>
                }
              </select>
            </label>
          }
          @case ('add-on') {
            <label class="field">
              <span class="f-label">Add-on</span>
              <select (change)="addOnId.set($any($event.target).value)">
                @for (a of addOns(); track a.id) {
                  <option [value]="a.id" [selected]="a.id === addOnId()">{{ a.name }}{{ addOnHint(a.id) }}</option>
                }
              </select>
            </label>
            @if (allowQuantity()) {
              <label class="field half">
                <span class="f-label">Quantity</span>
                <input type="number" min="1" max="20" [value]="quantity()" (input)="quantity.set(+$any($event.target).value)" />
              </label>
            }
          }
          @case ('remove-add-on') {
            <label class="field">
              <span class="f-label">Add-on to remove</span>
              <select (change)="addOnId.set($any($event.target).value)">
                @for (a of current(); track a.id) {
                  <option [value]="a.addOnId" [selected]="a.addOnId === addOnId()">{{ addOnName(a.addOnId) }}</option>
                }
              </select>
            </label>
          }
        }
        <label class="field half">
          <span class="f-label">{{ input.mode === 'remove-add-on' ? 'Ends on' : 'Takes effect' }}</span>
          <input type="date" [min]="input.view.today" [value]="effectiveFrom()" (input)="effectiveFrom.set($any($event.target).value)" />
          <span class="f-help">Next billing date: {{ date(input.view.agreement.billing.nextBillingDate) }}</span>
        </label>
        @if (input.mode !== 'remove-add-on') {
          <div class="field" role="group" aria-labelledby="price-label">
            <span class="f-label" id="price-label">Price</span>
            <label class="check"><input type="radio" name="price" [checked]="priceMode() === 'catalogue'" (change)="priceMode.set('catalogue')" /> Catalogue price on that date {{ catalogueNote() }}</label>
            <label class="check"><input type="radio" name="price" [checked]="priceMode() === 'agreed'" (change)="priceMode.set('agreed')" /> A price agreed with the customer</label>
            @if (priceMode() === 'agreed') {
              <input type="number" min="0" placeholder="Rand a month, excl. tax" [value]="agreedPrice()" (input)="agreedPrice.set($any($event.target).value)" aria-label="Agreed price" />
            }
          </div>
        }
        <label class="field">
          <span class="f-label">Reason</span>
          <textarea rows="2" [value]="reason()" (input)="reason.set($any($event.target).value)" placeholder="Recorded in the agreement history and the audit log"></textarea>
        </label>
      </form>

      @if (preview(); as p) {
        <section class="preview" aria-live="polite">
          <h3>Recurring total from {{ date(p.effectiveFrom) }}</h3>
          <div class="totals">
            <div><span class="label-caps">Now</span><strong>{{ rand(p.before.recurringMonthly) }}</strong></div>
            <ion-icon name="arrow-forward-outline" aria-hidden="true" />
            <div><span class="label-caps">After</span><strong>{{ rand(p.after.recurringMonthly) }}</strong></div>
            <div class="diff" [class.up]="p.difference > 0" [class.down]="p.difference < 0">{{ p.difference > 0 ? '+' : '' }}{{ rand(p.difference) }} a month</div>
          </div>
          <ul class="lines">
            @for (l of p.after.recurring; track $index) {
              <li><span>{{ l.label }}</span><span class="muted">{{ l.detail }}</span><span class="amt">{{ l.amount === null ? 'Price to be agreed' : rand(l.amount) }}</span></li>
            }
          </ul>
          @if (p.after.renewal.fee) {
            <p class="muted">Plus an annual renewal fee of {{ rand(p.after.renewal.fee) }} on {{ date(p.after.renewal.on) }}, invoiced once{{ p.after.renewal.fee !== p.before.renewal.fee ? ' (changes with this package)' : '' }}.</p>
          }
          <p class="muted">Excluding tax{{ p.after.tax.registered ? ' (VAT ' + p.after.tax.ratePercent + '% is added on the invoice)' : ': Humo isn’t configured to charge VAT' }}. First invoiced on {{ date(p.firstInvoiceOn) }}.</p>
          <p class="muted small">{{ policy(p) }}</p>
          @if (p.approvalNeeded) {
            <p class="muted small">Needs a second approver ({{ p.approvalNeeded }}): it waits on the agreement until Humo Finance approves it.</p>
          }
          @if (problems().length) {
            <ul class="errors" role="alert">
              @for (m of problems(); track m) {
                <li>{{ m }}</li>
              }
            </ul>
          }
        </section>
      }
      <div drawerFooter>
        <button type="button" class="btn btn-primary" (click)="confirm()" [disabled]="busy() || !ready()">
          <ion-icon name="finger-print-outline" aria-hidden="true" /> {{ busy() ? 'Saving…' : effectiveFrom() > input.view.today ? 'Schedule change' : 'Confirm change' }}
        </button>
        <button type="button" class="btn btn-ghost" (click)="ref.close()" [disabled]="busy()">Cancel</button>
      </div>
    </ui-drawer>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .form { display: flex; flex-wrap: wrap; gap: var(--s-4) var(--s-3); }
    .field { display: flex; flex-direction: column; gap: 6px; flex: 1 1 100%; min-width: 0; }
    .field.half { flex: 1 1 calc(50% - var(--s-3)); min-width: 140px; }
    .f-label { font-size: var(--fs-sm); font-weight: var(--fw-medium); color: var(--c-text-2); }
    .f-help { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .check { display: flex; gap: var(--s-2); align-items: center; font-size: var(--fs-sm); }
    .check input { width: auto; }
    input, select, textarea { width: 100%; }
    .preview { margin-top: var(--s-5); padding: var(--s-4); border: 1px solid var(--c-border); border-radius: var(--r); background: var(--c-surface-2, transparent); display: flex; flex-direction: column; gap: var(--s-2); }
    h3 { margin: 0; font-size: var(--fs-md); }
    .totals { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); }
    .totals > div { display: flex; flex-direction: column; }
    .totals strong { font-size: var(--fs-lg); }
    .diff { margin-left: auto; font-weight: var(--fw-medium); }
    .up { color: var(--c-warning); }
    .down { color: var(--c-success); }
    .lines { list-style: none; margin: 0; padding: 0; font-size: var(--fs-sm); }
    .lines li { display: grid; grid-template-columns: 1fr auto auto; gap: var(--s-2); padding: 4px 0; border-bottom: 1px solid var(--c-border); }
    .amt { text-align: right; min-width: 90px; }
    .muted { margin: 0; color: var(--c-text-muted); font-size: var(--fs-sm); }
    .small { font-size: var(--fs-xs); }
    .errors { margin: 0; padding: var(--s-2) var(--s-3) var(--s-2) var(--s-5); font-size: var(--fs-sm); color: var(--c-danger); background: var(--c-danger-soft); border-radius: var(--r); }
  `,
})
export class AgreementChangeDrawer {
  protected readonly input = inject<AgreementChangeInput>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef);
  private readonly data = inject(CommercialDataSource);
  private readonly stepUp = inject(StepUpService);
  private readonly feedback = inject(FeedbackService);

  private readonly catalogue = toSignal(this.data.catalogue());
  private readonly agreement = this.input.view.agreement;
  protected readonly title = { package: 'Change package', 'add-on': 'Add an add-on', 'remove-add-on': 'Remove an add-on' }[this.input.mode];

  protected readonly packages = computed(() => (this.catalogue()?.packages ?? []).filter((p) => p.status === 'active'));
  protected readonly addOns = computed(() => (this.catalogue()?.addOns ?? []).filter((a) => a.status === 'active'));
  protected readonly current = computed(() => inForce(this.agreement.addOns, this.input.view.today));

  /** The next tier up by default (or down from the top), so the preview starts with a real change. */
  protected readonly packageId = signal<PackageId>(nextTier(inForce(this.agreement.packages, this.input.view.today)[0]?.packageId));
  protected readonly addOnId = signal<string>(this.input.addOnId ?? (this.input.mode === 'remove-add-on' ? (inForce(this.agreement.addOns, this.input.view.today)[0]?.addOnId ?? '') : 'whatsapp'));
  protected readonly quantity = signal(1);
  protected readonly effectiveFrom = signal(this.input.mode === 'remove-add-on' ? this.agreement.billing.nextBillingDate : this.input.view.today);
  protected readonly priceMode = signal<'catalogue' | 'agreed'>('catalogue');
  protected readonly agreedPrice = signal('');
  protected readonly reason = signal('');
  protected readonly busy = signal(false);

  protected readonly allowQuantity = computed(() => !!this.addOns().find((a) => a.id === this.addOnId())?.allowQuantity);

  private readonly change = computed<AgreementChange>(() => {
    const price = this.priceMode() === 'agreed' ? (this.agreedPrice().trim() === '' ? null : Number(this.agreedPrice())) : undefined;
    const reason = this.reason();
    switch (this.input.mode) {
      case 'package':
        return { type: 'package', packageId: this.packageId(), effectiveFrom: this.effectiveFrom(), monthlyPrice: price, reason };
      case 'add-on':
        return { type: 'add-on', addOnId: this.addOnId(), quantity: this.allowQuantity() ? this.quantity() : 1, effectiveFrom: this.effectiveFrom(), unitPrice: price, reason };
      case 'remove-add-on':
        return { type: 'remove-add-on', addOnId: this.addOnId(), effectiveFrom: this.effectiveFrom(), reason };
    }
  });

  protected readonly preview = toSignal(
    toObservable(this.change).pipe(
      debounceTime(120),
      switchMap((c) => this.data.preview(this.input.view.organisationId, c).pipe(catchError(() => of(undefined)))),
    ),
  );

  /** Everything the API would refuse, except the reason before anyone has typed one. */
  protected readonly problems = computed(() => Object.entries(this.preview()?.errors ?? {}).filter(([k]) => k !== 'reason' || this.reason().trim().length > 0).map(([, m]) => m));
  protected readonly ready = computed(() => !!this.preview() && !this.preview()!.errors);

  protected readonly pkgName = (id: PackageId) => packageById(id).name;
  protected readonly addOnName = (id: string) => this.catalogue()?.addOns.find((a) => a.id === id)?.name ?? id;
  protected readonly date = (d: string) => formatDate(d);
  protected readonly rand = (n: number) => formatRand(n, { cents: false });

  protected priceHint(id: PackageId): string {
    const t = termsOn(this.catalogue()?.packages.find((p) => p.packageId === id)?.terms ?? [], this.effectiveFrom());
    return t?.monthlyPrice == null ? ' · price awaiting configuration' : ` · ${this.rand(t.monthlyPrice)} a month (${PRICE_STATUS_LABELS[t.priceStatus].toLowerCase()})`;
  }

  protected addOnHint(id: string): string {
    const t = termsOn(this.catalogue()?.addOns.find((a) => a.id === id)?.terms ?? [], this.effectiveFrom());
    return t?.price == null ? ' · price awaiting configuration' : ` · ${this.rand(t.price)} ${t.frequency === 'annual' ? 'a year' : 'a month'} (${PRICE_STATUS_LABELS[t.priceStatus].toLowerCase()})`;
  }

  protected catalogueNote(): string {
    return this.input.mode === 'package' ? this.priceHint(this.packageId()) : this.addOnHint(this.addOnId());
  }

  protected policy(p: ChangePreview): string {
    const pending = this.catalogue()?.settings.prorationAwaitingApproval ? ' (policy awaiting business approval)' : '';
    return `${PRORATION_LABELS[p.policy]}${pending}.`;
  }

  protected confirm(): void {
    if (!this.ready() || this.busy()) return;
    const change = this.change();
    const scheduled = this.effectiveFrom() > this.input.view.today;
    this.busy.set(true);
    this.stepUp
      .guard({ action: 'change-subscription', detail: `${this.title} for ${this.input.view.name}` }, () => this.data.change(this.input.view.organisationId, change, this.agreement.version))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.feedback.success(scheduled ? `Scheduled from ${formatDate(this.effectiveFrom())}. Nothing changes for ${this.input.view.name} until then.` : 'Done. The agreement and entitlements are updated.');
          this.ref.close();
        },
        error: (e) => {
          this.busy.set(false);
          this.feedback.error(describeFailure(e, 'The agreement wasn’t changed'));
        },
        complete: () => this.busy.set(false),
      });
  }
}
