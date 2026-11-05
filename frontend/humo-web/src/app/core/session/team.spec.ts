import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AccessDataSource, Identity, Role } from '../../domain';
import { SessionService } from './session.service';
import { Team, canTakeRuleBreaches, organisationTeam } from './team';

const person = (id: string, ...roles: Role[]): Identity =>
  ({
    id,
    name: id,
    initials: id[0],
    memberships: [{ organisationId: 'org', status: 'active' }],
    assignments: roles.map((role) => ({ id: `${id}-${role}`, role, status: 'active', scope: { type: 'organisation', organisationId: 'org', schemeIds: [] } })),
  }) as unknown as Identity;

describe('organisationTeam', () => {
  // The API's directory has no staff ids: staff are whoever holds a staff role.
  const directory = [person('thandeka', 'agency-admin'), person('johan', 'portfolio-manager'), person('priya', 'finance'), person('anele', 'owner'), person('johanna', 'owner', 'trustee')];
  let team: Team;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionService, useValue: { organisation: signal({ id: 'org' }) } },
        { provide: AccessDataSource, useValue: { directory: () => of(directory) } },
      ],
    });
    team = TestBed.runInInjectionContext(() => organisationTeam());
    TestBed.tick();
  });

  it('lists everyone with a staff role, not owners or trustees', () => {
    expect(team.staff().map((m) => m.id)).toEqual(['thandeka', 'johan', 'priya']);
  });

  it('leaves Finance out of who can take a rule breach', () => {
    expect(team.staff().filter(canTakeRuleBreaches).map((m) => m.id)).toEqual(['thandeka', 'johan']);
  });
});
