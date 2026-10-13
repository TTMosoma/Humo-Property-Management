import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ADD_ONS, FEATURE_META, PACKAGES, activeAssignments, chargesOn, invoiceStatus, packageById, renewalIn } from '../../domain';
import { AccessStore } from '../db/access-store';
import { MaintenanceStore } from '../db/maintenance-store';
import { MockDb } from '../db/mock-db';
import { PlatformStore } from '../db/platform-store';
import { provideMockData } from '../provide-mock-data';
import { DEMO_DATA } from './demo-data';

/**
 * Demo-data integrity (docs/demo/demo-data-strategy.md §5): every reference in
 * the canonical fixtures resolves, and the totals the demo shows reconcile.
 * Runs on every `npm test`; a failing check here means a fixture or a seed
 * drifted, not that the demo is "nearly right".
 */
describe('Demo data integrity', () => {
  let platform: PlatformStore;
  let access: AccessStore;
  const ids = <T>(xs: T[], key: (x: T) => string) => xs.map(key);
  const unique = (xs: string[]) => expect(new Set(xs).size, `duplicates in ${xs.join(', ')}`).toBe(xs.length);
  const baseline = DEMO_DATA.manifest.baselineDate;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    platform = TestBed.inject(PlatformStore);
    access = TestBed.inject(AccessStore);
  });

  const isAccountManager = (id: string) => {
    const who = access.identity(id);
    return !!who && who.kind === 'humo' && who.status === 'active' && activeAssignments(who).some((a) => a.role === 'humo-account-manager');
  };

  it('the catalogue only sells packages and features the app knows', () => {
    const { packages, addOns } = DEMO_DATA.catalogue;
    expect(packages.map((p) => p.packageId).sort()).toEqual(PACKAGES.map((p) => p.id).sort());
    unique(ids(addOns, (a) => a.id));
    for (const a of addOns) {
      for (const f of a.features) expect(FEATURE_META[f], `${a.id} sells unknown feature ${f}`).toBeTruthy();
      expect(a.terms.length, `${a.id} has no terms`).toBeGreaterThan(0);
      if (a.kind === 'storage' && a.status === 'active') expect(a.storageGb).toBeGreaterThan(0);
      for (const t of a.terms) if (t.priceStatus !== 'awaiting') expect(t.price, `${a.id} is ${t.priceStatus} without a price`).not.toBeNull();
    }
    // Every add-on the code knows about is in the catalogue (none silently dropped).
    for (const known of ADD_ONS) expect(addOns.some((a) => a.id === known.id), known.id).toBe(true);
    // No base-package price has been decided: none may be invented in the fixtures.
    for (const p of packages) for (const t of p.terms) if (t.priceStatus === 'awaiting') expect(t.monthlyPrice).toBeNull();
  });

  it('account managers are active Humo staff with the Account Manager role', () => {
    expect(isAccountManager(DEMO_DATA.settings.designatedAccountManagerId)).toBe(true);
    for (const a of DEMO_DATA.accountManagers.assignments) expect(isAccountManager(a.accountManagerId), a.accountManagerId).toBe(true);
    for (const id of DEMO_DATA.accountManagers.rotation) expect(isAccountManager(id), id).toBe(true);
    for (const c of platform.seeds()) expect(isAccountManager(c.accountManagerId), `${c.organisationId} → ${c.accountManagerId}`).toBe(true);
  });

  it('every agreement belongs to a customer and references the catalogue and real people', () => {
    const customers = new Map(platform.seeds().map((c) => [c.organisationId, c]));
    const addOnIds = new Set(DEMO_DATA.catalogue.addOns.map((a) => a.id));
    unique(ids(DEMO_DATA.agreements, (a) => a.organisationId));
    for (const a of DEMO_DATA.agreements) {
      const c = customers.get(a.organisationId);
      expect(c, `agreement for unknown customer ${a.organisationId}`).toBeTruthy();
      for (const p of a.packages) expect(packageById(p.packageId), p.packageId).toBeTruthy();
      for (const l of a.addOns) expect(addOnIds.has(l.addOnId), `${a.organisationId}: ${l.addOnId}`).toBe(true);
      for (const e of a.history) expect(access.identity(e.byId), `${a.organisationId} history by ${e.byId}`).toBeTruthy();
      unique([...a.packages, ...a.addOns, ...a.adjustments].map((l) => l.id));
      // The seed's recorded contract value is what the agreement charges today.
      expect(chargesOn(a, baseline, { catalogue: { ...DEMO_DATA.catalogue, settings: DEMO_DATA.settings }, schemes: c!.snapshot.schemes, packageName: (id) => id }).recurringMonthly).toBe(c!.subscription.mrr);
      expect(DEMO_DATA.storage.some((m) => m.organisationId === a.organisationId), `${a.organisationId} has no storage measurement`).toBe(true);
    }
  });

  it('invoices add up, reconcile with the agreement, and are paid only by verified payments', () => {
    unique(ids(DEMO_DATA.invoices, (i) => i.id));
    unique(ids(DEMO_DATA.invoices, (i) => i.reference));
    unique(ids(DEMO_DATA.payments, (p) => p.id));
    unique(DEMO_DATA.payments.map((p) => p.providerReference).filter((x): x is string => !!x));
    const cat = { ...DEMO_DATA.catalogue, settings: DEMO_DATA.settings };
    for (const inv of DEMO_DATA.invoices) {
      const a = DEMO_DATA.agreements.find((x) => x.organisationId === inv.organisationId);
      expect(a, `invoice ${inv.id} without an agreement`).toBeTruthy();
      const sum = Math.round(inv.lines.reduce((n, l) => n + l.amount, 0) * 100) / 100;
      expect(inv.subtotal, inv.id).toBe(sum);
      expect(inv.total, inv.id).toBe(Math.round((inv.subtotal + inv.tax.amount) * 100) / 100);
      expect(inv.tax.registered).toBe(DEMO_DATA.settings.tax.vatRegistered);
      expect(inv.simulated).toBe(true);
      const renewal = renewalIn(a!, inv.periodStart, inv.periodEnd)?.amount ?? 0;
      expect(inv.subtotal, `${inv.id} doesn't match the agreement`).toBe(chargesOn(a!, inv.periodStart, { catalogue: cat, schemes: 0, packageName: (id) => id }).recurringMonthly + renewal);
      const verified = DEMO_DATA.payments.filter((p) => p.invoiceId === inv.id && p.status === 'verified').reduce((n, p) => n + p.amount, 0);
      if (inv.status === 'paid') expect(verified, `${inv.id} paid without a verified payment`).toBeGreaterThanOrEqual(inv.total);
      else expect(verified, `${inv.id} unpaid but covered`).toBeLessThan(inv.total);
    }
    for (const p of DEMO_DATA.payments) {
      expect(DEMO_DATA.invoices.some((i) => i.id === p.invoiceId && i.organisationId === p.organisationId), `payment ${p.id}`).toBe(true);
      expect(p.simulated).toBe(true);
      if (p.status === 'verified') expect(p.verification && p.verifiedAt, p.id).toBeTruthy();
    }
  });

  it('a customer shown as overdue has an overdue invoice, and the other way round', () => {
    for (const c of platform.seeds().filter((x) => DEMO_DATA.invoices.some((i) => i.organisationId === x.organisationId))) {
      const overdue = DEMO_DATA.invoices.some((i) => i.organisationId === c.organisationId && invoiceStatus(i, baseline) === 'overdue');
      expect(c.snapshot.paymentStatus === 'overdue', c.organisationId).toBe(overdue);
    }
  });

  it('the generated book of business still adds up to the board-level figures', () => {
    const live = platform.customers().filter((c) => c.subscription.status !== 'cancelled');
    expect(live.length).toBe(184);
    expect(live.reduce((n, c) => n + c.subscription.mrr, 0)).toBe(1_840_000);
  });

  it('maintenance jobs reference real schemes, units and suppliers', () => {
    const db = TestBed.inject(MockDb);
    const maintenance = TestBed.inject(MaintenanceStore);
    const suppliers = new Set(maintenance.suppliers.map((s) => s.id));
    for (const j of maintenance.jobs) {
      expect(db.schemes.has(j.schemeId), `${j.id} scheme ${j.schemeId}`).toBe(true);
      if (j.unitId) expect(db.unitById.get(j.unitId)?.schemeId, `${j.id} unit ${j.unitId}`).toBe(j.schemeId);
      if (j.supplierId) expect(suppliers.has(j.supplierId), `${j.id} supplier ${j.supplierId}`).toBe(true);
    }
  });

  it('owner balances reconcile with their ledgers', () => {
    const db = TestBed.inject(MockDb);
    for (const account of [...db.accounts.values()].slice(0, 120)) {
      const detail = db.accountDetail(account.id);
      if (!detail) continue;
      expect(detail.transactions[0]?.balance ?? account.balance, account.accountNo).toBeCloseTo(account.balance, 2);
      expect(db.schemes.has(account.schemeId) && db.unitById.get(account.unitId)?.schemeId === account.schemeId, account.accountNo).toBe(true);
    }
  });
});
