import { Observable } from 'rxjs';
import {
  AddOnKind,
  AgreementChange,
  BillingFrequency,
  BillingPreference,
  CatalogueStatus,
  ChangePreview,
  ChargeSummary,
  CommercialAgreement,
  CommercialCatalogue,
  CommercialSettings,
  HumoInvoice,
  InvoiceDocument,
  InvoiceStatus,
  PackageTerms,
  PaymentRecord,
  PriceStatus,
  StorageSummary,
} from '../models/commercial';
import { AddOnId, Feature, PackageId } from '../models/entitlement';

/** A change waiting for its date. */
export interface ScheduledItem {
  lineId: string;
  kind: 'package' | 'add-on' | 'removal';
  label: string;
  from: string;
  /** Per month, from that date. */
  monthlyChange: number | null;
}

export interface CustomerInvoice extends Omit<HumoInvoice, 'status'> {
  status: InvoiceStatus;
  payments: PaymentRecord[];
}

/** A row of Platform › Invoices: every customer's invoices in one list. */
export interface InvoiceListItem extends CustomerInvoice {
  customerName: string;
  accountManager: string;
  billingPreference: BillingPreference;
}

/** One customer's commercial position, as the API returns it to Humo staff with Platform.Revenue.View. */
export interface CustomerCommercialView {
  organisationId: string;
  name: string;
  schemes: number;
  accountManager: { id: string; name: string } | null;
  agreement: CommercialAgreement;
  today: string;
  current: ChargeSummary;
  scheduled: ScheduledItem[];
  storage: StorageSummary;
  invoices: CustomerInvoice[];
}

export interface PackageTermsInput extends Pick<PackageTerms, 'effectiveFrom' | 'monthlyPrice' | 'annualPrice' | 'priceStatus' | 'includedStorageGb' | 'storageStatus' | 'includedSchemes' | 'extraSchemePrice' | 'extraSchemeBlock' | 'annualRenewalFee'> {
  reason: string;
}

export interface AddOnInput {
  /** New add-ons choose their id once; it never changes. */
  id: AddOnId;
  name: string;
  description: string;
  kind: AddOnKind;
  features: Feature[];
  storageGb?: number;
  allowQuantity: boolean;
  status: CatalogueStatus;
  retiresOn?: string;
  /** The terms from `effectiveFrom`: a new version, or the first. */
  effectiveFrom: string;
  price: number | null;
  frequency: BillingFrequency;
  priceStatus: PriceStatus;
  usageAllowance?: { unit: string; included: number };
  reason: string;
}

/**
 * Humo's commercial management (docs/23). Humo staff only.
 *
 *   GET   /platform/commercial/catalogue
 *   PUT   /platform/commercial/packages/{id}/terms      new effective-dated terms (Platform.Packages.Manage, step-up)
 *   PUT   /platform/commercial/add-ons/{id}             create, or new terms (Platform.Packages.Manage, step-up)
 *   PUT   /platform/commercial/settings                 thresholds, proration, tax (Platform.Config.Manage, step-up)
 *   GET   /platform/customers/{id}/commercial           (Platform.Revenue.View)
 *   POST  /platform/customers/{id}/agreement/preview    no change is saved
 *   POST  /platform/customers/{id}/agreement/changes    (Platform.Subscriptions.Manage, own accounts, step-up, D11)
 *   POST  /platform/customers/{id}/agreement/approvals/{approvalId}   approve or decline (Platform.Discounts.Approve, step-up)
 *   GET   /platform/invoices                            every customer's invoices (Platform.Revenue.View)
 *   GET   /platform/invoices/{id}                       one invoice as a document
 *   POST  /platform/customers/{id}/invoices             issue the next invoice (Platform.Billing.Manage)
 *   POST  /platform/invoices/{id}/checkout              a provider checkout; returns the redirect
 *   POST  /payments/notifications/{provider}            the provider's verified notification (server to server, not in this port)
 *   POST  /platform/payments/{id}/reconcile             manual EFT matched to Humo's bank statement (Platform.Billing.Manage, step-up)
 */
export abstract class CommercialDataSource {
  abstract catalogue(): Observable<CommercialCatalogue>;
  abstract savePackageTerms(packageId: PackageId, input: PackageTermsInput): Observable<void>;
  abstract saveAddOn(input: AddOnInput, isNew: boolean): Observable<void>;
  abstract saveSettings(settings: Omit<CommercialSettings, 'version'>, reason: string, expectedVersion?: number): Observable<void>;

  abstract customer(organisationId: string): Observable<CustomerCommercialView | undefined>;
  abstract preview(organisationId: string, change: AgreementChange): Observable<ChangePreview>;
  /** A change that needs a second approver (a discount above the threshold) waits on the agreement instead of applying. */
  abstract change(organisationId: string, change: AgreementChange, expectedVersion?: number): Observable<void>;
  /** Platform.Discounts.Approve, step-up; never the person who asked. Approving re-checks and applies the change. */
  abstract decideApproval(organisationId: string, approvalId: string, decision: 'approve' | 'decline', reason: string): Observable<void>;

  /** Every customer's invoices, newest first (Platform.Revenue.View). */
  abstract invoices(): Observable<InvoiceListItem[]>;
  abstract invoice(invoiceId: string): Observable<InvoiceDocument | undefined>;
  abstract issueInvoice(organisationId: string): Observable<string>;
  abstract startCheckout(invoiceId: string): Observable<CheckoutSession>;
  /** DEMO ONLY: stands in for the provider's server-to-server notification. Refused outside the simulation. */
  abstract simulateProviderNotification(paymentId: string, outcome: 'paid' | 'failed', eventId: string): Observable<void>;
  abstract recordEftProof(invoiceId: string, note: string): Observable<void>;
  abstract reconcileEft(paymentId: string, bankReference: string): Observable<void>;
}

// ---------------------------------------------------------------- Payment provider boundary

export interface CheckoutRequest {
  invoiceId: string;
  /** The invoice reference; the provider shows it and sends it back. */
  reference: string;
  amount: number;
  currency: 'ZAR';
  method: BillingPreference;
  customerEmail: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  paymentId: string;
  providerReference: string;
  /** Where the customer completes payment. Null in the simulation: nobody is sent anywhere. */
  redirectUrl: string | null;
  simulated: boolean;
  /** Payfast: the browser posts these fields to `action` (so personal details stay out of the URL). */
  form?: { action: string; fields: { key: string; value: string }[] };
}

/**
 * The one place a payment provider plugs in (Payfast, Peach Payments or
 * another). Subscriptions and invoices never know which provider is used.
 * Card details go straight to the provider: Humo never sees or stores a card
 * number or CVV. Confirmation never comes from the browser: only the backend's
 * verified provider notification marks a payment verified (docs/23 §6).
 */
export abstract class PaymentGateway {
  abstract readonly providerName: string;
  abstract readonly simulated: boolean;
  abstract createCheckout(request: CheckoutRequest): Observable<{ providerReference: string; redirectUrl: string | null }>;
}
