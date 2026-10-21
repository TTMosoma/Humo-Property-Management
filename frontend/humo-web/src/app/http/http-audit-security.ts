import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, from, map, switchMap, tap, throwError } from 'rxjs';
import { AuditDataSource, AuditEvent, AuditQuery, ListQuery, Page, SecurityDataSource, SecurityProfile, SessionDataSource } from '../domain';
import { HttpPort, toApiErrorFromHttp } from './http-port';
import { HttpSessionDataSource } from './http-session-data-source';

/** The audit log over HTTP (doc 24 §8): an agency's own events, or every event for Humo. */
@Injectable()
export class HttpAuditDataSource extends HttpPort implements AuditDataSource {
  query(q: AuditQuery, list?: ListQuery): Observable<Page<AuditEvent>> {
    const params: Record<string, string> = {};
    if (q.organisationId) params['organisationId'] = q.organisationId;
    if (q.category) params['category'] = q.category;
    if (q.identityId) params['identityId'] = q.identityId;
    if (list?.page) params['page'] = String(list.page);
    if (list?.pageSize) params['pageSize'] = String(list.pageSize);
    return this.live<Page<AuditEvent>>('/audit', ['audit', 'access', 'session'], params);
  }

  /** Needs step-up. Downloads the CSV in the browser and returns its file name. */
  export(q: AuditQuery): Observable<string> {
    return this.http
      .post(`${this.base}/audit/export`, { organisationId: q.organisationId, category: q.category, identityId: q.identityId }, { withCredentials: true, observe: 'response', responseType: 'blob' })
      .pipe(
        map((res) => {
          const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'humo-audit.csv';
          const url = URL.createObjectURL(res.body!);
          const a = document.createElement('a');
          a.href = url;
          a.download = decodeURIComponent(name);
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          return decodeURIComponent(name);
        }),
        tap(() => this.dataChanges.notify('audit')),
        catchError((e: unknown) => from(problemFromBlob(e)).pipe(switchMap((err) => throwError(() => toApiErrorFromHttp(err))))),
      );
  }
}

/** A refused download carries its ProblemDetails as a Blob: read it so step-up and refusals work as usual. */
async function problemFromBlob(e: unknown): Promise<unknown> {
  if (e instanceof HttpErrorResponse && e.error instanceof Blob) {
    try {
      return new HttpErrorResponse({ error: JSON.parse(await e.error.text()), status: e.status, statusText: e.statusText, url: e.url ?? undefined });
    } catch {
      return e;
    }
  }
  return e;
}

/**
 * Settings › Security over HTTP: the person's own passkeys and this session. Adding a passkey is
 * the WebAuthn ceremony; removing one and signing out other sessions need step-up. Humo Mobile
 * devices come later (D5).
 */
@Injectable()
export class HttpSecurityDataSource extends HttpPort implements SecurityDataSource {
  private readonly session = inject(SessionDataSource) as HttpSessionDataSource;

  profile(): Observable<SecurityProfile> {
    return this.live<SecurityProfile>('/me/security', ['session']);
  }

  addPasskey(): Observable<void> {
    return this.session.registerPasskey().pipe(tap(() => this.dataChanges.notify('session')));
  }

  removePasskey(_identityId: string, passkeyId: string): Observable<void> {
    return this.command('POST', `/me/security/passkeys/${encodeURIComponent(passkeyId)}/remove`, null, ['session']);
  }

  /** Stops trusting a computer. The question comes back on its next sign-in. */
  removeDevice(_identityId: string, deviceId: string): Observable<void> {
    return this.command('POST', `/me/security/devices/${encodeURIComponent(deviceId)}/remove`, null, ['session']);
  }

  /** Only this session is listed; signing out "another" session signs out every other one. */
  signOutSession(): Observable<void> {
    return this.signOutOtherSessions();
  }

  signOutOtherSessions(): Observable<void> {
    return this.command('POST', '/me/security/sign-out-others', null, ['session']);
  }
}
