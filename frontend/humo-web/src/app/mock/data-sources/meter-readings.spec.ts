import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiError, BillingDataSource, MeterDataSource, parseReadingsCsv } from '../../domain';
import { AccessStore } from '../db/access-store';
import { BillingStore } from '../db/billing-store';
import { DEFAULT_RATE_PER_KL, MeterStore } from '../db/meter-store';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';

describe('Meter readings (docs/22 §2)', () => {
  let auth: MockAuthSession;
  let meters: MeterDataSource;
  let billing: BillingDataSource;
  let billingStore: BillingStore;
  let meterStore: MeterStore;
  let access: AccessStore;
  const run = <T>(o: Observable<T>) => firstValueFrom(o);
  const KC = 'kingfisher-court';
  const today = new Date().toISOString().slice(0, 10);
  let period: string;

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    meters = TestBed.inject(MeterDataSource);
    billing = TestBed.inject(BillingDataSource);
    billingStore = TestBed.inject(BillingStore);
    meterStore = TestBed.inject(MeterStore);
    access = TestBed.inject(AccessStore);
    auth.signIn('p-priya');
    period = (await run(billing.status([KC])))[0].nextPeriod;
  });

  const sheet = () => run(meters.sheet(KC, period));
  /** Each unit reads its usual consumption above last month, except where overridden. */
  const usualEntries = async (over: Record<string, number> = {}) =>
    (await sheet()).rows.map((r) => ({ unitNumber: r.unitNumber, reading: over[r.unitNumber] ?? Math.round((r.previous!.reading + (r.usual ?? 10)) * 100) / 100 }));

  it('reads the CSV format: Unit and Reading columns', () => {
    const { entries, problems } = parseReadingsCsv('Unit,Reading\nUnit 12,1043.5\n14,abc\n');
    expect(entries).toEqual([{ unitNumber: '12', reading: 1043.5 }]);
    expect(problems[0].problem).toContain('isn’t a reading');
  });

  it('shows each unit with its last reading and usual use, and saves readings (audited)', async () => {
    const s = await sheet();
    expect(s.rows.length).toBeGreaterThan(10);
    expect(s.rows.every((r) => r.previous && r.usual !== undefined)).toBe(true);
    expect(s.setting.ratePerKl).toBe(DEFAULT_RATE_PER_KL);
    const first = s.rows[0];
    await run(meters.saveReadings(KC, period, today, [{ unitNumber: first.unitNumber, reading: first.previous!.reading + 12 }]));
    const after = (await sheet()).rows[0];
    expect(after.consumption).toBe(12);
    expect(access.audit()[0].action).toContain('Captured 1 water meter reading');
  });

  it('refuses a reading lower than the last, an unknown unit, and a non-water scheme', async () => {
    const r = (await sheet()).rows[0];
    await expect(run(meters.saveReadings(KC, period, today, [{ unitNumber: r.unitNumber, reading: r.previous!.reading - 1 }]))).rejects.toBeInstanceOf(ApiError);
    await expect(run(meters.saveReadings(KC, period, today, [{ unitNumber: '9999', reading: 10 }]))).rejects.toBeInstanceOf(ApiError);
    await expect(run(meters.saveReadings('waterkloof-ridge', period, today, [{ unitNumber: '1', reading: 10 }]))).rejects.toBeInstanceOf(ApiError);
  });

  it('a run prepared after readings bills consumption × rate, estimates and flags the rest', async () => {
    const s = await sheet();
    const missing = s.rows[0];
    const spike = s.rows[1];
    const entries = (await usualEntries({ [spike.unitNumber]: spike.previous!.reading + 10 * (spike.usual ?? 10) })).filter((e) => e.unitNumber !== missing.unitNumber);
    await run(meters.saveReadings(KC, period, today, entries));
    const id = await run(billing.create({ schemeId: KC, period }));
    const r = billingStore.runs.find((x) => x.id === id)!;
    const normal = r.lines.find((l) => l.unitNumber === s.rows[2].unitNumber)!.charges.find((c) => c.kind === 'utility')!;
    expect(normal.amount).toBeCloseTo((s.rows[2].usual ?? 10) * DEFAULT_RATE_PER_KL, 1);
    expect(normal.description).toContain('kl at');
    expect(r.exceptions.some((x) => x.kind === 'meter-missing' && x.accountNo === missing.accountNo)).toBe(true);
    expect(r.exceptions.some((x) => x.kind === 'unusual-reading' && x.accountNo === spike.accountNo)).toBe(true);
  });

  it('readings saved while the run is Preparing update it; after it leaves Preparing they are refused', async () => {
    const s = await sheet();
    const missing = s.rows[0];
    await run(meters.saveReadings(KC, period, today, (await usualEntries()).filter((e) => e.unitNumber !== missing.unitNumber)));
    const id = await run(billing.create({ schemeId: KC, period }));
    const runNow = () => billingStore.runs.find((x) => x.id === id)!;
    expect(runNow().exceptions.some((x) => x.kind === 'meter-missing' && x.accountNo === missing.accountNo)).toBe(true);

    await run(meters.saveReadings(KC, period, today, [{ unitNumber: missing.unitNumber, reading: missing.previous!.reading + 9 }]));
    expect(runNow().exceptions.some((x) => x.kind === 'meter-missing' && x.accountNo === missing.accountNo)).toBe(false);
    const water = runNow().lines.find((l) => l.unitNumber === missing.unitNumber)!.charges.find((c) => c.kind === 'utility')!;
    expect(water.amount).toBeCloseTo(9 * DEFAULT_RATE_PER_KL, 2);

    // Decide everything and send for approval: now readings for this month are locked.
    for (const x of runNow().exceptions) await run(billing.act(id, { type: 'decide', exceptionId: x.id, decision: x.options[0] }, runNow().version));
    await run(billing.act(id, { type: 'send-for-approval' }, runNow().version));
    await expect(run(meters.saveReadings(KC, period, today, [{ unitNumber: missing.unitNumber, reading: missing.previous!.reading + 20 }]))).rejects.toBeInstanceOf(ApiError);
  });

  it('sets the rate with a reason; the next run uses it', async () => {
    await expect(run(meters.setRate(KC, 50, 'no'))).rejects.toBeInstanceOf(ApiError);
    await run(meters.setRate(KC, 50, 'Municipal increase from 1 November', 0));
    expect(meterStore.setting(KC).ratePerKl).toBe(50);
    const r = (await sheet()).rows[0];
    await run(meters.saveReadings(KC, period, today, [{ unitNumber: r.unitNumber, reading: r.previous!.reading + 10 }]));
    const id = await run(billing.create({ schemeId: KC, period }));
    const line = billingStore.runs.find((x) => x.id === id)!.lines.find((l) => l.unitNumber === r.unitNumber)!;
    expect(line.charges.find((c) => c.kind === 'utility')!.amount).toBe(500);
  });
});
