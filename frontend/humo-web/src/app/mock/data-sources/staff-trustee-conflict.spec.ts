import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { WorkItemDataSource, agencyConflict } from '../../domain';
import { AccessStore } from '../db/access-store';
import { MockDb } from '../db/mock-db';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';

/**
 * D6: staff may also be trustees, but as a trustee they can't approve their
 * own agency's work at that scheme. The API refuses and audits the attempt;
 * another trustee approves. Sarah Jacobs works for Acacia and is a trustee of
 * Kingfisher Court; Sipho Khumalo is a trustee there and doesn't work for Acacia.
 */
describe('Staff who are trustees (D6)', () => {
  let auth: MockAuthSession;
  let work: WorkItemDataSource;
  const run = <T>(o: Observable<T>) => firstValueFrom(o, { defaultValue: undefined as T });
  /** MR-1051: a Kingfisher Court quote (R24 300, no step-up), approved by trustees or staff. */
  const QUOTE = 'w15';
  const item = () => TestBed.inject(MockDb).workItems.find((w) => w.id === QUOTE)!;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    work = TestBed.inject(WorkItemDataSource);
  });

  it('refuses a staff trustee’s approval of their agency’s quote, and audits it', async () => {
    auth.signIn('p-sarah');
    auth.switchAssignment('m-sarah-trustee');
    expect(agencyConflict(auth.current.identity, auth.assignment())).toBe(true);
    await expect(run(work.decide(QUOTE, 'approved', 'Sarah Jacobs'))).rejects.toMatchObject({ code: 'conflict-of-interest' });
    expect(item().status).toBe('open');
    expect(TestBed.inject(AccessStore).audit()[0]).toMatchObject({ result: 'denied', role: 'trustee', action: 'Approved quote' });
  });

  it('lets them reject it', async () => {
    auth.signIn('p-sarah');
    auth.switchAssignment('m-sarah-trustee');
    await run(work.decide(QUOTE, 'rejected', 'Sarah Jacobs', 'Get a second quote'));
    expect(item().status).toBe('rejected');
  });

  it('another trustee approves it', async () => {
    auth.signIn('p-sipho');
    auth.switchAssignment('m-sipho-trustee');
    expect(agencyConflict(auth.current.identity, auth.assignment())).toBe(false);
    await run(work.decide(QUOTE, 'approved', 'Sipho Khumalo'));
    expect(item().status).toBe('approved');
  });

  it('doesn’t limit the same person in their staff role', async () => {
    auth.signIn('p-sarah');
    auth.switchAssignment('m-sarah-admin');
    expect(agencyConflict(auth.current.identity, auth.assignment())).toBe(false);
    await run(work.decide(QUOTE, 'approved', 'Sarah Jacobs'));
    expect(item().status).toBe('approved');
  });
});
