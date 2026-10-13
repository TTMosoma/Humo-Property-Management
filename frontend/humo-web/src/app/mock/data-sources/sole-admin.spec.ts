import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { AccountRequestDataSource, ApiError, HumoTeamDataSource, SOLE_ADMIN_COOLING_OFF_HOURS, activeAssignments, isSoleSystemAdmin } from '../../domain';
import { AccessStore } from '../db/access-store';
import { AccountRequestStore } from '../db/account-request-store';
import { HumoTeamStore } from '../db/humo-team-store';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';

/**
 * Sole-administrator safeguard (docs/16 §2a): with one System Administrator,
 * two-person rules would lock the platform. They relax only while there's
 * exactly one, and the self-confirmation waits out a cooling-off period.
 */
describe('Sole System Administrator safeguard', () => {
  let auth: MockAuthSession;
  let team: HumoTeamDataSource;
  let access: AccessStore;
  let pending: HumoTeamStore;
  const run = <T>(o: Observable<T>) => firstValueFrom(o);
  const stepUp = () => auth.recordProof({ verified: true, method: 'passkey', device: 'Test', at: new Date().toISOString() });
  const isAdmin = (id: string) => activeAssignments(access.identity(id)!).some((a) => a.role === 'system-admin');
  const HOUR = 3_600_000;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T08:00:00+02:00'));
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    team = TestBed.inject(HumoTeamDataSource);
    access = TestBed.inject(AccessStore);
    pending = TestBed.inject(HumoTeamStore);
    // Launch day: Terry is the only System Administrator (Nomsa's admin role ends).
    auth.signIn('p-terry');
    stepUp();
    await run(team.act('p-nomsa', { type: 'end-role', assignmentId: 'm-nomsa-admin', reason: 'Launch set-up: one administrator' }));
    expect(isSoleSystemAdmin(access.identities(), 'p-terry')).toBe(true);
  });

  afterEach(() => vi.useRealTimers());

  it('lets the sole administrator confirm their own request only after the cooling-off period', async () => {
    await run(team.act('p-lerato', { type: 'grant-role', role: 'system-admin', label: 'Platform operations', reason: 'Second administrator for launch' }));
    const grant = pending.pending()[0];
    // The rest of the Humo team is told at once.
    const told = TestBed.inject(AccountRequestStore).notices().filter((n) => n.title.includes('make Lerato Dube a System Administrator'));
    expect(told.map((n) => ('identityId' in n.to ? n.to.identityId : '')).sort()).toContain('p-nomsa');

    await expect(run(team.act('p-lerato', { type: 'approve-grant', grantId: grant.id }))).rejects.toBeInstanceOf(ApiError);
    expect(isAdmin('p-lerato')).toBe(false);

    vi.setSystemTime(Date.now() + (SOLE_ADMIN_COOLING_OFF_HOURS + 1) * HOUR);
    stepUp();
    await run(team.act('p-lerato', { type: 'approve-grant', grantId: grant.id }));
    expect(isAdmin('p-lerato')).toBe(true);
    expect(access.audit()[0].action).toContain('confirmed by the sole System Administrator');
  });

  it('switches itself off once there are two administrators', async () => {
    await run(team.act('p-lerato', { type: 'grant-role', role: 'system-admin', label: 'Platform operations', reason: 'Second administrator for launch' }));
    vi.setSystemTime(Date.now() + (SOLE_ADMIN_COOLING_OFF_HOURS + 1) * HOUR);
    stepUp();
    await run(team.act('p-lerato', { type: 'approve-grant', grantId: pending.pending()[0].id }));

    // Now two: Terry's next request needs Lerato, however long he waits.
    await run(team.act('p-dumisani', { type: 'grant-role', role: 'system-admin', label: 'Cover', reason: 'Third administrator for cover' }));
    vi.setSystemTime(Date.now() + 72 * HOUR);
    stepUp();
    await expect(run(team.act('p-dumisani', { type: 'approve-grant', grantId: pending.pending()[0].id }))).rejects.toBeInstanceOf(ApiError);
  });

  it('lets the sole administrator decide a new customer account they submitted themselves', async () => {
    const accounts = TestBed.inject(AccountRequestDataSource);
    const submitted = await run(accounts.submit({ name: 'Karoo Estates (Pty) Ltd', shortName: 'Karoo Estates', city: 'Graaff-Reinet', province: 'Eastern Cape', packageId: 'essentials', accountManagerId: 'am-mashoto' }));
    stepUp();
    await run(accounts.decide(submitted.requestId, { type: 'approve' }));
    expect((await run(accounts.get(submitted.requestId)))!.request.status).toBe('approved');
    expect(access.audit()[0].action).toContain('decided by the sole System Administrator');
  });
});
