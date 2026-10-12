import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiError, PlatformDataSource, PolicyError, activeAssignments } from '../../domain';
import { AccessStore } from '../db/access-store';
import { PlatformStore } from '../db/platform-store';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';

/**
 * D11: Account Managers change their own customers' subscriptions without
 * approval. Every change needs a reason and is audited; refusals too.
 */
describe('Subscription changes by Account Managers (D11)', () => {
  let auth: MockAuthSession;
  let platform: PlatformDataSource;
  let store: PlatformStore;
  let access: AccessStore;
  const run = <T>(o: Observable<T>) => firstValueFrom(o);
  const stepUp = () => auth.recordProof({ verified: true, method: 'passkey', device: 'Test', at: new Date().toISOString() });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    platform = TestBed.inject(PlatformDataSource);
    store = TestBed.inject(PlatformStore);
    access = TestBed.inject(AccessStore);
    auth.signIn('p-dumisani');
    expect(activeAssignments(access.identity('p-dumisani')!).some((a) => a.role === 'humo-account-manager')).toBe(true);
  });

  const mine = () => store.seeds().find((c) => c.accountManagerId === 'p-dumisani')!;
  const theirs = () => store.seeds().find((c) => c.accountManagerId !== 'p-dumisani')!;

  it('changes their own customer’s subscription without approval, audited with the reason', async () => {
    const c = mine();
    const enabled = !c.subscription.addOns.some((a) => a.addOnId === 'governance');
    stepUp();
    await run(platform.changeSubscription(c.organisationId, { type: 'add-on', addOnId: 'governance', enabled, reason: 'Agreed at the quarterly review' }, c.subscription.version));
    expect(store.seeds().find((x) => x.organisationId === c.organisationId)!.subscription.version).toBe(c.subscription.version + 1);
    const event = access.audit()[0];
    expect(event).toMatchObject({ result: 'success', resource: 'Subscription', resourceId: c.organisationId });
    expect(event.actor.name).toBe('Dumisani Ngcobo');
    expect(event.action).toContain('Agreed at the quarterly review');
  });

  it('refuses a change without a reason', async () => {
    const c = mine();
    stepUp();
    await expect(run(platform.changeSubscription(c.organisationId, { type: 'package', packageId: 'enterprise', reason: 'ok' }, c.subscription.version))).rejects.toBeInstanceOf(ApiError);
    expect(store.seeds().find((x) => x.organisationId === c.organisationId)!.subscription.version).toBe(c.subscription.version);
  });

  it('refuses, and audits, a change to another Account Manager’s customer', async () => {
    const c = theirs();
    stepUp();
    await expect(run(platform.changeSubscription(c.organisationId, { type: 'package', packageId: 'enterprise', reason: 'Trying someone else’s account' }, c.subscription.version))).rejects.toBeInstanceOf(PolicyError);
    expect(access.audit()[0]).toMatchObject({ result: 'denied', resourceId: c.organisationId });
  });
});
