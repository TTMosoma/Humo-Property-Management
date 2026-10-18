import { Injectable, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, map, of, switchMap, throwError } from 'rxjs';
import {
  ADJUSTMENT_LABELS,
  AddOnInput,
  AgreementChange,
  BILLING_PREFERENCE_LABELS,
  ChangePreview,
  ChargeContext,
  CheckoutSession,
  CommercialAgreement,
  CommercialCatalogue,
  CommercialDataSource,
  CommercialSettings,
  CustomerCommercialView,
  FEATURE_META,
  InvoiceDocument,
  InvoiceListItem,
  FieldErrors,
  PackageId,
  PackageTermsInput,
  PaymentGateway,
  PolicyError,
  ScheduledItem,
  applyAgreementChange,
  buildInvoice,
  chargesOn,
  checkAgreementChange,
  inForce,
  invoiceStatus,
  isoDay,
  nextCycleOn,
  packageById,
  previewAgreementChange,
  activeAssignments,
} from '../../domain';
import { formatRand } from '../../ui/format/money';
import { AccessStore } from '../db/access-store';
import { CommercialStore } from '../db/commercial-store';
import { PlatformStore } from '../db/platform-store';
import { StorageMeter } from '../db/storage-meter';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

const today = () => isoDay(new Date());
const rand = (n: number | null | undefined) => (n == null ? 'a price to be agreed' : formatRand(n, { cents: false }));
const D11 = 'Within the Account Manager’s authority for their own customer (D11)';

const nextYear = (d: string) => `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;

/** The `nextBillingDate` one cycle later. */
const advance = (a: CommercialAgreement) => nextCycleOn(a.billing.nextBillingDate, isoDay(new Date(new Date(`${a.billing.nextBillingDate}T00:00:00`).getTime() + 86_400_000)), a.cycle);

/**
 * The simulated API for Humo's commercial management (docs/23). Every command
 * goes through the MockGateway pipeline: permission, version, validation,
 * step-up, then the change and its audit event.
 */
@Injectable()
export class InMemoryCommercialDataSource extends CommercialDataSource {
  private readonly store = inject(CommercialStore);
  private readonly platform = inject(PlatformStore);
  private readonly storage = inject(StorageMeter);
  private readonly access = inject(AccessStore);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly payments = inject(PaymentGateway);
  private readonly respond = mockResponder();
  private readonly catalogue$ = toObservable(this.store.catalogue);
  private readonly records$ = toObservable(
    computed(() => ({ agreements: this.store.agreements(), invoices: this.store.invoices(), payments: this.store.payments(), customers: this.platform.customers(), catalogue: this.store.catalogue() })),
  );

  catalogue(): Observable<CommercialCatalogue> {
    return this.catalogue$.pipe(switchMap((c) => this.respond(c)));
  }

  // ---------------------------------------------------------------- Catalogue

  savePackageTerms(packageId: PackageId, input: PackageTermsInput): Observable<void> {
    const name = packageById(packageId).name;
    return this.gateway
      .command(
        {
          action: `Set ${name} terms from ${input.effectiveFrom}: ${rand(input.monthlyPrice)} a month (${input.priceStatus}), ${input.includedStorageGb ?? 'negotiated'} GB — ${input.reason}`,
          resource: 'Package',
          resourceId: packageId,
          category: 'security',
          permission: 'Platform.Packages.Manage',
          validate: () => this.checkPackageTerms(input),
        },
        () => this.store.savePackageTerms(packageId, input, this.auth.actor().name),
      )
      .pipe(map(() => undefined));
  }

  saveAddOn(input: AddOnInput, isNew: boolean): Observable<void> {
    return this.gateway
      .command(
        {
          action: `${isNew ? 'Created the add-on' : 'Updated the add-on'} ${input.name}: ${rand(input.price)} ${input.frequency} from ${input.effectiveFrom} (${input.priceStatus}) — ${input.reason}`,
          resource: 'Add-on',
          resourceId: input.id,
          category: 'security',
          permission: 'Platform.Packages.Manage',
          validate: () => this.checkAddOn(input, isNew),
        },
        () => this.store.saveAddOn(input, this.auth.actor().name),
      )
      .pipe(map(() => undefined));
  }

  saveSettings(settings: Omit<CommercialSettings, 'version'>, reason: string, expectedVersion?: number): Observable<void> {
    const current = this.store.catalogue().settings;
    return this.gateway
      .command(
        {
          action: `Changed commercial settings (warnings at ${settings.storageThresholds.join('% and ')}%, ${settings.proration} proration, VAT ${settings.tax.vatRegistered ? `registered at ${settings.tax.ratePercent}%` : 'not charged'}) — ${reason}`,
          resource: 'Commercial settings',
          category: 'security',
          permission: 'Platform.Config.Manage',
          version: { expected: expectedVersion, current: current.version },
          validate: (): FieldErrors | null => {
            const e: FieldErrors = {};
            const [warn, crit] = settings.storageThresholds;
            if (!(warn > 0 && warn < crit && crit < 100)) e['storageThresholds'] = 'The first warning must come before the second, both below 100%.';
            if (settings.tax.vatRegistered && !settings.tax.vatNumber?.trim()) e['vatNumber'] = 'A VAT-registered Humo needs its VAT number on invoices.';
            if (!(settings.tax.ratePercent >= 0 && settings.tax.ratePercent <= 100)) e['ratePercent'] = 'A percentage between 0 and 100.';
            if (!this.isAccountManager(settings.designatedAccountManagerId)) e['designatedAccountManagerId'] = 'Choose an active Humo Account Manager.';
            if (!(settings.paymentTermsDays >= 0 && settings.paymentTermsDays <= 60)) e['paymentTermsDays'] = 'Between 0 and 60 days.';
            if (reason.trim().length < 8) e['reason'] = 'Say why, in a few words. It goes in the audit log.';
            return Object.keys(e).length ? e : null;
          },
        },
        () => this.store.catalogue.update((c) => ({ ...c, settings: { ...settings, version: current.version + 1 } })),
      )
      .pipe(map(() => undefined));
  }

  // ---------------------------------------------------------------- A customer's agreement

  customer(organisationId: string): Observable<CustomerCommercialView | undefined> {
    // Prices and contract values are for Humo staff with Platform.Revenue.View only.
    if (!this.auth.can('Platform.Revenue.View')) return throwError(() => new PolicyError('forbidden', 'Not permitted to see commercial terms'));
    return this.records$.pipe(switchMap(() => this.respond(this.view(organisationId))));
  }

  preview(organisationId: string, change: AgreementChange): Observable<ChangePreview> {
    const a = this.store.agreement(organisationId);
    if (!a) return throwError(() => new PolicyError('forbidden', 'No such customer'));
    return of(this.previewOf(a, change));
  }

  change(organisationId: string, change: AgreementChange, expectedVersion?: number): Observable<void> {
    const a = this.store.agreement(organisationId);
    const customer = this.platform.customers().find((c) => c.organisationId === organisationId);
    const describe = a ? this.describe(change, a) : 'Changed the agreement';
    return this.gateway
      .command(
        {
          action: `${describe} for ${customer?.name ?? organisationId} — ${change.reason}`,
          resource: 'Agreement',
          resourceId: organisationId,
          category: 'security',
          permission: 'Platform.Subscriptions.Manage',
          version: { expected: expectedVersion, current: a?.version },
          validate: (): FieldErrors | null => (!a ? { organisationId: 'No such customer.' } : checkAgreementChange(a, change, this.store.catalogue(), today())),
        },
        () => {
          this.ownAccountOnly(customer?.accountManagerId);
          const actor = { id: this.auth.actor().id, name: this.auth.actor().name, approval: this.approval() };
          this.store.replaceAgreement(applyAgreementChange(a!, change, this.store.catalogue(), actor, new Date(), describe));
        },
      )
      .pipe(map(() => undefined));
  }

  // ---------------------------------------------------------------- Invoices and payments

  invoices(): Observable<InvoiceListItem[]> {
    if (!this.auth.can('Platform.Revenue.View')) return throwError(() => new PolicyError('forbidden', 'Not permitted to see invoices'));
    return this.records$.pipe(
      switchMap(({ invoices, payments, customers, agreements }) => {
        const t = today();
        const byOrg = new Map(customers.map((c) => [c.organisationId, c]));
        const prefs = new Map(agreements.map((a) => [a.organisationId, a.billing.preference]));
        const rows = invoices
          .map<InvoiceListItem>((i) => ({
            ...i,
            status: invoiceStatus(i, t),
            payments: payments.filter((p) => p.invoiceId === i.id),
            customerName: byOrg.get(i.organisationId)?.name ?? i.organisationId,
            accountManager: byOrg.get(i.organisationId)?.accountManager ?? '',
            billingPreference: prefs.get(i.organisationId) ?? 'manual-eft',
          }))
          .sort((x, y) => y.issuedOn.localeCompare(x.issuedOn) || x.customerName.localeCompare(y.customerName));
        return this.respond(rows);
      }),
    );
  }

  invoice(invoiceId: string): Observable<InvoiceDocument | undefined> {
    if (!this.auth.can('Platform.Revenue.View')) return throwError(() => new PolicyError('forbidden', 'Not permitted to see invoices'));
    return this.records$.pipe(switchMap(() => this.respond(this.store.invoiceDocument(invoiceId))));
  }

  issueInvoice(organisationId: string): Observable<string> {
    const a = this.store.agreement(organisationId);
    const period = a?.billing.nextBillingDate ?? '';
    const reference = `HPM-${organisationId.toUpperCase()}-${period.slice(0, 7).replace('-', '')}`;
    return this.gateway.command(
      {
        action: `Issued invoice ${reference} (simulated)`,
        resource: 'Invoice',
        resourceId: organisationId,
        permission: 'Platform.Billing.Manage',
        validate: (): FieldErrors | null =>
          !a ? { organisationId: 'No such customer.' } : this.store.invoices().some((i) => i.reference === reference) ? { period: 'That period is already invoiced.' } : null,
      },
      () => {
        const id = this.store.nextId('inv');
        const inv = buildInvoice(a!, period, this.ctx(organisationId), { id, reference, issuedOn: today(), simulated: true });
        this.store.addInvoice(inv);
        const used = new Set(inv.lines.filter((l) => l.kind === 'credit' || l.kind === 'once-off-fee').map((l) => l.description));
        this.store.replaceAgreement({
          ...a!,
          version: a!.version + 1,
          adjustments: a!.adjustments.map((x) => (x.kind !== 'discount' && !x.invoicedOn && used.has(x.label) ? { ...x, invoicedOn: today() } : x)),
          billing: { ...a!.billing, nextBillingDate: advance(a!) },
          // A renewal fee charged on this invoice moves the renewal on a year.
          renewal: inv.lines.some((l) => l.kind === 'renewal-fee') ? { ...a!.renewal, on: nextYear(a!.renewal.on) } : a!.renewal,
        });
        return id;
      },
    );
  }

  startCheckout(invoiceId: string): Observable<CheckoutSession> {
    const inv = this.store.invoices().find((i) => i.id === invoiceId);
    const a = inv && this.store.agreement(inv.organisationId);
    return this.gateway
      .command(
        {
          action: `Started a ${this.payments.simulated ? 'simulated ' : ''}checkout for invoice ${inv?.reference}`,
          resource: 'Payment',
          resourceId: invoiceId,
          permission: 'Platform.Billing.Manage',
          stepUp: false,
          validate: (): FieldErrors | null =>
            !inv || !a
              ? { invoiceId: 'No such invoice.' }
              : inv.status !== 'issued'
                ? { invoiceId: 'This invoice is already settled.' }
                : a.billing.preference === 'manual-eft'
                  ? { invoiceId: 'This customer pays by manual EFT: record their proof of payment instead.' }
                  : null,
        },
        () => inv!,
      )
      .pipe(
        switchMap(() =>
          this.payments.createCheckout({
            invoiceId,
            reference: inv!.reference,
            amount: inv!.total,
            currency: 'ZAR',
            method: a!.billing.preference,
            customerEmail: a!.billing.billingEmail,
            returnUrl: `/platform/customers/${inv!.organisationId}?view=commercial`,
            cancelUrl: `/platform/customers/${inv!.organisationId}?view=commercial`,
          }),
        ),
        map((session) => {
          const paymentId = this.store.nextId('pay');
          this.store.addPayment({
            id: paymentId,
            invoiceId,
            organisationId: inv!.organisationId,
            method: a!.billing.preference,
            status: 'initiated',
            amount: inv!.total,
            provider: this.payments.providerName,
            providerReference: session.providerReference,
            createdAt: new Date().toISOString(),
            simulated: this.payments.simulated,
            note: 'Waiting for the provider’s verified notification. Starting a checkout is not a payment.',
          });
          return { paymentId, providerReference: session.providerReference, redirectUrl: session.redirectUrl, simulated: this.payments.simulated };
        }),
      );
  }

  simulateProviderNotification(paymentId: string, outcome: 'paid' | 'failed', eventId: string): Observable<void> {
    const p = this.store.payments().find((x) => x.id === paymentId);
    return this.gateway
      .command(
        {
          action: `Simulated a provider notification (${outcome}) for payment ${paymentId}`,
          resource: 'Payment',
          resourceId: paymentId,
          permission: 'Platform.Billing.Manage',
          stepUp: false,
          validate: (): FieldErrors | null =>
            !this.payments.simulated ? { paymentId: 'Only the payment provider can confirm a payment.' } : !p ? { paymentId: 'No such payment.' } : p.status !== 'initiated' && p.status !== 'verified' ? { paymentId: 'This payment isn’t waiting for the provider.' } : null,
        },
        () => {
          // A repeat of a notification already processed changes nothing (providers retry).
          if (!this.store.firstNotification(eventId)) return;
          if (p!.status !== 'initiated') return;
          const at = new Date().toISOString();
          this.store.updatePayment(paymentId, (x) =>
            outcome === 'paid'
              ? { ...x, status: 'verified', verifiedAt: at, verifiedBy: `${x.provider} notification ${eventId}`, verification: 'provider-notification', note: 'Simulated provider confirmation: no money moved.' }
              : { ...x, status: 'failed', note: 'The provider reported the payment failed (simulated).' },
          );
          this.store.settle(p!.invoiceId);
        },
      )
      .pipe(map(() => undefined));
  }

  recordEftProof(invoiceId: string, note: string): Observable<void> {
    const inv = this.store.invoices().find((i) => i.id === invoiceId);
    const customer = this.platform.customers().find((c) => c.organisationId === inv?.organisationId);
    return this.gateway
      .command(
        {
          action: `Recorded the customer’s proof of EFT payment for ${inv?.reference} (not yet verified)`,
          resource: 'Payment',
          resourceId: invoiceId,
          permission: 'Platform.Subscriptions.Manage',
          stepUp: false,
          validate: (): FieldErrors | null => (!inv ? { invoiceId: 'No such invoice.' } : inv.status !== 'issued' ? { invoiceId: 'This invoice is already settled.' } : note.trim().length < 5 ? { note: 'What did the customer send?' } : null),
        },
        () => {
          this.ownAccountOnly(customer?.accountManagerId);
          this.store.addPayment({
            id: this.store.nextId('pay'),
            invoiceId,
            organisationId: inv!.organisationId,
            method: 'manual-eft',
            status: 'pending-verification',
            amount: inv!.total,
            provider: 'Manual EFT',
            createdAt: new Date().toISOString(),
            simulated: true,
            note: note.trim(),
          });
        },
      )
      .pipe(map(() => undefined));
  }

  reconcileEft(paymentId: string, bankReference: string): Observable<void> {
    const p = this.store.payments().find((x) => x.id === paymentId);
    return this.gateway
      .command(
        {
          action: `Verified an EFT payment against Humo’s bank statement (${bankReference.trim()}) for payment ${paymentId}`,
          resource: 'Payment',
          resourceId: paymentId,
          amount: p?.amount,
          permission: 'Platform.Billing.Manage',
          validate: (): FieldErrors | null =>
            !p ? { paymentId: 'No such payment.' } : p.status !== 'pending-verification' ? { paymentId: 'Only a payment awaiting verification can be reconciled.' } : bankReference.trim().length < 4 ? { bankReference: 'The bank statement line’s reference.' } : null,
        },
        () => {
          const at = new Date().toISOString();
          this.store.updatePayment(paymentId, (x) => ({
            ...x,
            status: 'verified',
            verifiedAt: at,
            verifiedBy: this.auth.actor().name,
            verification: 'bank-reconciliation',
            providerReference: bankReference.trim(),
            note: `${x.note ? `${x.note} ` : ''}Matched to bank statement line ${bankReference.trim()} (simulated statement).`,
          }));
          this.store.settle(p!.invoiceId);
        },
      )
      .pipe(map(() => undefined));
  }

  // ---------------------------------------------------------------- Helpers

  private ctx(organisationId: string): ChargeContext {
    const schemes = this.platform.customers().find((c) => c.organisationId === organisationId)?.snapshot.schemes ?? 0;
    return { catalogue: this.store.catalogue(), schemes, packageName: (id) => packageById(id).name };
  }

  private previewOf(a: CommercialAgreement, change: AgreementChange): ChangePreview {
    const ctx = this.ctx(a.organisationId);
    return previewAgreementChange(a, change, ctx, today());
  }

  private view(organisationId: string): CustomerCommercialView | undefined {
    const a = this.store.agreement(organisationId);
    const customer = this.platform.customers().find((c) => c.organisationId === organisationId);
    const storage = this.storage.summary(organisationId);
    if (!a || !customer || !storage) return undefined;
    const ctx = this.ctx(organisationId);
    const t = today();
    const dayBefore = (d: string) => isoDay(new Date(new Date(`${d}T00:00:00`).getTime() - 86_400_000));
    const change = (d: string) => chargesOn(a, d, ctx).recurringMonthly - chargesOn(a, dayBefore(d), ctx).recurringMonthly;
    const name = (id: string) => this.store.catalogue().addOns.find((x) => x.id === id)?.name ?? id;
    const scheduled: ScheduledItem[] = [
      ...a.packages.filter((l) => l.from > t).map<ScheduledItem>((l) => ({ lineId: l.id, kind: 'package', label: `Move to ${packageById(l.packageId).name} at ${rand(l.monthlyPrice)} a month`, from: l.from, monthlyChange: change(l.from) })),
      ...a.addOns.filter((l) => l.from > t).map<ScheduledItem>((l) => ({ lineId: l.id, kind: 'add-on', label: `Add ${name(l.addOnId)}${l.quantity > 1 ? ` × ${l.quantity}` : ''} at ${rand(l.unitPrice)} ${l.frequency === 'annual' ? 'a year' : 'a month'}`, from: l.from, monthlyChange: change(l.from) })),
      ...inForce(a.addOns, t).filter((l) => l.until).map<ScheduledItem>((l) => ({ lineId: l.id, kind: 'removal', label: `Remove ${name(l.addOnId)}`, from: l.until!, monthlyChange: change(l.until!) })),
    ].sort((x, y) => x.from.localeCompare(y.from));
    const payments = this.store.payments();
    return {
      organisationId,
      name: customer.name,
      schemes: customer.snapshot.schemes,
      accountManager: customer.accountManager === 'Unassigned' ? null : { id: customer.accountManagerId, name: customer.accountManager },
      agreement: a,
      today: t,
      current: chargesOn(a, t, ctx),
      scheduled,
      storage,
      invoices: this.store
        .invoices()
        .filter((i) => i.organisationId === organisationId)
        .sort((x, y) => y.periodStart.localeCompare(x.periodStart))
        .map((i) => ({ ...i, status: invoiceStatus(i, t), payments: payments.filter((p) => p.invoiceId === i.id) })),
    };
  }

  private describe(c: AgreementChange, a: CommercialAgreement): string {
    const cat = this.store.catalogue();
    const name = (id: string) => cat.addOns.find((x) => x.id === id)?.name ?? id;
    const when = (d: string) => (d > today() ? ` from ${d}` : '');
    switch (c.type) {
      case 'package': {
        const p = this.previewOf(a, c).after.recurring.find((l) => l.kind === 'package');
        return `Changed package to ${packageById(c.packageId).name} at ${rand(p?.amount)} a month${when(c.effectiveFrom)}`;
      }
      case 'add-on': {
        const price = c.unitPrice === undefined ? this.previewOf(a, c).after.recurring.filter((l) => l.kind === 'add-on').at(-1)?.unitPrice : c.unitPrice;
        return `${c.effectiveFrom > today() ? 'Scheduled' : 'Added'} the ${name(c.addOnId)} add-on${c.quantity > 1 ? ` × ${c.quantity}` : ''} at ${rand(price)} a month${when(c.effectiveFrom)}${c.unitPrice !== undefined ? ' (agreed price)' : ''}`;
      }
      case 'remove-add-on':
        return `Removed the ${name(c.addOnId)} add-on${when(c.effectiveFrom)}`;
      case 'cancel-scheduled':
        return 'Cancelled a scheduled change';
      case 'adjustment':
        return `Added a ${ADJUSTMENT_LABELS[c.kind].toLowerCase()} “${c.label}” of ${c.percent != null ? `${c.percent}%` : rand(c.amount)}`;
      case 'billing-preference':
        return `Set the billing preference to ${BILLING_PREFERENCE_LABELS[c.preference]} (invoices to ${c.billingEmail})`;
      case 'storage-exception':
        return `Granted ${c.extraGb} GB of extra storage until ${c.until} (exception)`;
      case 'renewal':
        return c.fee ? `Set the annual renewal fee to ${rand(c.fee)}, next renewal ${c.on}` : `Removed the annual renewal fee; next renewal ${c.on}`;
    }
  }

  /** "Where authorised": without Platform.Customers.AnyAccount, only the accounts you look after (D11, checked by permission per D4). */
  private ownAccountOnly(accountManagerId: string | undefined): void {
    if (!this.auth.can('Platform.Customers.AnyAccount') && accountManagerId !== this.auth.actor().id) throw new PolicyError('forbidden', 'Not one of your accounts');
  }

  private approval(): string {
    return this.auth.can('Platform.Customers.AnyAccount') ? 'System Administrator' : D11;
  }

  /** An active Humo staff member with the Account Manager role. */
  private isAccountManager(id: string): boolean {
    const who = this.access.identity(id);
    return !!who && who.kind === 'humo' && who.status === 'active' && activeAssignments(who).some((a) => a.role === 'humo-account-manager');
  }

  private checkPackageTerms(t: PackageTermsInput): FieldErrors | null {
    const e: FieldErrors = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.effectiveFrom)) e['effectiveFrom'] = 'Choose the date these terms take effect.';
    else if (t.effectiveFrom < today()) e['effectiveFrom'] = 'Terms can’t start in the past: invoices already issued keep their prices.';
    for (const k of ['monthlyPrice', 'annualPrice', 'includedStorageGb', 'includedSchemes', 'extraSchemePrice', 'annualRenewalFee'] as const) if (t[k] !== null && !(t[k]! >= 0)) e[k] = 'A number of zero or more, or leave it empty.';
    if (t.priceStatus !== 'awaiting' && t.monthlyPrice === null) e['monthlyPrice'] = 'A proposed or approved price needs an amount.';
    if (t.reason.trim().length < 8) e['reason'] = 'Say why, in a few words. It goes in the audit log.';
    return Object.keys(e).length ? e : null;
  }

  private checkAddOn(a: AddOnInput, isNew: boolean): FieldErrors | null {
    const e: FieldErrors = {};
    const exists = this.store.catalogue().addOns.some((x) => x.id === a.id);
    if (isNew && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.id)) e['id'] = 'Lower-case letters, numbers and dashes, e.g. sms-bundle.';
    else if (isNew && exists) e['id'] = 'An add-on with this id already exists.';
    else if (!isNew && !exists) e['id'] = 'No such add-on.';
    if (!a.name.trim()) e['name'] = 'Give it a name customers will recognise.';
    if (!a.features.length && a.kind !== 'storage') e['features'] = 'Choose the features it switches on.';
    if (a.features.some((f) => !FEATURE_META[f])) e['features'] = 'Only features the app knows can be sold.';
    if (a.kind === 'storage' && !(a.storageGb! > 0)) e['storageGb'] = 'How many GB does one pack add?';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.effectiveFrom) || (a.effectiveFrom < today() && !isNew)) e['effectiveFrom'] = 'Today or later: invoices already issued keep their prices.';
    if (a.price !== null && !(a.price >= 0)) e['price'] = 'Zero or more, or leave it empty.';
    if (a.priceStatus !== 'awaiting' && a.price === null) e['price'] = 'A proposed or approved price needs an amount.';
    if (a.reason.trim().length < 8) e['reason'] = 'Say why, in a few words. It goes in the audit log.';
    return Object.keys(e).length ? e : null;
  }
}

/**
 * DEVELOPMENT / SIMULATION ONLY. Stands in for Payfast, Peach Payments or
 * whichever provider is chosen: it hands out references and never redirects
 * anyone or takes any money.
 */
@Injectable()
export class SimulatedPaymentGateway extends PaymentGateway {
  readonly providerName = 'Simulated provider';
  readonly simulated = true;
  private seq = 1;

  createCheckout(request: { reference: string }): Observable<{ providerReference: string; redirectUrl: string | null }> {
    return of({ providerReference: `SIM-${request.reference}-${Date.now().toString(36)}-${this.seq++}`, redirectUrl: null });
  }
}
