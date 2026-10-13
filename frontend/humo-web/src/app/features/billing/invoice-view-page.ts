import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { CommercialDataSource, InvoiceDocument, PlanDataSource } from '../../domain';
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
        <button type="button" class="btn btn-primary btn-sm" (click)="print()"><ion-icon name="print-outline" aria-hidden="true" /> Print or save PDF</button>
      }
    </div>
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
  `,
})
export class InvoiceViewPage {
  private readonly route = inject(ActivatedRoute);
  private readonly session = inject(SessionService);
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

  protected print(): void {
    window.print();
  }
}
