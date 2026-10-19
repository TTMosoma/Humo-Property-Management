import { Injectable } from '@angular/core';
import { Observable, catchError, from, map, of, switchMap, throwError } from 'rxjs';
import {
  ChangeEvent,
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
    return this.query<Organisation[]>('/organisations', ['organisations', 'session']);
  }

  get(id: string): Observable<Organisation | undefined> {
    return this.query<Organisation>(`/organisations/${id}`, ['organisations', 'session']).pipe(catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))));
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
    return this.query<Scheme[]>('/schemes', ['schemes', 'session', 'access']);
  }

  get(id: string): Observable<Scheme | undefined> {
    return this.query<Scheme>(`/schemes/${id}`, ['schemes', 'session']).pipe(catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))));
  }

  health(): Observable<SchemeHealth[]> {
    return this.query<SchemeHealth[]>('/schemes/health', ['schemes', 'session', 'units', 'accounts', 'jobs']);
  }

  changes(schemeIds: string[], since: string): Observable<ChangeEvent[]> {
    return this.query<ChangeEvent[]>('/schemes/changes', ['schemes'], { schemeIds, since });
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
