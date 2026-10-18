import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { AccessDataSource, NewAssignment } from '../../domain';
import { AccessStore } from '../db/access-store';
import { MockDb } from '../db/mock-db';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';

/**
 * D3: Portfolio Managers invite owners, tenants and trustees of their own
 * schemes, from the record (person, unit, board). Staff roles stay with the
 * Agency Administrator. F-22: onboarding invites only the customer's first
 * Agency Administrator.
 */
describe('Inviting residents and trustees (D3, F-22)', () => {
  let auth: MockAuthSession;
  let access: AccessDataSource;
  let db: MockDb;
  const run = <T>(o: Observable<T>) => firstValueFrom(o);
  const stepUp = () => auth.recordProof({ verified: true, method: 'passkey', device: 'Test', at: new Date().toISOString() });
  const as = (identityId: string, assignmentId?: string) => {
    auth.signIn(identityId);
    if (assignmentId) auth.switchAssignment(assignmentId);
    stepUp();
  };
  /** A current owner in the scheme with no Humo sign-in yet. */
  const ownerWithoutSignIn = (schemeId: string) => {
    const r = db.relationshipsIn(schemeId, 'owner').find((x) => db.isCurrent(x) && !db.persons.get(x.personId)!.personaId && x.unitId)!;
    return { person: db.persons.get(r.personId)!, unitId: r.unitId!, schemeId };
  };
  const ownerOf = (o: ReturnType<typeof ownerWithoutSignIn>): NewAssignment => ({
    role: 'owner',
    scope: { type: 'unit', organisationId: 'acacia', schemeIds: [o.schemeId], unitId: o.unitId },
    label: 'Their unit',
  });
  const invite = (o: ReturnType<typeof ownerWithoutSignIn>, assignment: NewAssignment, email = 'invitee@mail.example') =>
    run(access.invite({ organisationId: 'acacia', name: 'Invited Owner', email, personId: o.person.id, assignment }));

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    access = TestBed.inject(AccessDataSource);
    db = TestBed.inject(MockDb);
  });

  it('a Portfolio Manager invites an owner of their scheme, linked to the People record', async () => {
    as('p-johan');
    const o = ownerWithoutSignIn('kingfisher-court');
    const id = await invite(o, ownerOf(o));
    const identity = TestBed.inject(AccessStore).identity(id)!;
    expect(identity.status).toBe('invited');
    expect(identity.personId).toBe(o.person.id);
    expect(db.persons.get(o.person.id)!.personaId).toBe(id);
  });

  it('but not into a scheme outside their assignment (D1)', async () => {
    as('p-johan');
    const o = ownerWithoutSignIn('protea-gardens');
    await expect(invite(o, { ...ownerOf(o), scope: { ...ownerOf(o).scope, schemeIds: ['protea-gardens'] } })).rejects.toMatchObject({ code: 'out-of-scope' });
  });

  it('and not a staff role: that stays with the Agency Administrator', async () => {
    as('p-johan');
    await expect(
      run(
        access.invite({
          organisationId: 'acacia',
          name: 'New Colleague',
          email: 'new.colleague@acacia-ma.example',
          assignment: { role: 'finance', scope: { type: 'organisation', organisationId: 'acacia', schemeIds: [] }, label: 'Acacia' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a trustee invite needs a current board seat (D2)', async () => {
    as('p-johan');
    const o = ownerWithoutSignIn('kingfisher-court');
    const trustee: NewAssignment = { role: 'trustee', scope: { type: 'schemes', organisationId: 'acacia', schemeIds: ['kingfisher-court'] }, label: 'Kingfisher Court' };
    await expect(invite(o, trustee)).rejects.toMatchObject({ kind: 'validation', fieldErrors: { role: expect.stringContaining('isn’t on that scheme’s board') } });
  });

  it('an owner invite needs a current link to that unit', async () => {
    as('p-johan');
    const o = ownerWithoutSignIn('kingfisher-court');
    const other = db.relationshipsIn('kingfisher-court', 'owner').find((r) => r.unitId !== o.unitId && r.personId !== o.person.id)!;
    await expect(invite(o, { ...ownerOf(o), scope: { ...ownerOf(o).scope, unitId: other.unitId } })).rejects.toMatchObject({ kind: 'validation' });
  });

  it('F-22: onboarding invites only the first Agency Administrator', async () => {
    as('p-terry');
    const first = (role: 'portfolio-manager' | 'agency-admin') =>
      run(
        access.invite({
          organisationId: 'acacia',
          name: 'First Admin',
          email: `first.${role}@acacia-ma.example`,
          assignment: { role, scope: { type: 'organisation', organisationId: 'acacia', schemeIds: [] }, label: 'Acacia' },
        }),
      );
    await expect(first('portfolio-manager')).rejects.toMatchObject({ kind: 'validation', fieldErrors: { role: expect.stringContaining('first Agency Administrator') } });
    expect(TestBed.inject(AccessStore).identity(await first('agency-admin'))?.status).toBe('invited');
  });
});
