import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import {
  ApiError,
  CommercialAgreement,
  CommercialCatalogue,
  CommercialDataSource,
  GB,
  buildInvoice,
  PlanDataSource,
  PlatformDataSource,
  PolicyError,
  chargesOn,
  inForce,
  isoDay,
  storageSummary,
} from '../../domain';
import { AccessStore } from '../db/access-store';
import { CommercialStore, commercialBaseline } from '../db/commercial-store';
import { PlatformStore } from '../db/platform-store';
import { StorageMeter } from '../db/storage-meter';
import { DEMO_DATA } from '../fixtures/demo-data';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';
import { simulationStorage } from '../simulation/simulation-storage';

/** Commercial management (docs/23): catalogue, agreements, storage, billing and payments. */
describe('Commercial management', () => {
  let auth: MockAuthSession;
  let data: CommercialDataSource;
  let store: CommercialStore;
  let platform: PlatformStore;
  let access: AccessStore;
  const run = <T>(o: Observable<T>) => firstValueFrom(o);
  const stepUp = () => auth.recordProof({ verified: true, method: 'passkey', device: 'Test', at: new Date().toISOString() });
  const day = (offset: number) => isoDay(new Date(Date.now() + offset * 86_400_000));
  const ctx = (catalogue: CommercialCatalogue, schemes = 0) => ({ catalogue, schemes, packageName: (id: string) => id });

  function boot(): void {
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    data = TestBed.inject(CommercialDataSource);
    store = TestBed.inject(CommercialStore);
    platform = TestBed.inject(PlatformStore);
    access = TestBed.inject(AccessStore);
    platform.customers(); // the platform adopts every customer into the commercial records
  }

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    boot();
  });

  describe('prices and calculations', () => {
    const agreement = (over: Partial<CommercialAgreement> = {}): CommercialAgreement => ({
      organisationId: 'x',
      version: 1,
      cycle: 'monthly',
      packages: [{ id: 'p1', packageId: 'professional', from: '2026-01-01', monthlyPrice: 9_000, priceSource: 'catalogue', catalogueVersion: 2 }],
      addOns: [
        { id: 'a1', addOnId: 'whatsapp', quantity: 1, from: '2026-01-01', unitPrice: 100, frequency: 'monthly', priceSource: 'catalogue' },
        { id: 'a2', addOnId: 'storage-10', quantity: 2, from: '2026-01-01', unitPrice: 150, frequency: 'monthly', priceSource: 'catalogue' },
        { id: 'a3', addOnId: 'api-access', quantity: 1, from: '2026-01-01', unitPrice: 1_200, frequency: 'annual', priceSource: 'negotiated' },
      ],
      adjustments: [
        { id: 'd1', kind: 'discount', label: 'Launch discount', amount: 0, percent: 10, from: '2026-01-01', reason: 'x', by: 'x', at: 'x' },
        { id: 'c1', kind: 'credit', label: 'Goodwill', amount: 500, from: '2026-01-01', reason: 'x', by: 'x', at: 'x' },
        { id: 'f1', kind: 'once-off-fee', label: 'Data migration', amount: 2_500, from: '2026-01-01', reason: 'x', by: 'x', at: 'x' },
      ],
      storageExceptions: [],
      renewal: { on: '2027-05-01', fee: null, priceSource: 'negotiated' },
      billing: { preference: 'card-recurring', billingEmail: 'a@b.example', nextBillingDate: '2026-11-01', mandate: { status: 'none' } },
      history: [],
      ...over,
    });

    it('adds up the package, portfolio pricing, add-ons and discounts, and keeps once-off fees, credits, usage and tax apart', () => {
      const cat = structuredClone(store.catalogue());
      cat.packages.find((p) => p.packageId === 'professional')!.terms[0] = { ...cat.packages.find((p) => p.packageId === 'professional')!.terms[0], includedSchemes: 20, extraSchemePrice: 50, extraSchemeBlock: 1 };
      const c = chargesOn(agreement(), '2026-10-12', ctx(cat, 24));
      // 9 000 + 4 × 50 schemes + 100 WhatsApp + 2 × 150 storage + 1 200 / 12 API = 9 700; 10% off = 8 730.
      expect(c.recurring.find((l) => l.kind === 'extra-schemes')?.amount).toBe(200);
      expect(c.recurring.find((l) => l.kind === 'discount')?.amount).toBe(-970);
      expect(c.recurringMonthly).toBe(8_730);
      expect(c.onceOff.map((l) => l.amount)).toEqual([2_500]);
      expect(c.credits.map((l) => l.amount)).toEqual([-500]);
      expect(c.usage[0].label).toBe('WhatsApp Communication');
      expect(c.tax).toEqual({ registered: false, ratePercent: 15, amount: 0 });
      expect(c.recurringWithTax).toBe(8_730);

      cat.settings.tax = { ...cat.settings.tax, vatRegistered: true, vatNumber: '4000000000' };
      expect(chargesOn(agreement(), '2026-10-12', ctx(cat, 24)).tax.amount).toBe(1_309.5);
    });

    it('prices extra schemes in blocks: R150 per 10, and a part block counts (D15)', () => {
      const cat = store.catalogue();
      const pro = cat.packages.find((p) => p.packageId === 'professional')!.terms[0];
      expect(pro).toMatchObject({ monthlyPrice: 2_400, includedSchemes: 25, extraSchemePrice: 150, extraSchemeBlock: 10, includedStorageGb: 25, annualRenewalFee: 250 });
      const extra = (schemes: number) => chargesOn(agreement(), '2026-10-12', ctx(cat, schemes)).recurring.find((l) => l.kind === 'extra-schemes')?.amount ?? 0;
      expect([extra(25), extra(26), extra(35), extra(36)]).toEqual([0, 150, 150, 300]);
    });

    it('holds a discount above 20% for a second approver, who can’t be the person who asked (D15)', async () => {
      auth.signIn('am-mashoto');
      stepUp();
      const a = store.agreement('acacia')!;
      await run(data.change('acacia', { type: 'adjustment', kind: 'discount', label: 'Loyalty', amount: 0, percent: 30, from: day(0), reason: 'Long-standing customer, agreed at renewal' }, a.version));
      const pending = store.agreement('acacia')!.pendingApprovals!;
      expect(pending).toHaveLength(1);
      expect(store.agreement('acacia')!.adjustments.some((x) => x.label === 'Loyalty')).toBe(false);
      await expect(run(data.decideApproval('acacia', pending[0].id, 'approve', ''))).rejects.toBeInstanceOf(PolicyError);

      auth.signIn('p-refilwe');
      stepUp();
      await run(data.decideApproval('acacia', pending[0].id, 'approve', ''));
      expect(store.agreement('acacia')!.pendingApprovals).toEqual([]);
      expect(store.agreement('acacia')!.adjustments.find((x) => x.label === 'Loyalty')?.percent).toBe(30);

      // 20% or less applies at once.
      auth.signIn('am-mashoto');
      stepUp();
      await run(data.change('acacia', { type: 'adjustment', kind: 'discount', label: 'Small', amount: 0, percent: 20, from: day(0), reason: 'Within the Account Manager’s authority' }, store.agreement('acacia')!.version));
      expect(store.agreement('acacia')!.pendingApprovals).toEqual([]);
    });

    it('lets a System Administrator configure package and add-on prices as effective-dated versions', async () => {
      auth.signIn('p-terry');
      stepUp();
      await run(data.savePackageTerms('professional', { effectiveFrom: day(1), monthlyPrice: 9_500, annualPrice: 102_600, priceStatus: 'approved', includedStorageGb: 25, storageStatus: 'approved', includedSchemes: 20, extraSchemePrice: 45, annualRenewalFee: 2_400, reason: 'Board approved the 2027 price list' }));
      const terms = store.catalogue().packages.find((p) => p.packageId === 'professional')!.terms;
      expect(terms.map((t) => t.monthlyPrice)).toEqual([9_500, 2_400]);
      expect(terms[0]).toMatchObject({ version: 2, changedBy: 'Terry Mosoma' });

      await run(data.saveAddOn({ id: 'postage-pack', name: 'Postage pack', description: '100 printed and posted letters a month.', kind: 'communication', features: ['communications'], allowQuantity: true, status: 'active', effectiveFrom: day(0), price: 250, frequency: 'monthly', priceStatus: 'proposed', usageAllowance: { unit: 'letters', included: 100 }, reason: 'New pack for agencies that post letters' }, true));
      expect(store.catalogue().addOns.find((a) => a.id === 'postage-pack')?.terms[0].price).toBe(250);
      expect(access.audit()[0].action).toContain('Created the add-on Postage pack');
    });
  });

  describe('annual renewal fee', () => {
    it('is charged once, on the invoice whose period includes the renewal date, never in the monthly total', () => {
      const a = { ...store.agreement('acacia')!, renewal: { on: '2026-11-15', fee: 2_500, priceSource: 'negotiated' as const } };
      const c = ctx(store.catalogue());
      expect(chargesOn(a, '2026-11-01', c).recurringMonthly).toBe(17_500); // with WhatsApp from 1 November; the renewal fee isn't in it
      expect(chargesOn(a, '2026-11-01', c).renewal).toMatchObject({ on: '2026-11-15', fee: 2_500 });
      const nov = buildInvoice(a, '2026-11-01', c, { id: 'x', reference: 'x', issuedOn: '2026-11-01', simulated: true });
      expect(nov.lines.find((l) => l.kind === 'renewal-fee')?.amount).toBe(2_500);
      expect(nov.subtotal).toBe(17_400 + 100 + 2_500); // WhatsApp starts 1 November
      const dec = buildInvoice(a, '2026-12-01', c, { id: 'y', reference: 'y', issuedOn: '2026-12-01', simulated: true });
      expect(dec.lines.some((l) => l.kind === 'renewal-fee')).toBe(false);
    });

    it('Umgeni’s next invoice carries its R3 000 renewal fee, and the renewal then moves on a year', async () => {
      auth.signIn('p-refilwe');
      stepUp();
      const id = await run(data.issueInvoice('umgeni'));
      const inv = store.invoices().find((i) => i.id === id)!;
      expect(inv.lines.find((l) => l.kind === 'renewal-fee')?.amount).toBe(3_000);
      expect(inv.lines.find((l) => l.kind === 'credit')?.amount).toBe(-500);
      expect(inv.total).toBe(17_600 + 3_000 - 500);
      expect(store.agreement('umgeni')!.renewal.on).toBe('2027-11-15');
      expect(platform.subscription('umgeni')!.renewsAt).toBe('2027-11-15');
    });

    it('an Account Manager sets an agreed renewal fee; a catalogue renewal fee comes with a catalogue-priced package', async () => {
      auth.signIn('am-mashoto');
      stepUp();
      await run(data.change('acacia', { type: 'renewal', fee: 1_800, on: '2027-05-01', reason: 'Annual training day agreed at renewal' }, 1));
      expect(store.agreement('acacia')!.renewal).toEqual({ on: '2027-05-01', fee: 1_800, priceSource: 'negotiated' });

      auth.signIn('p-terry');
      stepUp();
      await run(data.savePackageTerms('enterprise', { ...termsOf('enterprise'), effectiveFrom: day(0), monthlyPrice: 30_000, priceStatus: 'approved', annualRenewalFee: 5_000, reason: 'Enterprise pricing approved' }));
      await run(data.change('fynbos', { type: 'package', packageId: 'enterprise', effectiveFrom: day(0), reason: 'Moving to Enterprise at list price' }, 1));
      expect(store.agreement('fynbos')!.renewal).toMatchObject({ fee: 5_000, priceSource: 'catalogue' });
      // Acacia's agreed fee isn't overwritten by a catalogue fee.
      await run(data.change('acacia', { type: 'package', packageId: 'enterprise', effectiveFrom: day(0), reason: 'Moving to Enterprise at list price' }, store.agreement('acacia')!.version));
      expect(store.agreement('acacia')!.renewal.fee).toBe(1_800);
    });
  });

  describe('scheduled changes and price protection', () => {
    it('the seeded WhatsApp add-on for Acacia takes effect on 1 November 2026, not before', () => {
      const a = store.agreement('acacia')!;
      expect(inForce(a.addOns, '2026-10-31').some((l) => l.addOnId === 'whatsapp')).toBe(false);
      expect(inForce(a.addOns, '2026-11-01').some((l) => l.addOnId === 'whatsapp')).toBe(true);
      const c = (on: string) => chargesOn(a, on, ctx(store.catalogue())).recurringMonthly;
      expect(c('2026-11-01') - c('2026-10-31')).toBe(100);
    });

    it('an Account Manager previews, then schedules, an add-on that starts on its date', async () => {
      auth.signIn('am-mashoto');
      const change = { type: 'add-on' as const, addOnId: 'storage-10', quantity: 1, effectiveFrom: day(20), reason: 'They’re close to their storage limit' };
      const preview = await run(data.preview('fynbos', change));
      expect(preview.errors).toBeNull();
      expect(preview.difference).toBe(150);
      expect(preview.after.recurringMonthly).toBe(preview.before.recurringMonthly + 150);
      expect(store.agreement('fynbos')!.version).toBe(1); // a preview saves nothing

      stepUp();
      await run(data.change('fynbos', change, 1));
      expect(platform.subscription('fynbos')!.addOns.some((a) => a.addOnId === 'storage-10')).toBe(false); // not yet
      const a = store.agreement('fynbos')!;
      expect(inForce(a.addOns, day(20)).find((l) => l.addOnId === 'storage-10')).toMatchObject({ unitPrice: 150, priceSource: 'catalogue', catalogueVersion: 1 });
      expect(a.history[0]).toMatchObject({ by: 'Mashoto Moropane', reason: 'They’re close to their storage limit', effectiveFrom: day(20) });
      expect(access.audit()[0]).toMatchObject({ result: 'success', resource: 'Agreement', resourceId: 'fynbos' });
    });

    it('a catalogue price change doesn’t reach an existing agreement; new agreements get the new price from its date', async () => {
      auth.signIn('p-terry');
      stepUp();
      const later = day(40);
      await run(data.saveAddOn({ ...addOnInput('whatsapp'), effectiveFrom: later, price: 150, reason: 'New WhatsApp pricing from the provider' }, false));
      const acacia = store.agreement('acacia')!;
      expect(inForce(acacia.addOns, later).find((l) => l.addOnId === 'whatsapp')?.unitPrice).toBe(100);
      expect(chargesOn(acacia, later, ctx(store.catalogue())).recurring.find((l) => l.label.startsWith('WhatsApp'))?.amount).toBe(100);

      await run(data.change('marula', { type: 'add-on', addOnId: 'whatsapp', quantity: 1, effectiveFrom: later, reason: 'Asked for WhatsApp reminders' }, 1));
      expect(inForce(store.agreement('marula')!.addOns, later).find((l) => l.addOnId === 'whatsapp')?.unitPrice).toBe(150);
    });

    it('an issued invoice keeps the price it was issued with', async () => {
      auth.signIn('p-refilwe');
      stepUp();
      const id = await run(data.issueInvoice('acacia'));
      const total = store.invoices().find((i) => i.id === id)!.total;
      auth.signIn('p-terry');
      stepUp();
      await run(data.change('acacia', { type: 'package', packageId: 'enterprise', effectiveFrom: day(0), monthlyPrice: 30_000, reason: 'Upgrade agreed at the renewal meeting' }, store.agreement('acacia')!.version));
      expect(store.invoices().find((i) => i.id === id)!.total).toBe(total);
    });

    it('refuses an unpriced add-on without an agreed price, and a date in the past', async () => {
      auth.signIn('am-mashoto');
      stepUp();
      await expect(run(data.change('acacia', { type: 'add-on', addOnId: 'api-access', quantity: 1, effectiveFrom: day(1), reason: 'Their developer wants API access' }, 1))).rejects.toBeInstanceOf(ApiError);
      await expect(run(data.change('acacia', { type: 'add-on', addOnId: 'storage-10', quantity: 1, effectiveFrom: day(-1), reason: 'Backdated by mistake' }, 1))).rejects.toBeInstanceOf(ApiError);
      await run(data.change('acacia', { type: 'add-on', addOnId: 'api-access', quantity: 1, effectiveFrom: day(1), unitPrice: 750, reason: 'Their developer wants API access' }, 1));
      expect(inForce(store.agreement('acacia')!.addOns, day(1)).find((l) => l.addOnId === 'api-access')).toMatchObject({ unitPrice: 750, priceSource: 'negotiated' });
    });
  });

  describe('storage', () => {
    it('the allowance includes purchased packs and temporary exceptions', () => {
      const a = structuredClone(store.agreement('acacia')!);
      a.addOns.push({ id: 's', addOnId: 'storage-10', quantity: 2, from: '2026-01-01', unitPrice: 150, frequency: 'monthly', priceSource: 'catalogue' });
      a.storageExceptions.push({ id: 'x', extraGb: 5, until: '2999-01-01', reason: 'x', by: 'x', at: 'x' });
      const s = storageSummary(a, store.catalogue(), store.measurement('acacia')!, '2026-10-12');
      expect(s).toMatchObject({ includedGb: 25, purchasedGb: 20, exceptionGb: 5, totalGb: 50, enforcedByServer: false });
    });

    it('warns at the configured thresholds and reports an exhausted quota', () => {
      const meter = TestBed.inject(StorageMeter);
      expect(meter.summary('acacia')).toMatchObject({ state: 'warning', percent: 85.2 });
      expect(meter.summary('fynbos')!.state).toBe('exhausted');
      expect(meter.summary('marula')!.state).toBe('ok');
      expect(meter.checkUpload('fynbos', 1_000)?.['file']).toContain('storage is full');
      expect(meter.checkUpload('acacia', 1_000)).toBeNull();
      expect(meter.checkUpload('acacia', 4 * GB)).not.toBeNull();

      store.catalogue.update((c) => ({ ...c, settings: { ...c.settings, storageThresholds: [70, 85] } }));
      expect(meter.summary('acacia')!.state).toBe('critical');
    });

    it('adding a storage pack clears the exhausted state; nothing is charged or upgraded automatically', async () => {
      const meter = TestBed.inject(StorageMeter);
      const before = platform.subscription('fynbos')!;
      expect(before.packageId).toBe('essentials');
      auth.signIn('am-mashoto');
      stepUp();
      await run(data.change('fynbos', { type: 'add-on', addOnId: 'storage-10', quantity: 1, effectiveFrom: day(0), reason: 'Storage full: customer agreed to a 10 GB pack' }, 1));
      expect(meter.summary('fynbos')).toMatchObject({ totalGb: 15, state: 'ok' });
      expect(platform.subscription('fynbos')!.packageId).toBe('essentials');
      expect(platform.subscription('fynbos')!.mrr).toBe(before.mrr + 150);
    });
  });

  describe('billing preference and payments', () => {
    it('persists the customer’s billing preference', async () => {
      auth.signIn('am-mashoto');
      stepUp();
      await run(data.change('acacia', { type: 'billing-preference', preference: 'manual-eft', billingEmail: 'finance@acacia-ma.example', reason: 'Their auditors want EFT with remittance advice' }, 1));
      expect(store.agreement('acacia')!.billing).toMatchObject({ preference: 'manual-eft', mandate: { status: 'none' } });
      await new Promise((r) => setTimeout(r, 450)); // the simulation saves shortly after a change
      expect(simulationStorage.load<{ agreements: CommercialAgreement[] }>('commercial')!.agreements.find((a) => a.organisationId === 'acacia')!.billing.preference).toBe('manual-eft');

      TestBed.resetTestingModule();
      boot();
      expect(store.agreement('acacia')!.billing.preference).toBe('manual-eft');
    });

    it('a checkout is not a payment; only a verified notification settles the invoice, once', async () => {
      auth.signIn('p-refilwe'); // Humo Finance (D15)
      stepUp();
      const invoiceId = await run(data.issueInvoice('acacia'));
      const session = await run(data.startCheckout(invoiceId));
      expect(session).toMatchObject({ simulated: true, redirectUrl: null });
      const pay = () => store.payments().find((p) => p.id === session.paymentId)!;
      const inv = () => store.invoices().find((i) => i.id === invoiceId)!;
      expect(pay()).toMatchObject({ status: 'initiated', simulated: true });
      expect(inv().status).toBe('issued');

      await run(data.simulateProviderNotification(session.paymentId, 'paid', 'evt-1'));
      expect(pay()).toMatchObject({ status: 'verified', verification: 'provider-notification', simulated: true });
      expect(inv().status).toBe('paid');

      // The provider retries: the same notification changes nothing.
      const count = store.payments().length;
      await run(data.simulateProviderNotification(session.paymentId, 'paid', 'evt-1'));
      expect(store.payments().length).toBe(count);
      expect(pay().verifiedAt).toBeTruthy();
    });

    it('manual EFT stays unpaid on a proof of payment until it is reconciled', async () => {
      const pending = store.payments().find((p) => p.organisationId === 'fynbos' && p.status === 'pending-verification')!;
      const inv = () => store.invoices().find((i) => i.id === pending.invoiceId)!;
      expect(inv().status).toBe('issued');

      auth.signIn('am-mashoto');
      stepUp();
      await expect(run(data.reconcileEft(pending.id, 'FNB 2026-10-13 HPM-FYN'))).rejects.toBeInstanceOf(PolicyError);
      await expect(run(data.startCheckout(inv().id))).rejects.toBeInstanceOf(ApiError);

      auth.signIn('p-refilwe'); // Humo Finance (D15)
      stepUp();
      await run(data.reconcileEft(pending.id, 'FNB 2026-10-13 HPM-FYN-202610'));
      expect(store.payments().find((p) => p.id === pending.id)).toMatchObject({ status: 'verified', verification: 'bank-reconciliation', verifiedBy: 'Refilwe Sithole', simulated: true });
      expect(inv().status).toBe('paid');
    });
  });

  describe('account manager assignment', () => {
    it('Mashoto is the designated account manager, from the staff record', () => {
      expect(store.catalogue().settings.designatedAccountManagerId).toBe('am-mashoto');
      const acacia = platform.customers().find((c) => c.organisationId === 'acacia')!;
      expect(acacia).toMatchObject({ accountManagerId: 'am-mashoto', accountManager: 'Mashoto Moropane' });
    });

    it('is configurable by authorised staff, and only to an active Account Manager', async () => {
      auth.signIn('p-terry');
      stepUp();
      const { version, ...settings } = store.catalogue().settings;
      await expect(run(data.saveSettings({ ...settings, designatedAccountManagerId: 'p-lerato' }, 'Lerato covers new accounts', version))).rejects.toBeInstanceOf(ApiError);
      await run(data.saveSettings({ ...settings, designatedAccountManagerId: 'p-dumisani' }, 'Dumisani covers new accounts in November', version));
      expect(store.catalogue().settings.designatedAccountManagerId).toBe('p-dumisani');

      // Reassigning a customer shows the new manager everywhere at once.
      platform.setAccountManager(['acacia'], { id: 'p-dumisani' });
      expect(platform.customers().find((c) => c.organisationId === 'acacia')!.accountManager).toBe('Dumisani Ngcobo');
    });
  });

  describe('permission boundaries', () => {
    it('Account Managers can’t edit the catalogue, verify payments or change another manager’s customer', async () => {
      auth.signIn('am-mashoto');
      stepUp();
      await expect(run(data.saveAddOn({ ...addOnInput('whatsapp'), price: 1, reason: 'Trying to change a price' }, false))).rejects.toBeInstanceOf(PolicyError);
      await expect(run(data.issueInvoice('acacia'))).rejects.toBeInstanceOf(PolicyError);
      await expect(run(data.change('marula', { type: 'add-on', addOnId: 'storage-10', quantity: 1, effectiveFrom: day(0), reason: 'Not my customer though' }, 1))).rejects.toBeInstanceOf(PolicyError);
      expect(access.audit()[0]).toMatchObject({ result: 'denied', resourceId: 'marula' });
    });

    it('Support can’t see commercial terms; the Executive can see but not change them', async () => {
      auth.signIn('p-lerato');
      await expect(run(data.customer('acacia'))).rejects.toBeInstanceOf(PolicyError);

      auth.signIn('p-nomsa');
      auth.switchAssignment('m-nomsa'); // Humo Executive
      expect((await run(data.customer('acacia')))!.current.recurringMonthly).toBe(17_400);
      await expect(run(data.change('acacia', { type: 'billing-preference', preference: 'manual-eft', billingEmail: 'x@y.example', reason: 'Executive trying a change' }, 1))).rejects.toBeInstanceOf(PolicyError);
    });

    it('customers see their own storage and billing preference, never Humo’s prices or other customers', async () => {
      auth.signIn('p-thandeka');
      const plan = await run(TestBed.inject(PlanDataSource).mine('acacia'));
      expect(plan!.storage).toMatchObject({ state: 'warning', enforcedByServer: false });
      expect(plan!.billing!.preference).toBe('card-recurring');
      expect(Object.keys(plan!)).not.toContain('agreement');
      await expect(run(TestBed.inject(CommercialDataSource).customer('acacia'))).rejects.toBeInstanceOf(PolicyError);
    });

    it('Manage features still works (D11) and doesn’t change what the customer pays', async () => {
      auth.signIn('p-dumisani');
      stepUp();
      const before = platform.subscription('marula')!.mrr;
      await run(TestBed.inject(PlatformDataSource).changeSubscription('marula', { type: 'add-on', addOnId: 'governance', enabled: true, reason: 'Pilot agreed at the quarterly review' }, 1));
      expect(platform.subscription('marula')!.addOns.some((a) => a.addOnId === 'governance')).toBe(true);
      expect(platform.subscription('marula')!.mrr).toBe(before);
    });
  });

  describe('demo reset', () => {
    it('restores the canonical baseline, whatever happened before', async () => {
      const fresh = () => JSON.stringify({ agreements: store.agreements(), measurements: store.measurements(), invoices: store.invoices(), payments: store.payments(), catalogue: store.catalogue() });
      const baseline = fresh();

      auth.signIn('p-refilwe'); // Humo Finance (D15)
      stepUp();
      await run(data.issueInvoice('acacia'));
      auth.signIn('p-terry');
      stepUp();
      await run(data.change('acacia', { type: 'storage-exception', extraGb: 10, until: day(14), reason: 'Bridging while the pack is agreed' }, store.agreement('acacia')!.version));
      await new Promise((r) => setTimeout(r, 450));
      expect(fresh()).not.toBe(baseline);

      simulationStorage.reset();
      TestBed.resetTestingModule();
      localStorage.setItem('humo.latency', 'off');
      boot();
      expect(fresh()).toBe(baseline);
      expect(store.agreement('acacia')).toEqual(commercialBaseline().agreements.find((a) => a.organisationId === 'acacia'));
      expect(DEMO_DATA.manifest.dataset).toBe('humo-pm-demo');
    });
  });

  function termsOf(packageId: 'essentials' | 'professional' | 'enterprise') {
    const { version: _v, changedBy: _b, changedAt: _a, ...t } = store.catalogue().packages.find((p) => p.packageId === packageId)!.terms[0];
    return t;
  }

  function addOnInput(id: string) {
    const a = store.catalogue().addOns.find((x) => x.id === id)!;
    const t = a.terms[0];
    return { id, name: a.name, description: a.description, kind: a.kind, features: a.features, storageGb: a.storageGb, allowQuantity: a.allowQuantity, status: a.status, effectiveFrom: day(0), price: t.price, frequency: t.frequency, priceStatus: t.priceStatus, usageAllowance: t.usageAllowance, reason: '' };
  }
});
