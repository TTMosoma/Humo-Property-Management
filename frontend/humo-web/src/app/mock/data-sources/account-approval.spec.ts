import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import {
  AccessDataSource,
  AccountRequestDataSource,
  ApiError,
  HumoTeamDataSource,
  NewAccountDetails,
  NotificationDataSource,
  OrganisationDataSource,
  PolicyError,
  activeAssignments,
} from '../../domain';
import { AccessStore } from '../db/access-store';
import { AccountRequestStore } from '../db/account-request-store';
import { OrganisationStore } from '../db/organisation-store';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';

/**
 * New customer accounts (docs/21): approval required by default, delegated
 * activation for Account Managers granted it individually. These run against
 * the in-memory "API" — the rules a real backend must also enforce.
 */
describe('Account creation and approval', () => {
  let auth: MockAuthSession;
  let requests: AccountRequestDataSource;
  let team: HumoTeamDataSource;
  let access: AccessStore;
  let orgs: OrganisationStore;
  let store: AccountRequestStore;

  const run = <T>(o: Observable<T>) => firstValueFrom(o);
  const DELEGATED = 'Platform.Customers.ActivateWithoutApproval';

  let seq = 0;
  const details = (over: Partial<NewAccountDetails> = {}): NewAccountDetails => {
    seq++;
    return { name: `Test Agency ${seq} (Pty) Ltd`, shortName: `Test Agency ${seq}`, city: 'Pretoria', province: 'Gauteng', packageId: 'professional', accountManagerId: 'p-dumisani', ...over };
  };

  /** Sign in as someone, working in the given role. */
  const as = (identityId: string, role?: string) => {
    auth.signIn(identityId);
    if (role) {
      const a = activeAssignments(access.identity(identityId)!).find((x) => x.role === role)!;
      expect(auth.switchAssignment(a.id)).toBe(true);
    }
  };
  /** A fresh passkey proof, as the step-up dialog would record. */
  const stepUp = () => auth.recordProof({ verified: true, method: 'passkey', device: 'Test', at: new Date().toISOString() });

  const setDelegation = async (identityId: string, allowed: boolean) => {
    as('p-terry', 'system-admin');
    stepUp();
    await run(team.act(identityId, { type: 'set-delegated-activation', allowed, reason: 'Test of delegation' }));
  };

  const auditActions = () => access.audit().map((e) => e.action);

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    requests = TestBed.inject(AccountRequestDataSource);
    team = TestBed.inject(HumoTeamDataSource);
    access = TestBed.inject(AccessStore);
    orgs = TestBed.inject(OrganisationStore);
    store = TestBed.inject(AccountRequestStore);
  });

  it('1. a standard Account Manager submits an account for approval', async () => {
    as('p-dumisani');
    const r = await run(requests.submit(details()));
    expect(r.outcome).toBe('pending');
    expect(r.organisationId).toBeUndefined();
    expect(store.get(r.requestId)?.status).toBe('pending');
    expect(auditActions()[0]).toContain('for approval');
  });

  it('2. a standard Account Manager cannot activate without approval, or approve', async () => {
    as('p-dumisani');
    const before = orgs.all().length;
    const r = await run(requests.submit(details()));
    expect(orgs.all().length).toBe(before);
    await expect(run(requests.decide(r.requestId, { type: 'approve' }))).rejects.toBeInstanceOf(PolicyError);
    expect(store.get(r.requestId)?.status).toBe('pending');
  });

  it('3. an Account Manager granted delegated activation activates an eligible account', async () => {
    await setDelegation('p-dumisani', true);
    as('p-dumisani');
    expect(auth.can(DELEGATED)).toBe(true);
    const r = await run(requests.submit(details()));
    expect(r.outcome).toBe('activated');
    expect(orgs.get(r.organisationId)?.status).toBe('onboarding');
    expect(store.get(r.requestId)).toMatchObject({ status: 'approved', route: 'delegated', decidedById: 'p-dumisani' });
  });

  it('4. System Administrators get an in-app notification for a delegated activation', async () => {
    await setDelegation('p-dumisani', true);
    as('p-dumisani');
    const d = details();
    await run(requests.submit(d));
    as('p-nomsa', 'system-admin');
    const notes = await run(TestBed.inject(NotificationDataSource).list());
    expect(notes.some((n) => n.kind === 'platform' && n.title.includes('delegated authority') && n.title.includes(d.shortName))).toBe(true);
    // The person who acted isn't notified about their own action.
    as('p-dumisani');
    const own = await run(TestBed.inject(NotificationDataSource).list());
    expect(own.some((n) => n.title.includes(d.shortName))).toBe(false);
  });

  it('5. a delegated activation is audited with its authorisation basis', async () => {
    await setDelegation('p-dumisani', true);
    as('p-dumisani');
    const d = details();
    await run(requests.submit(d));
    const event = access.audit().find((e) => e.action.includes(d.shortName));
    expect(event?.result).toBe('success');
    expect(event?.actor.name).toBe('Dumisani Ngcobo');
    expect(event?.action).toContain('under delegated authority');
    expect(event?.action).toContain(DELEGATED);
  });

  it('6. Humo Support cannot create or activate accounts', async () => {
    as('p-lerato');
    expect(auth.can(DELEGATED)).toBe(false);
    expect(auth.can('Platform.Customers.Manage')).toBe(false);
    await expect(run(requests.submit(details()))).rejects.toBeInstanceOf(PolicyError);
  });

  it('7. nobody can grant themselves delegated authority, and only System Administrators can grant it', async () => {
    // Dumisani (Account Manager) on himself: no Platform.ManageHumoRoles.
    as('p-dumisani');
    stepUp();
    await expect(run(team.act('p-dumisani', { type: 'set-delegated-activation', allowed: true, reason: 'I would like it' }))).rejects.toBeInstanceOf(PolicyError);
    // A System Administrator can't change their own access either.
    as('p-nomsa', 'system-admin');
    stepUp();
    await expect(run(team.act('p-nomsa', { type: 'set-delegated-activation', allowed: true, reason: 'Granting myself' }))).rejects.toBeInstanceOf(ApiError);
    // Only Account Managers can hold it.
    as('p-terry', 'system-admin');
    stepUp();
    await expect(run(team.act('p-lerato', { type: 'set-delegated-activation', allowed: true, reason: 'Support should not' }))).rejects.toBeInstanceOf(ApiError);
  });

  it('8. a System Administrator grants and revokes delegated authority, audited both ways', async () => {
    await setDelegation('p-dumisani', true);
    expect((await run(team.get('p-dumisani')))?.canActivateWithoutApproval).toBe(true);
    await setDelegation('p-dumisani', false);
    expect((await run(team.get('p-dumisani')))?.canActivateWithoutApproval).toBe(false);
    expect(auditActions().filter((a) => a.includes('delegated account activation')).slice(0, 2)).toEqual([
      expect.stringContaining('Revoked'),
      expect.stringContaining('Granted'),
    ]);
  });

  it('9. revoked authority (or a policy requiring approval for all) is not used for later accounts', async () => {
    await setDelegation('p-dumisani', true);
    await setDelegation('p-dumisani', false);
    as('p-dumisani');
    expect((await run(requests.submit(details()))).outcome).toBe('pending');

    // With the grant back but the policy at "approval for all", it still waits.
    await setDelegation('p-dumisani', true);
    as('p-terry', 'system-admin');
    stepUp();
    await run(requests.setPolicy('approval-for-all', 'Pause delegation for the audit', (await run(requests.policy())).version));
    expect((await run(requests.policy())).policy).toBe('approval-for-all');
    as('p-dumisani');
    expect((await run(requests.submit(details()))).outcome).toBe('pending');
  });

  it('10. approval and rejection are recorded, by someone other than the submitter', async () => {
    as('p-dumisani');
    const a = await run(requests.submit(details()));
    const b = await run(requests.submit(details()));

    as('p-terry', 'system-admin');
    await run(requests.decide(a.requestId, { type: 'approve' }));
    await expect(run(requests.decide(b.requestId, { type: 'reject', reason: 'no' }))).rejects.toBeInstanceOf(ApiError); // reason too short
    await run(requests.decide(b.requestId, { type: 'reject', reason: 'Duplicate of an existing trial' }));

    expect(store.get(a.requestId)).toMatchObject({ status: 'approved', route: 'approval', decidedBy: 'Terry Mosoma' });
    expect(orgs.get(store.get(a.requestId)!.organisationId)?.status).toBe('onboarding');
    expect(store.get(b.requestId)).toMatchObject({ status: 'rejected', reason: 'Duplicate of an existing trial' });
    expect(auditActions().some((x) => x.startsWith('Approved new customer account'))).toBe(true);
    expect(auditActions().some((x) => x.startsWith('Rejected new customer account'))).toBe(true);

    // A System Administrator can't approve their own request.
    const own = await run(requests.submit(details()));
    await expect(run(requests.decide(own.requestId, { type: 'approve' }))).rejects.toBeInstanceOf(ApiError);
    // Decided requests can't be decided again.
    as('p-nomsa', 'system-admin');
    await expect(run(requests.decide(a.requestId, { type: 'reject', reason: 'Changed my mind' }))).rejects.toBeInstanceOf(ApiError);
  });

  it('11. pending and rejected requests never create an organisation', async () => {
    as('p-dumisani');
    const d = details();
    const before = orgs.all().length;
    const r = await run(requests.submit(d));
    as('p-terry', 'system-admin');
    await run(requests.decide(r.requestId, { type: 'reject', reason: 'Not a managing agent' }));
    expect(orgs.all().length).toBe(before);
    expect(orgs.all().some((o) => o.shortName === d.shortName)).toBe(false);
    expect(store.get(r.requestId)?.organisationId).toBeUndefined();
    // And the duplicate check: a waiting request blocks a second one for the same customer.
    as('p-dumisani');
    const dup = details();
    await run(requests.submit(dup));
    await expect(run(requests.submit({ ...dup }))).rejects.toBeInstanceOf(ApiError);
  });

  it('12. activating an organisation creates no users or invitations', async () => {
    const identitiesBefore = access.identities().length;
    await setDelegation('p-dumisani', true);
    as('p-dumisani');
    const r = await run(requests.submit(details()));
    expect(access.identities().length).toBe(identitiesBefore);
    expect(access.identities().some((i) => i.assignments.some((a) => a.scope.organisationId === r.organisationId))).toBe(false);
    expect(orgs.get(r.organisationId)?.status).toBe('onboarding');
  });

  it('13. existing Humo team and agency access management still work', async () => {
    // Humo team: impersonation grant (unchanged).
    as('p-terry', 'system-admin');
    stepUp();
    await run(team.act('p-nomsa', { type: 'set-impersonation', allowed: true, reason: 'Covering support rota' }));
    expect((await run(team.get('p-nomsa')))?.canImpersonate).toBe(true);
    // Agency: editing an organisation's details (unchanged).
    const org = orgs.get('acacia')!;
    await run(TestBed.inject(OrganisationDataSource).update('acacia', { name: org.name, shortName: org.shortName, city: 'Sandton', province: org.province }, org.version));
    expect(orgs.get('acacia')?.city).toBe('Sandton');
    // Agency: an Agency Administrator invites a staff member (unchanged).
    as('p-thandeka');
    stepUp();
    const id = await run(
      TestBed.inject(AccessDataSource).invite({
        organisationId: 'acacia',
        name: 'Test Person',
        email: 'test.person@acacia-ma.example',
        assignment: { role: 'finance', scope: { type: 'organisation', organisationId: 'acacia', schemeIds: [] }, label: 'Acacia Managing Agents' },
      }),
    );
    expect(access.identity(id)?.status).toBe('invited');
  });
});
