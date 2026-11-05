import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { Scheme, SchemeDataSource } from '../../domain';
import { SessionService } from '../session/session.service';
import { ScopeService } from './scope.service';

const scheme = (id: string): Scheme => ({ id, organisationId: 'org', name: id, status: 'active' }) as Scheme;

describe('ScopeService', () => {
  const owner = signal('');
  let response: () => Observable<Scheme[]>;
  let scope: ScopeService;

  beforeEach(() => {
    owner.set('thandeka|admin');
    response = () => of([scheme('die-eike'), scheme('kingfisher')]);
    const assignment = computed(() => ({ id: 'admin', role: 'agency-admin', scope: { type: 'organisation', organisationId: 'org', schemeIds: [] } }));
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionService, useValue: { dataOwner: owner, assignment, role: () => 'agency-admin', can: () => true } },
        { provide: SchemeDataSource, useValue: { list: () => response() } },
      ],
    });
    scope = TestBed.inject(ScopeService);
    TestBed.tick();
  });

  it('loads the schemes of whoever is signed in', () => {
    expect(scope.accessible().map((s) => s.id)).toEqual(['die-eike', 'kingfisher']);
  });

  it('forgets the schemes when the person signs out', () => {
    owner.set('');
    TestBed.tick();
    expect(scope.accessible()).toEqual([]);
    expect(scope.status()).toBe('ready');
  });

  it('loads again for the next person, even after a failed request ended the last one', () => {
    response = () => throwError(() => new Error('401'));
    scope.retry();
    TestBed.tick();
    expect(scope.status()).toBe('error');

    owner.set('');
    TestBed.tick();
    response = () => of([scheme('kingfisher')]);
    owner.set('johanna|trustee');
    TestBed.tick();

    expect(scope.status()).toBe('ready');
    expect(scope.accessible().map((s) => s.id)).toEqual(['kingfisher']);
  });
});
