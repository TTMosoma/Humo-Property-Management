import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { AccessDataSource, ApiError, PolicyError, SchemeDataSource } from '../../domain';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { AccessStore } from '../db/access-store';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

/**
 * D1: scope follows the assignment. Seeing the rest of the agency is an
 * individual, read-only grant (Portfolio.BrowseAgency); changes stay limited
 * to the assignment's schemes, whatever someone may browse.
 */
describe('Scheme scope by assignment (D1)', () => {
  let auth: MockAuthSession;
  let gateway: MockGateway;
  const run = <T>(o: Observable<T>) => firstValueFrom(o);
  const stepUp = () => auth.recordProof({ verified: true, method: 'passkey', device: 'Test', at: new Date().toISOString() });
  const change = (schemeId: string) => run(gateway.command({ action: 'Changed something', schemeId }, () => 'done'));
  /** Lets the shell's scheme list load. */
  const settle = async () => {
    TestBed.inject(ScopeService);
    TestBed.tick();
    await run(TestBed.inject(SchemeDataSource).list());
    await new Promise((r) => setTimeout(r, 20));
    TestBed.tick();
  };

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    gateway = TestBed.inject(MockGateway);
  });

  it('refuses a change to a scheme outside the assignment, and audits it', async () => {
    auth.signIn('p-johan'); // Portfolio Manager, 8 schemes including Kingfisher Court
    expect(await change('kingfisher-court')).toBe('done');
    await expect(change('protea-gardens')).rejects.toMatchObject({ code: 'out-of-scope' });
    expect(TestBed.inject(AccessStore).audit()[0]).toMatchObject({ result: 'denied' });
  });

  it('a portfolio manager no longer sees every scheme just for being a portfolio manager', async () => {
    auth.signIn('p-johan');
    await settle();
    const scope = TestBed.inject(ScopeService);
    expect(TestBed.inject(SessionService).can('Portfolio.BrowseAgency')).toBe(false);
    expect(scope.browsable()).toEqual([]);
    expect(scope.accessible().length).toBe(8);
  });

  it('with the grant, the rest of the agency is browsable, read-only', async () => {
    auth.signIn('p-sarah');
    auth.switchAssignment('m-sarah-pm'); // Operations Director: 3 schemes, plus the grant
    await settle();
    const scope = TestBed.inject(ScopeService);
    expect(scope.accessible().map((s) => s.id).sort()).toEqual(['greenstone-commons', 'parkhurst-lofts', 'protea-gardens']);
    expect(scope.isBrowsing('kingfisher-court')).toBe(true);
    expect(scope.isBrowsing('protea-gardens')).toBe(false);
    await expect(change('kingfisher-court')).rejects.toBeInstanceOf(PolicyError);
    expect(await change('protea-gardens')).toBe('done');
  });

  it('an Agency Administrator grants and withdraws it, on scheme-limited staff roles only', async () => {
    const access = TestBed.inject(AccessDataSource);
    const store = TestBed.inject(AccessStore);
    const johan = () => store.identity('p-johan')!.assignments.find((a) => a.id === 'm-johan')!;
    auth.signIn('p-thandeka');
    stepUp();
    await run(access.setBrowseAgency('p-johan', 'm-johan', true, johan().version));
    expect(johan().grants).toContain('Portfolio.BrowseAgency');
    await run(access.setBrowseAgency('p-johan', 'm-johan', false, johan().version));
    expect(johan().grants ?? []).not.toContain('Portfolio.BrowseAgency');

    // Not for a role that already covers every scheme.
    const sarahFinance = store.identity('p-sarah')!.assignments.find((a) => a.id === 'm-sarah-finance')!;
    await expect(run(access.setBrowseAgency('p-sarah', 'm-sarah-finance', true, sarahFinance.version))).rejects.toBeInstanceOf(ApiError);

    // Nobody grants it to themselves.
    auth.signIn('p-sarah');
    auth.switchAssignment('m-sarah-admin');
    stepUp();
    const own = store.identity('p-sarah')!.assignments.find((a) => a.id === 'm-sarah-pm')!;
    await expect(run(access.setBrowseAgency('p-sarah', 'm-sarah-pm', false, own.version))).rejects.toBeInstanceOf(PolicyError);
  });
});
