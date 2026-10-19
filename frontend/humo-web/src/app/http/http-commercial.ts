import { Injectable } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import {
  AddOnId,
  AddOnInput,
  AgreementChange,
  ApiError,
  BusinessOverview,
  Catalogue,
  CatalogueDataSource,
  ChangePreview,
  CheckoutSession,
  CommercialCatalogue,
  CommercialDataSource,
  CommercialSettings,
  CustomerCommercialView,
  CustomerPlan,
  Feature,
  InvoiceDocument,
  InvoiceListItem,
  ListQuery,
  NudgeDataSource,
  PackageId,
  PackageTermsInput,
  Page,
  PlanDataSource,
  PlatformCustomer,
  PlatformDataSource,
  ServedNudge,
  SubscriptionChange,
  UpgradeRequest,
} from '../domain';
import { HttpPort, toApiErrorFromHttp } from './http-port';

const orUndefined = <T>(source: Observable<T>): Observable<T | undefined> =>
  source.pipe(catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))));


/** The published catalogue (GET /catalogue): features, packages and the add-ons on sale. */
@Injectable()
export class HttpCatalogueDataSource extends HttpPort implements CatalogueDataSource {
  catalogue(): Observable<Catalogue> {
    return this.live<Catalogue>('/catalogue', ['subscriptions']);
  }
}

/**
 * Humo's customers over HTTP (docs/04): the list, Customer 360 and Manage features.
 * Health uses only what the API measures today; the rest is marked "Not measured yet".
 */
@Injectable()
export class HttpPlatformDataSource extends HttpPort implements PlatformDataSource {
  customers(query?: ListQuery): Observable<Page<PlatformCustomer>> {
    const params: Record<string, string> = {};
    if (query?.page) params['page'] = String(query.page);
    if (query?.pageSize) params['pageSize'] = String(query.pageSize);
    return this.live<Page<PlatformCustomer>>('/platform/customers', ['subscriptions', 'organisations', 'access'], params);
  }

  customer(organisationId: string): Observable<PlatformCustomer | undefined> {
    return orUndefined(this.live<PlatformCustomer>(`/platform/customers/${organisationId}`, ['subscriptions', 'organisations', 'access']));
  }

  overview(): Observable<BusinessOverview> {
    return this.live<BusinessOverview>('/platform/overview', ['subscriptions', 'organisations']);
  }

  /** Platform.Subscriptions.Manage with step-up; Account Managers only for their own customers (D11). */
  changeSubscription(organisationId: string, change: SubscriptionChange, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/platform/customers/${organisationId}/subscription`, { change, expectedVersion }, ['subscriptions', 'session']);
  }

  updateRequest(requestId: string, status: UpgradeRequest['status']): Observable<void> {
    return this.command('POST', `/platform/upgrade-requests/${requestId}/status`, { status }, ['subscriptions']);
  }
}

/** The customer's own plan (Agency Administrators): they can ask Humo, not enable. */
@Injectable()
export class HttpPlanDataSource extends HttpPort implements PlanDataSource {
  mine(organisationId: string): Observable<CustomerPlan | undefined> {
    return orUndefined(this.live<CustomerPlan>(`/organisations/${organisationId}/plan`, ['subscriptions', 'session']));
  }

  /** Their own Humo invoices (Agency Administrators): the API checks the organisation. */
  invoices(organisationId: string): Observable<InvoiceDocument[]> {
    return this.live<InvoiceDocument[]>(`/organisations/${organisationId}/invoices`, ['subscriptions']);
  }

  invoice(organisationId: string, invoiceId: string): Observable<InvoiceDocument | undefined> {
    return orUndefined(this.live<InvoiceDocument>(`/organisations/${organisationId}/invoices/${invoiceId}`, ['subscriptions']));
  }

  payInvoice(organisationId: string, invoiceId: string): Observable<CheckoutSession> {
    return this.command<CheckoutSession>('POST', `/organisations/${organisationId}/invoices/${invoiceId}/checkout`, null, ['subscriptions']);
  }

  requestUpgrade(input: { organisationId: string; addOn?: AddOnId; package?: PackageId; feature?: Feature; note?: string; source: UpgradeRequest['source'] }): Observable<void> {
    const { organisationId, ...body } = input;
    return this.command('POST', `/organisations/${organisationId}/upgrade-requests`, body, ['subscriptions', 'notifications']);
  }
}

/**
 * Commercial management over HTTP (docs/23): the priced catalogue, settings and each customer's
 * agreement with its live preview, invoices and manual EFT. Online payment waits for the provider (R-14).
 */
@Injectable()
export class HttpCommercialDataSource extends HttpPort implements CommercialDataSource {
  catalogue(): Observable<CommercialCatalogue> {
    return this.live<CommercialCatalogue>('/platform/commercial/catalogue', ['subscriptions']);
  }

  savePackageTerms(packageId: PackageId, input: PackageTermsInput): Observable<void> {
    return this.command('PUT', `/platform/commercial/packages/${packageId}/terms`, input, ['subscriptions']);
  }

  saveAddOn(input: AddOnInput, isNew: boolean): Observable<void> {
    return this.command('PUT', `/platform/commercial/add-ons/${encodeURIComponent(input.id)}`, { ...input, isNew }, ['subscriptions']);
  }

  saveSettings(settings: Omit<CommercialSettings, 'version'>, reason: string, expectedVersion?: number): Observable<void> {
    return this.command('PUT', '/platform/commercial/settings', { settings, reason, expectedVersion }, ['subscriptions']);
  }

  customer(organisationId: string): Observable<CustomerCommercialView | undefined> {
    return orUndefined(this.live<CustomerCommercialView>(`/platform/customers/${organisationId}/commercial`, ['subscriptions', 'organisations', 'access']));
  }

  /** Nothing is saved: the API computes before and after on the date the change takes effect. */
  preview(organisationId: string, change: AgreementChange): Observable<ChangePreview> {
    return this.http
      .post<ChangePreview>(`${this.base}/platform/customers/${organisationId}/agreement/preview`, { change }, { withCredentials: true })
      .pipe(catchError((e) => throwError(() => toApiErrorFromHttp(e))));
  }

  change(organisationId: string, change: AgreementChange, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/platform/customers/${organisationId}/agreement/changes`, { change, expectedVersion }, ['subscriptions', 'session', 'notifications']);
  }

  decideApproval(organisationId: string, approvalId: string, decision: 'approve' | 'decline', reason: string): Observable<void> {
    return this.command('POST', `/platform/customers/${organisationId}/agreement/approvals/${approvalId}`, { decision, reason }, ['subscriptions', 'session', 'notifications']);
  }

  invoices(): Observable<InvoiceListItem[]> {
    return this.live<InvoiceListItem[]>('/platform/invoices', ['subscriptions', 'organisations']);
  }

  invoice(invoiceId: string): Observable<InvoiceDocument | undefined> {
    return orUndefined(this.live<InvoiceDocument>(`/platform/invoices/${invoiceId}`, ['subscriptions']));
  }

  /** Platform.Billing.Manage with step-up: the next period, from the agreement as it stands. */
  issueInvoice(organisationId: string): Observable<string> {
    return this.createId(`/platform/customers/${organisationId}/invoices`, null, ['subscriptions']);
  }

  /** A Payfast checkout started by Humo Finance (Platform.Billing.Manage). */
  startCheckout(invoiceId: string): Observable<CheckoutSession> {
    return this.command<CheckoutSession>('POST', `/platform/invoices/${invoiceId}/checkout`, null, ['subscriptions']);
  }

  /** Never on the API: only the simulation stands in for the provider. */
  simulateProviderNotification(): Observable<void> {
    return throwError(() => new ApiError('server', 'Provider notifications come from the provider, never from the browser'));
  }

  /** Recorded, not paid: the invoice stays unpaid until the EFT is reconciled. */
  recordEftProof(invoiceId: string, note: string): Observable<void> {
    return this.command('POST', `/platform/invoices/${invoiceId}/eft-proof`, { note }, ['subscriptions']);
  }

  /** Platform.Billing.Manage with step-up: matched to a line on Humo's bank statement. */
  reconcileEft(paymentId: string, bankReference: string): Observable<void> {
    return this.command('POST', `/platform/payments/${paymentId}/reconcile`, { bankReference }, ['subscriptions']);
  }
}

/** Smart nudges come from opportunities, which need the usage pipeline (docs/04 §5): none are served yet. */
@Injectable()
export class HttpNudgeDataSource extends HttpPort implements NudgeDataSource {
  next(): Observable<ServedNudge | null> {
    return of(null);
  }

  record(): Observable<void> {
    return of(undefined);
  }
}
