import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiError, BillingDataSource, LevyDataSource, UnitDataSource, derivedLevy } from '../../domain';
import { AccessStore } from '../db/access-store';
import { BillingStore } from '../db/billing-store';
import { MockDb } from '../db/mock-db';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';

describe('Levy model per scheme (D13, docs/22 §3)', () => {
  let auth: MockAuthSession;
  let levies: LevyDataSource;
  let billing: BillingDataSource;
  let billingStore: BillingStore;
  let db: MockDb;
  let access: AccessStore;
  const run = <T>(o: Observable<T>) => firstValueFrom(o);
  const KC = 'kingfisher-court';

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    levies = TestBed.inject(LevyDataSource);
    billing = TestBed.inject(BillingDataSource);
    billingStore = TestBed.inject(BillingStore);
    db = TestBed.inject(MockDb);
    access = TestBed.inject(AccessStore);
    auth.signIn('p-thandeka'); // Agency Administrator: Billing.Run and Units.Manage
  });

  const useBudget = async () => {
    const st = await run(levies.setting(KC));
    await run(levies.setMethod(KC, 'budget', 'Board resolved to bill by quota', st.version));
  };

  it('derives a levy as annual levies × normalised quota ÷ 12, to the cent', () => {
    expect(derivedLevy(1_200_000, 2.5, 100)).toBe(2500);
    expect(derivedLevy(1_000_000, 1, 3)).toBe(27777.78);
    expect(derivedLevy(1000, 1, 0)).toBe(0);
  });

  it('is manual by default; changing the method needs a reason and is audited', async () => {
    const st = await run(levies.setting(KC));
    expect(st.method).toBe('manual');
    await expect(run(levies.setMethod(KC, 'budget', 'no', st.version))).rejects.toBeInstanceOf(ApiError);
    await useBudget();
    expect((await run(levies.setting(KC))).method).toBe('budget');
    expect(access.audit()[0].action).toContain('Derived from the approved budget');
  });

  it('proposes a roll from the approved budget that adds up to the budget, from the next run', async () => {
    const p = (await run(levies.proposal(KC)))!;
    expect(p.rows.length).toBeGreaterThan(10);
    expect(Math.abs(p.roundingDifference)).toBeLessThan(p.rows.length * 0.01);
    expect(p.proposedRoll).toBeCloseTo(p.budgetMonthly, 0);
    expect(p.fromPeriod).toBe((await run(billing.status([KC])))[0].nextPeriod);
    expect(p.blocked).toBeUndefined();
  });

  it('applies only with the budget method and no run in progress; then the next run flags each change', async () => {
    let p = (await run(levies.proposal(KC)))!;
    await expect(run(levies.apply(KC, p.budgetId, 'Apply the AGM budget', 0))).rejects.toBeInstanceOf(ApiError); // still manual

    await useBudget();
    // A run in progress blocks it.
    const runId = await run(billing.create({ schemeId: KC, period: p.fromPeriod }));
    p = (await run(levies.proposal(KC)))!;
    expect(p.blocked).toContain('in progress');
    await expect(run(levies.apply(KC, p.budgetId, 'Apply the AGM budget', (await run(levies.setting(KC))).version))).rejects.toBeInstanceOf(ApiError);
    await run(billing.act(runId, { type: 'cancel', reason: 'Re-run after the levy roll' }, billingStore.runs.find((r) => r.id === runId)!.version));

    p = (await run(levies.proposal(KC)))!;
    const changing = p.rows.filter((r) => Math.abs(r.change) >= 0.005);
    const n = await run(levies.apply(KC, p.budgetId, 'Apply the AGM budget', (await run(levies.setting(KC))).version));
    expect(n).toBe(changing.length);
    for (const r of p.rows) expect(db.unitById.get(r.unitId)!.monthlyLevy).toBe(r.proposed);
    expect(access.audit()[0].action).toContain('Applied the');
    expect((await run(levies.setting(KC))).applied).toMatchObject({ budgetId: p.budgetId, units: n });

    if (changing.length) {
      const next = await run(billing.create({ schemeId: KC, period: p.fromPeriod }));
      const created = billingStore.runs.find((r) => r.id === next)!;
      expect(created.exceptions.some((x) => x.kind === 'levy-changed' && x.accountNo === changing[0].accountNo)).toBe(true);
    }
  });

  it('blocks editing a unit’s levy by hand in a budget scheme, but not in a manual one', async () => {
    const units = TestBed.inject(UnitDataSource);
    const u = db.units.find((x) => x.schemeId === KC)!;
    const details = { number: u.number, block: u.block, description: u.description, sizeM2: u.sizeM2, participationQuota: u.participationQuota, monthlyLevy: u.monthlyLevy + 100, occupancy: u.occupancy };
    await run(units.update(u.id, details, u.version)); // manual: fine
    expect(db.unitById.get(u.id)!.monthlyLevy).toBe(details.monthlyLevy);
    await useBudget();
    const now = db.unitById.get(u.id)!;
    await expect(run(units.update(u.id, { ...details, monthlyLevy: now.monthlyLevy + 50 }, now.version))).rejects.toBeInstanceOf(ApiError);
    // Other details can still change.
    await run(units.update(u.id, { ...details, monthlyLevy: now.monthlyLevy, description: 'Corner unit' }, now.version));
    expect(db.unitById.get(u.id)!.description).toBe('Corner unit');
  });

  it('switching back to manual keeps the current levies', async () => {
    await useBudget();
    const p = (await run(levies.proposal(KC)))!;
    await run(levies.apply(KC, p.budgetId, 'Apply the AGM budget', (await run(levies.setting(KC))).version));
    const before = db.units.filter((u) => u.schemeId === KC).map((u) => u.monthlyLevy);
    await run(levies.setMethod(KC, 'manual', 'Back to entered levies', (await run(levies.setting(KC))).version));
    expect(db.units.filter((u) => u.schemeId === KC).map((u) => u.monthlyLevy)).toEqual(before);
  });
});
