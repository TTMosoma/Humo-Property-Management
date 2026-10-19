import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap, tap, throwError } from 'rxjs';
import { AccessDataSource, ApiError, Identity, ImpersonationSession, NewAssignment, SessionDataSource } from '../domain';
import { HttpPort } from './http-port';
import { HttpSessionDataSource } from './http-session-data-source';

/**
 * Users & access over HTTP (slice 1, doc 24 §7): the directory, invitations,
 * details, membership, roles, the browse grant (D1), switching role and signing
 * out. Every change needs step-up; the form drawer verifies and resends.
 * Impersonation follows with the Humo team (doc 24 §8).
 */
@Injectable()
export class HttpAccessDataSource extends HttpPort implements AccessDataSource {
  private readonly session = inject(SessionDataSource) as HttpSessionDataSource;

  directory(organisationId: string | null): Observable<Identity[]> {
    return this.query<Identity[]>('/access/directory', ['access', 'session'], organisationId ? { organisationId } : undefined);
  }

  humoTeam(): Observable<Identity[]> {
    return this.query<Identity[]>('/access/humo-team', ['access']);
  }

  invite(input: { organisationId: string; name: string; email: string; title?: string; assignment: NewAssignment; personId?: string }): Observable<string> {
    return this.createId('/access/invitations', input, ['access', 'people', 'units']);
  }

  updateIdentity(identityId: string, details: { name: string; email: string; title?: string }, expectedVersion?: number): Observable<void> {
    return this.command('PUT', `/access/identities/${identityId}`, { ...details, expectedVersion }, ['access']);
  }

  setMembershipStatus(identityId: string, organisationId: string, status: 'active' | 'suspended' | 'ended', reason: string): Observable<void> {
    return this.command('POST', `/access/identities/${identityId}/membership`, { organisationId, status, reason }, ['access', 'schemes']);
  }

  resendInvite(identityId: string): Observable<void> {
    return this.command('POST', `/access/identities/${identityId}/resend-invitation`, null, ['access']);
  }

  assign(identityId: string, assignment: NewAssignment): Observable<void> {
    return this.command('POST', `/access/identities/${identityId}/assignments`, assignment, ['access', 'schemes']);
  }

  setBrowseAgency(identityId: string, assignmentId: string, allowed: boolean, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/access/identities/${identityId}/assignments/${assignmentId}/browse-agency`, { allowed, expectedVersion }, ['access']);
  }

  endAssignment(identityId: string, assignmentId: string, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/access/identities/${identityId}/assignments/${assignmentId}/end`, { expectedVersion }, ['access', 'schemes']);
  }

  /** The API re-issues the session for that assignment; lists scoped by the session re-fetch. */
  switchRole(assignmentId: string): Observable<void> {
    return this.command('PUT', '/me/assignment', { assignmentId }, []).pipe(switchMap(() => this.reloaded()));
  }

  /** Ends the server session, so a reload stays signed out. */
  signOut(): Observable<void> {
    return this.command('POST', '/auth/sign-out', null, []).pipe(switchMap(() => this.reloaded()));
  }

  startImpersonation(): Observable<ImpersonationSession> {
    return throwError(() => new ApiError('server', 'Impersonation isn’t connected to Humo’s API yet'));
  }

  endImpersonation(): Observable<void> {
    return throwError(() => new ApiError('server', 'Impersonation isn’t connected to Humo’s API yet'));
  }

  private reloaded(): Observable<void> {
    return this.session.reload().pipe(
      tap(() => this.dataChanges.notify('session')),
      map(() => undefined),
    );
  }
}
