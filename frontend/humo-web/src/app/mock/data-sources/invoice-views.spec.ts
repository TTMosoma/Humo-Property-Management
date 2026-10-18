import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { CommercialDataSource, PlanDataSource, PolicyError } from '../../domain';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';

/** Platform › Invoices for Humo staff; Settings › Billing & invoices for a customer's administrators. */
describe('Invoice views', () => {
  let auth: MockAuthSession;
  let humo: CommercialDataSource;
  let plan: PlanDataSource;
  const run = <T>(o: Observable<T>) => firstValueFrom(o);

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    humo = TestBed.inject(CommercialDataSource);
    plan = TestBed.inject(PlanDataSource);
  });

  it('lists every customer’s invoices for Humo staff who see revenue, newest first', async () => {
    auth.signIn('am-mashoto');
    const rows = await run(humo.invoices());
    expect(rows.length).toBe(8);
    expect(new Set(rows.map((r) => r.customerName))).toEqual(new Set(['Marula Property', 'Acacia Managing Agents', 'Umgeni BC Services', 'Fynbos Property Admin']));
    expect(rows[0].issuedOn >= rows.at(-1)!.issuedOn).toBe(true);
    const fynbos = rows.find((r) => r.id === 'inv-fynbos-202610')!;
    expect(fynbos).toMatchObject({ billingPreference: 'manual-eft', accountManager: 'Mashoto Moropane' });
    expect(['issued', 'overdue']).toContain(fynbos.status);

    auth.signIn('p-lerato'); // Support: no revenue
    await expect(run(humo.invoices())).rejects.toBeInstanceOf(PolicyError);
  });

  it('opens an invoice as a document with the amount still owed', async () => {
    auth.signIn('p-terry');
    const d = (await run(humo.invoice('inv-fynbos-202610')))!;
    expect(d.billTo).toMatchObject({ organisationId: 'fynbos', billingEmail: 'annette@fynbos-pa.example' });
    expect(d.balance).toBe(4_200); // proof of payment isn't payment
    expect(d.payments).toEqual([expect.objectContaining({ status: 'pending-verification', method: 'manual-eft', amount: 4_200, simulated: true })]);
    expect(d.from.vatRegistered).toBe(false);
  });

  it('shows a customer administrator their own invoices, without Humo’s internal notes', async () => {
    auth.signIn('p-thandeka'); // Acacia, Agency Administrator
    const docs = await run(plan.invoices('acacia'));
    expect(docs.map((d) => d.invoice.reference)).toEqual(['HPM-ACA-202610', 'HPM-ACA-202609']);
    expect(docs[0].balance).toBe(0);
    for (const p of docs.flatMap((d) => d.payments)) expect(Object.keys(p).sort()).toEqual(['amount', 'method', 'on', 'simulated', 'status']);
  });

  it('never shows a customer another customer’s invoices', async () => {
    auth.signIn('p-thandeka');
    await expect(run(plan.invoices('fynbos'))).rejects.toBeInstanceOf(PolicyError);
    expect(await run(plan.invoice('acacia', 'inv-fynbos-202610'))).toBeUndefined();
    expect((await run(plan.invoice('acacia', 'inv-acacia-202610')))!.invoice.total).toBe(17_400);
  });

  it('is for the agency’s administrators, not all staff', async () => {
    auth.signIn('p-priya'); // Acacia, Finance: no Subscription.Request
    await expect(run(plan.invoices('acacia'))).rejects.toBeInstanceOf(PolicyError);
  });
});
