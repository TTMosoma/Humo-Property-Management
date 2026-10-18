import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideMockData } from '../provide-mock-data';
import { AccessStore } from './access-store';
import { StaffDirectory } from './staff-directory';

/** P0-5: managers and names come from live assignments, not the seed personas. */
describe('Staff directory', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
  });

  it('routes a scheme to its new portfolio manager as soon as the assignment changes', () => {
    const directory = TestBed.inject(StaffDirectory);
    const access = TestBed.inject(AccessStore);
    expect(directory.managerOf('kingfisher-court')?.name).toBe('Johan van der Merwe');

    access.end('p-johan', 'm-johan', 'Thandeka Mokoena');
    access.assign('p-bongani', { role: 'portfolio-manager', scope: { type: 'schemes', organisationId: 'acacia', schemeIds: ['kingfisher-court'] }, label: 'Kingfisher Court' }, 'Thandeka Mokoena');
    expect(directory.managerOf('kingfisher-court')?.identityId).toBe('p-bongani');
  });

  it('names people from the live directory', () => {
    const directory = TestBed.inject(StaffDirectory);
    const access = TestBed.inject(AccessStore);
    access.changeIdentity('p-johan', (i) => ({ ...i, name: 'Johan van der Merwe-Botha' }));
    expect(directory.name('p-johan')).toBe('Johan van der Merwe-Botha');
    expect(directory.name(null)).toBe('Unassigned');
  });
});
