import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { CheckoutSession, CommercialDataSource, InvoiceDocument, PlanDataSource, describeFailure } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { SessionService } from '../../core/session/session.service';
import { EmptyState } from '../../ui/states/empty-state';
import { Skeleton } from '../../ui/states/skeleton';
import { InvoiceDocumentView } from './invoice-document';

/**
 * One Humo invoice, printable. Route data `audience` says who's looking:
 *   'humo'     Platform › Invoices › {id}           (Platform.Revenue.View)
 *   'customer' Settings › Billing & invoices › {id} (their own invoices only)
 */
@Component({
  selector: 'app-invoice-view-page',
  imports: [InvoiceDocumentView, EmptyState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="actions no-print">
      <a class="btn btn-ghost btn-sm" [routerLink]="back()"><ion-icon name="chevron-back-outline" aria-hidden="true" /> {{ humo ? 'All invoices' : 'Billing & invoices' }}</a>
      @if (doc(); as d) {
        @if (humo) {
          <a class="btn btn-ghost btn-sm" [routerLink]="['/platform/customers', d.billTo.organisationId]" [queryParams]="{ view: 'commercial' }">{{ d.billTo.name }}’s billing</a>
        }
        @if (!humo && d.balance > 0 && (d.invoice.status === 'issued' || d.invoice.status === 'overdue') && session.can('Subscription.Request') && !session.readOnly()) {
          <button type="button" class="btn btn-primary btn-sm" [disabled]="paying()" (click)="pay(d)"><ion-icon name="card-outline" aria-hidden="true" /> Pay now</button>
        }
        <button type="button" class="btn btn-secondary btn-sm" (click)="print()"><ion-icon name="print-outline" aria-hidden="true" /> Print or save PDF</button>
      }
    </div>
    @if (returned() === 'returned') {
      <p class="note no-print" role="status">Thank you. Your payment shows here once Payfast confirms it, usually within a few minutes.</p>
    } @else if (returned() === 'cancelled') {
      <p class="note no-print" role="status">The payment was cancelled. Nothing was charged; you can pay now or by EFT with the invoice reference.</p>
    }
    @if (doc() === undefined) {
      <ui-skeleton variant="tiles" [count]="2" />
    } @else if (doc() === null) {
      <div class="surface"><ui-empty-state illustration="not-found" title="We couldn’t find that invoice" /></div>
    } @else {
      <app-invoice-document [doc]="doc()!" />
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--s-2); max-width: 820px; width: 100%; margin: 0 auto; }
    .actions .btn-primary { margin-left: auto; }
    .note { max-width: 820px; width: 100%; margin: 0 auto; padding: var(--s-2) var(--s-3); border-radius: var(--r); background: var(--c-info-soft, var(--c-neutral-soft)); font-size: var(--fs-sm); }
  `,
})
export class InvoiceViewPage {
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionService);
  private readonly feedback = inject(FeedbackService);
  protected readonly paying = signal(false);
  /** Back from Payfast: `?payment=returned` or `cancelled`. Only Payfast's own notification marks the invoice paid. */
  protected readonly returned = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('payment'))), { initialValue: null });
  private readonly commercial = inject(CommercialDataSource);
  private readonly plan = inject(PlanDataSource);
  protected readonly humo = this.route.snapshot.data['audience'] === 'humo';

  /** undefined while loading, null when it isn't there (or isn't theirs). */
  protected readonly doc = toSignal(
    this.route.paramMap.pipe(
      map((p) => p.get('invoiceId')!),
      switchMap((id): Observable<InvoiceDocument | undefined> => (this.humo ? this.commercial.invoice(id) : this.plan.invoice(this.session.organisation()?.id ?? '', id))),
      map((d) => d ?? null),
      catchError(() => of(null)),
    ),
  );

  protected readonly back = computed(() => (this.humo ? '/platform/invoices' : '/settings/billing'));

  /** Pay now: the API signs a Payfast checkout; the browser posts it to Payfast. */
  protected pay(d: InvoiceDocument): void {
    this.paying.set(true);
    this.plan.payInvoice(d.billTo.organisationId, d.invoice.id).subscribe({
      next: (s) => {
        if (!goToCheckout(s)) {
          this.paying.set(false);
          this.feedback.success('Checkout started (simulated: nothing was charged). The invoice stays unpaid until the provider confirms a payment.');
        }
      },
      error: (e) => {
        this.paying.set(false);
        this.feedback.error(describeFailure(e, 'The payment didn’t start'));
      },
    });
  }

  protected print(): void {
    window.print();
  }
}

/** Sends the browser to the provider: a form POST (Payfast) or a redirect. False when there's nowhere to go (the simulation). */
export function goToCheckout(s: CheckoutSession): boolean {
  if (s.form) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = s.form.action;
    for (const f of s.form.fields) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = f.key;
      input.value = f.value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
    return true;
  }
  if (s.redirectUrl) {
    window.location.assign(s.redirectUrl);
    return true;
  }
  return false;
}
