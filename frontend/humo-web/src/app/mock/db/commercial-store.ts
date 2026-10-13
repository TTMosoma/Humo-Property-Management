import { Injectable, effect, signal, untracked } from '@angular/core';
import {
  AddOnInput,
  CommercialAgreement,
  CommercialCatalogue,
  GB,
  HumoInvoice,
  PackageId,
  PackageTermsInput,
  PaymentRecord,
  StorageMeasurement,
  isoDay,
  termsOn,
} from '../../domain';
import { DEMO_DATA } from '../fixtures/demo-data';
import { simulationStorage } from '../simulation/simulation-storage';
import { seeded } from './random';
import type { CustomerSeed } from './seed-platform';

interface Snapshot {
  catalogue: CommercialCatalogue;
  agreements: CommercialAgreement[];
  measurements: StorageMeasurement[];
  invoices: HumoInvoice[];
  payments: PaymentRecord[];
  /** Provider notification ids already processed. */
  notifications: string[];
}

/** The canonical baseline (demo-data/), copied so the fixtures never change. */
export function commercialBaseline(): Snapshot {
  return structuredClone({
    catalogue: { packages: DEMO_DATA.catalogue.packages, addOns: DEMO_DATA.catalogue.addOns, settings: DEMO_DATA.settings },
    agreements: DEMO_DATA.agreements,
    measurements: DEMO_DATA.storage,
    invoices: DEMO_DATA.invoices,
    payments: DEMO_DATA.payments,
    notifications: DEMO_DATA.payments.map((p) => p.providerReference).filter((x): x is string => !!x),
  });
}

const firstOfNextMonth = (now = new Date()) => isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 1));

/**
 * DEVELOPMENT / SIMULATION ONLY. Humo's commercial records (docs/23): the
 * catalogue's effective-dated terms, each customer's agreement, storage
 * measurements, invoices and payments. Starts from the canonical demo data;
 * customers outside it (the generated book of business, newly onboarded
 * accounts) get an agreement at their recorded contract value.
 */
@Injectable({ providedIn: 'root' })
export class CommercialStore {
  private readonly saved = simulationStorage.load<Snapshot>('commercial');
  private readonly base = this.saved ?? commercialBaseline();
  readonly catalogue = signal<CommercialCatalogue>(this.base.catalogue);
  readonly agreements = signal<CommercialAgreement[]>(this.base.agreements);
  readonly measurements = signal<StorageMeasurement[]>(this.base.measurements);
  readonly invoices = signal<HumoInvoice[]>(this.base.invoices);
  readonly payments = signal<PaymentRecord[]>(this.base.payments);
  private readonly notifications = signal<string[]>(this.base.notifications);
  /** When this simulation started from the baseline: files uploaded since then count toward storage. */
  readonly startedAt = simulationStorage.load<string>('commercial-started') ?? new Date().toISOString();
  private seq = 1;

  constructor() {
    simulationStorage.save('commercial-started', () => this.startedAt);
    effect(() => {
      const snapshot: Snapshot = {
        catalogue: this.catalogue(),
        agreements: this.agreements(),
        measurements: this.measurements(),
        invoices: this.invoices(),
        payments: this.payments(),
        notifications: this.notifications(),
      };
      untracked(() => simulationStorage.save('commercial', () => snapshot));
    });
  }

  /** Every customer gets an agreement and a storage figure. Called by the platform store with its customers. */
  adopt(seeds: CustomerSeed[]): void {
    const have = new Set(this.agreements().map((a) => a.organisationId));
    const missing = seeds.filter((c) => !have.has(c.organisationId));
    if (missing.length) this.agreements.update((all) => [...all, ...missing.map((c) => this.openingAgreement(c))]);
    const measured = new Set(this.measurements().map((m) => m.organisationId));
    const unmeasured = seeds.filter((c) => !measured.has(c.organisationId));
    if (unmeasured.length) this.measurements.update((all) => [...all, ...unmeasured.map((c) => this.demoMeasurement(c))]);
  }

  agreement(organisationId: string): CommercialAgreement | undefined {
    return this.agreements().find((a) => a.organisationId === organisationId);
  }

  measurement(organisationId: string): StorageMeasurement | undefined {
    return this.measurements().find((m) => m.organisationId === organisationId);
  }

  replaceAgreement(next: CommercialAgreement): void {
    this.agreements.update((all) => all.map((a) => (a.organisationId === next.organisationId ? next : a)));
  }

  // ---------------------------------------------------------------- Catalogue

  savePackageTerms(packageId: PackageId, input: PackageTermsInput, by: string): void {
    this.catalogue.update((cat) => ({
      ...cat,
      packages: cat.packages.map((p) => {
        if (p.packageId !== packageId) return p;
        const version = Math.max(0, ...p.terms.map((t) => t.version)) + 1;
        // Terms from the same date are replaced (a correction); otherwise they're a new version from that date.
        const kept = p.terms.filter((t) => t.effectiveFrom !== input.effectiveFrom);
        const { reason, ...rest } = input;
        return { ...p, terms: [{ ...rest, version, reason: reason.trim(), changedBy: by, changedAt: new Date().toISOString() }, ...kept].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)) };
      }),
    }));
  }

  saveAddOn(input: AddOnInput, by: string): void {
    this.catalogue.update((cat) => {
      const existing = cat.addOns.find((a) => a.id === input.id);
      const version = Math.max(0, ...(existing?.terms ?? []).map((t) => t.version)) + 1;
      const terms = {
        version,
        effectiveFrom: input.effectiveFrom,
        price: input.price,
        frequency: input.frequency,
        priceStatus: input.priceStatus,
        usageAllowance: input.usageAllowance,
        changedBy: by,
        changedAt: new Date().toISOString(),
        reason: input.reason.trim(),
      };
      const kept = (existing?.terms ?? []).filter((t) => t.effectiveFrom !== input.effectiveFrom);
      const next = {
        id: input.id,
        name: input.name.trim(),
        description: input.description.trim(),
        kind: input.kind,
        features: input.features,
        storageGb: input.kind === 'storage' ? input.storageGb : undefined,
        allowQuantity: input.allowQuantity,
        status: input.status,
        retiresOn: input.retiresOn || undefined,
        terms: [terms, ...kept].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
      };
      return { ...cat, addOns: existing ? cat.addOns.map((a) => (a.id === input.id ? next : a)) : [...cat.addOns, next] };
    });
  }

  // ---------------------------------------------------------------- Invoices and payments

  nextId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${this.seq++}`;
  }

  addInvoice(inv: HumoInvoice): void {
    this.invoices.update((all) => [inv, ...all]);
  }

  addPayment(p: PaymentRecord): void {
    this.payments.update((all) => [p, ...all]);
  }

  updatePayment(id: string, apply: (p: PaymentRecord) => PaymentRecord): void {
    this.payments.update((all) => all.map((p) => (p.id === id ? apply(p) : p)));
  }

  /** An invoice is paid only once verified payments cover it. */
  settle(invoiceId: string): void {
    const inv = this.invoices().find((i) => i.id === invoiceId);
    if (!inv) return;
    const verified = this.payments().filter((p) => p.invoiceId === invoiceId && p.status === 'verified').reduce((n, p) => n + p.amount, 0);
    if (verified + 0.005 >= inv.total && inv.status !== 'paid') this.invoices.update((all) => all.map((i) => (i.id === invoiceId ? { ...i, status: 'paid' } : i)));
  }

  /** Duplicate-notification protection: true the first time an id is seen. */
  firstNotification(eventId: string): boolean {
    if (this.notifications().includes(eventId)) return false;
    this.notifications.update((all) => [...all, eventId]);
    return true;
  }

  // ---------------------------------------------------------------- Opening records

  /** A customer outside the canonical data: the agreement is their recorded contract value. */
  private openingAgreement(c: CustomerSeed): CommercialAgreement {
    const r = seeded(`billing-${c.organisationId}`);
    const roll = r();
    const from = isoDay(c.subscription.startedAt);
    const trial = c.subscription.status === 'trial' && !c.subscription.mrr;
    const terms = termsOn(this.catalogue().packages.find((p) => p.packageId === c.subscription.packageId)?.terms ?? [], from);
    return {
      organisationId: c.organisationId,
      version: 1,
      cycle: 'monthly',
      packages: [
        trial
          ? { id: `pk-${c.organisationId}-1`, packageId: c.subscription.packageId, from, monthlyPrice: terms?.monthlyPrice ?? null, priceSource: 'catalogue', catalogueVersion: terms?.version }
          : { id: `pk-${c.organisationId}-1`, packageId: c.subscription.packageId, from, monthlyPrice: c.subscription.mrr, priceSource: 'negotiated' },
      ],
      addOns: c.subscription.addOns.map((a) => ({ id: `ao-${c.organisationId}-${a.addOnId}`, addOnId: a.addOnId, quantity: 1, from: isoDay(a.since), unitPrice: null, frequency: 'monthly', priceSource: 'included' })),
      adjustments: [],
      storageExceptions: [],
      renewal: { on: isoDay(c.subscription.renewsAt), fee: null, priceSource: 'negotiated' },
      billing: {
        preference: c.subscription.status === 'past-due' || roll < 0.25 ? 'manual-eft' : roll < 0.4 ? 'instant-eft' : 'card-recurring',
        billingEmail: `accounts@${c.organisationId}.example`,
        nextBillingDate: firstOfNextMonth(),
        mandate: { status: 'none' },
      },
      history: [
        {
          at: c.subscription.startedAt,
          byId: c.accountManagerId,
          by: 'Imported',
          action: trial ? 'Trial opened; price to be agreed' : 'Agreement opened at the recorded contract value',
          reason: trial ? 'New account' : 'Contract value on record before commercial management',
          effectiveFrom: from,
          approval: trial ? 'Account opening (docs/21)' : 'Imported record',
        },
      ],
    };
  }

  private demoMeasurement(c: CustomerSeed): StorageMeasurement {
    const r = seeded(`storage-${c.organisationId}`);
    const included = termsOn(this.catalogue().packages.find((p) => p.packageId === c.subscription.packageId)?.terms ?? [], isoDay(new Date()))?.includedStorageGb ?? 25;
    // Most customers use a fair share; a few are near their limit.
    const share = c.snapshot.units === 0 ? 0 : r() < 0.06 ? 0.82 + r() * 0.15 : 0.12 + r() * 0.55;
    const used = included * share * GB;
    return { organisationId: c.organisationId, measuredAt: `${isoDay(new Date())}T02:00:00+02:00`, source: 'demo', documentsBytes: Math.round(used * 0.55), imagesBytes: Math.round(used * 0.35), generatedBytes: Math.round(used * 0.1) };
  }
}
