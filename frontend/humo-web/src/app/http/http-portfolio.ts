import { Injectable } from '@angular/core';
import { Observable, catchError, from, map, of, switchMap, throwError } from 'rxjs';
import {
  ChangeEvent,
  ListQuery,
  NewRelationship,
  Page,
  PersonDataSource,
  PersonDetails,
  PersonSummary,
  UnitDataSource,
  UnitDetails,
  UnitSummary,
  Organisation,
  OrganisationDataSource,
  OrganisationDetails,
  OrganisationStatus,
  Scheme,
  SchemeDataSource,
  SchemeDetails,
  SchemeHealth,
  SchemeStatus,
  StepUpAuthenticator,
  StepUpMethod,
  StepUpRequest,
  StepUpResult,
} from '../domain';
import { HttpPort, toApiErrorFromHttp } from './http-port';

/** Organisations over HTTP (slice 1, doc 24 §3). */
@Injectable()
export class HttpOrganisationDataSource extends HttpPort implements OrganisationDataSource {
  list(): Observable<Organisation[]> {
    return this.live<Organisation[]>('/organisations', ['organisations', 'session']);
  }

  get(id: string): Observable<Organisation | undefined> {
    return this.live<Organisation>(`/organisations/${id}`, ['organisations', 'session']).pipe(catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))));
  }

  update(id: string, details: OrganisationDetails, expectedVersion?: number): Observable<void> {
    return this.command('PUT', `/organisations/${id}`, { ...details, expectedVersion }, ['organisations', 'session']);
  }

  setStatus(id: string, status: OrganisationStatus, reason: string, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/organisations/${id}/status`, { status, reason, expectedVersion }, ['organisations', 'session']);
  }
}

/** Schemes over HTTP (slice 1, doc 24 §4). Health and changes fill in as later slices land. */
@Injectable()
export class HttpSchemeDataSource extends HttpPort implements SchemeDataSource {
  list(): Observable<Scheme[]> {
    return this.live<Scheme[]>('/schemes', ['schemes', 'session', 'access']);
  }

  get(id: string): Observable<Scheme | undefined> {
    return this.live<Scheme>(`/schemes/${id}`, ['schemes', 'session']).pipe(catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))));
  }

  health(): Observable<SchemeHealth[]> {
    return this.live<SchemeHealth[]>('/schemes/health', ['schemes', 'session', 'units', 'accounts', 'jobs']);
  }

  changes(schemeIds: string[], since: string): Observable<ChangeEvent[]> {
    return this.live<ChangeEvent[]>('/schemes/changes', ['schemes'], { schemeIds, since });
  }

  create(details: SchemeDetails): Observable<string> {
    return this.createId('/schemes', details, ['schemes']);
  }

  update(id: string, details: SchemeDetails, expectedVersion?: number): Observable<void> {
    return this.command('PUT', `/schemes/${id}`, { ...details, expectedVersion }, ['schemes']);
  }

  setStatus(id: string, status: SchemeStatus, reason: string, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/schemes/${id}/status`, { status, reason, expectedVersion }, ['schemes']);
  }
}

/**
 * Step-up over HTTP (doc 24 C7): a fresh passkey assertion, which the API records in the
 * session for 5 minutes. Humo Mobile approval is a later addition (D5).
 */
@Injectable()
export class HttpStepUpAuthenticator extends HttpPort implements StepUpAuthenticator {
  methods(): Observable<{ method: StepUpMethod; device: string }[]> {
    return of([{ method: 'passkey' as const, device: 'A passkey on this device' }]);
  }

  verify(method: StepUpMethod, _request: StepUpRequest): Observable<StepUpResult> {
    if (method !== 'passkey') return of({ verified: false, at: new Date().toISOString() });
    return this.http.post<PublicKeyCredentialRequestOptionsJSON>(`${this.base}/me/step-up/options`, null, { withCredentials: true }).pipe(
      switchMap((options) => from(navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) }))),
      switchMap((credential) => this.http.post<StepUpResult>(`${this.base}/me/step-up`, { credential: (credential as PublicKeyCredential).toJSON() }, { withCredentials: true })),
      map((r) => ({ ...r, verified: true })),
      catchError((e: unknown) =>
        e instanceof DOMException ? of({ verified: false, at: new Date().toISOString() }) : throwError(() => toApiErrorFromHttp(e)),
      ),
    );
  }
}

/** The ListQuery's paging as query parameters (search, filters and sort stay in the screens for now; docs/08 §7). */
function paging(schemeIds: string[], query?: ListQuery): Record<string, string | string[]> {
  const p: Record<string, string | string[]> = { schemeIds };
  if (query?.page) p['page'] = String(query.page);
  if (query?.pageSize) p['pageSize'] = String(query.pageSize);
  return p;
}

const notFoundIsUndefined = <T>(source: Observable<T>): Observable<T | undefined> =>
  source.pipe(catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))));

/** Units and their levy accounts over HTTP (slice 1, doc 24 §5). */
@Injectable()
export class HttpUnitDataSource extends HttpPort implements UnitDataSource {
  list(schemeIds: string[], query?: ListQuery): Observable<Page<UnitSummary>> {
    return this.live<Page<UnitSummary>>('/units', ['units', 'people', 'schemes', 'session'], paging(schemeIds, query));
  }

  get(schemeId: string, unitNumber: string): Observable<UnitSummary | undefined> {
    return notFoundIsUndefined(this.live<UnitSummary>(`/schemes/${schemeId}/units/${encodeURIComponent(unitNumber)}`, ['units', 'people', 'session']));
  }

  byId(unitId: string): Observable<UnitSummary | undefined> {
    return notFoundIsUndefined(this.live<UnitSummary>(`/units/${unitId}`, ['units', 'people', 'session']));
  }

  create(schemeId: string, details: UnitDetails): Observable<string> {
    return this.createId(`/schemes/${schemeId}/units`, details, ['units', 'schemes']);
  }

  update(unitId: string, details: UnitDetails, expectedVersion?: number): Observable<void> {
    return this.command('PUT', `/units/${unitId}`, { ...details, expectedVersion }, ['units', 'schemes']);
  }

  search(query: string, schemeIds: string[], limit?: number): Observable<UnitSummary[]> {
    return this.http
      .get<UnitSummary[]>(`${this.base}/units/search`, { withCredentials: true, params: { q: query, schemeIds, ...(limit ? { limit: String(limit) } : {}) } })
      .pipe(catchError((e) => throwError(() => toApiErrorFromHttp(e))));
  }
}

/** The people directory and relationships over HTTP (slice 1, doc 24 §6). */
@Injectable()
export class HttpPersonDataSource extends HttpPort implements PersonDataSource {
  list(schemeIds: string[], query?: ListQuery): Observable<Page<PersonSummary>> {
    return this.live<Page<PersonSummary>>('/people', ['people', 'units', 'session'], paging(schemeIds, query));
  }

  create(details: PersonDetails, link?: NewRelationship): Observable<string> {
    return this.createId('/people', { details, link }, ['people', 'units']);
  }

  update(personId: string, details: PersonDetails, expectedVersion?: number): Observable<void> {
    return this.command('PUT', `/people/${personId}`, { ...details, expectedVersion }, ['people', 'units']);
  }

  addRelationship(personId: string, link: NewRelationship): Observable<void> {
    return this.command('POST', `/people/${personId}/relationships`, link, ['people', 'units']);
  }

  endRelationship(relationshipId: string, until: string): Observable<void> {
    return this.command('POST', `/relationships/${relationshipId}/end`, { until }, ['people', 'units']);
  }

  get(personId: string): Observable<PersonSummary | undefined> {
    return notFoundIsUndefined(this.live<PersonSummary>(`/people/${personId}`, ['people', 'units', 'session']));
  }

  search(query: string, schemeIds: string[], limit?: number): Observable<PersonSummary[]> {
    return this.http
      .get<PersonSummary[]>(`${this.base}/people/search`, { withCredentials: true, params: { q: query, schemeIds, ...(limit ? { limit: String(limit) } : {}) } })
      .pipe(catchError((e) => throwError(() => toApiErrorFromHttp(e))));
  }
}
