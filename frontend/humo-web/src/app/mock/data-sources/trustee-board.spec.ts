import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { AccessDataSource, ApiError, BoardDataSource, PersonDataSource, activeAssignments } from '../../domain';
import { AccessStore } from '../db/access-store';
import { MockDb } from '../db/mock-db';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';

/**
 * D2: the trustee board is the source of truth. Trustee access in Humo PM is
 * derived from it: appointing grants it (with a sign-in), ending a term
 * removes it, and nobody becomes a trustee any other way.
 */
describe('The board is the source of truth for trustees (D2)', () => {
  let auth: MockAuthSession;
  let access: AccessStore;
  let db: MockDb;
  const run = <T>(o: Observable<T>) => firstValueFrom(o);
  const stepUp = () => auth.recordProof({ verified: true, method: 'passkey', device: 'Test', at: new Date().toISOString() });
  const KC = 'kingfisher-court';
  const today = new Date().toISOString().slice(0, 10);

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    access = TestBed.inject(AccessStore);
    db = TestBed.inject(MockDb);
  });

  const onBoard = (personId: string | undefined, schemeId: string) => !!personId && db.relationshipsIn(schemeId, 'trustee').some((r) => r.personId === personId && db.isCurrent(r));

  it('in the seed, every trustee sign-in matches a current seat on that scheme’s board', () => {
    for (const i of access.identities()) {
      for (const a of activeAssignments(i).filter((x) => x.role === 'trustee')) {
        for (const schemeId of a.scope.schemeIds) expect(onBoard(i.personId, schemeId), `${i.name} is a trustee of ${schemeId} without a board seat`).toBe(true);
      }
    }
  });

  it('appointing an owner with a sign-in gives them trustee access; ending the term removes it', async () => {
    auth.signIn('p-thandeka');
    const board = TestBed.inject(BoardDataSource);
    const candidates = await run(board.candidates(KC));
    const owner = access.identities().find((i) => i.kind === 'customer' && i.status === 'active' && candidates.some((c) => c.personId === i.personId))!;
    expect(owner, 'a signed-in owner who isn’t on the board').toBeTruthy();
    const trusteeOfKc = () => activeAssignments(access.identity(owner.id)!).some((a) => a.role === 'trustee' && a.scope.schemeIds.includes(KC));
    expect(trusteeOfKc()).toBe(false);

    stepUp();
    await run(board.act(KC, { type: 'appoint', personId: owner.personId!, portfolio: 'Trustee', how: 'co-opted', since: today }));
    expect(trusteeOfKc()).toBe(true);

    const seat = db.relationshipsIn(KC, 'trustee').find((r) => r.personId === owner.personId && db.isCurrent(r))!;
    stepUp();
    await run(board.act(KC, { type: 'end', relationshipId: seat.id, on: today, reason: 'Resigned from the board' }));
    expect(trusteeOfKc()).toBe(false);
  });

  it('People can’t make anyone a trustee', async () => {
    auth.signIn('p-thandeka');
    const person = [...db.persons.values()][0];
    await expect(run(TestBed.inject(PersonDataSource).addRelationship(person.id, { type: 'trustee', schemeId: KC, portfolio: 'Trustee', since: today }))).rejects.toBeInstanceOf(ApiError);
  });

  it('Users & access can’t give the trustee role without a board seat', async () => {
    auth.signIn('p-thandeka');
    stepUp();
    const johan = access.identity('p-johan')!; // staff, not on any board
    await expect(run(TestBed.inject(AccessDataSource).assign(johan.id, { role: 'trustee', scope: { type: 'schemes', organisationId: 'acacia', schemeIds: [KC] }, label: 'Kingfisher Court' }))).rejects.toBeInstanceOf(ApiError);
  });
});
