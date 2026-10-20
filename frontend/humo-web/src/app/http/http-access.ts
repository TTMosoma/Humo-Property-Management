import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap, tap } from 'rxjs';
import { AccessDataSource, Identity, ImpersonationMode, ImpersonationReason, ImpersonationSession, NewAssignment, Passkey, SessionDataSource } from '../domain';
import { HttpPort } from './http-port';
import { HttpSessionDataSource } from './http-session-data-source';

/**
 * Users & access over HTTP (slice 1, doc 24 §7): the directory, invitations,
 * details, membership, roles, the browse grant (D1), switching role and signing
 * out. Every change needs step-up; the form drawer verifies and resends.
 * Impersonation: System Administrators with the individual grant (doc 24 §8).
 */
@Injectable()
export class HttpAccessDataSource extends HttpPort implements AccessDataSource {
  private readonly session = inject(SessionDataSource) as HttpSessionDataSource;

  passkeysOf(identityId: string): Observable<Passkey[]> {
    return this.live<Passkey[]>(`/platform/users/${identityId}/passkeys`, ['access']);
  }

  removePasskeys(identityId: string, passkeyId: string | null, reason: string): Observable<void> {
    return this.command('POST', `/platform/users/${identityId}/passkeys/remove`, { passkeyId, reason }, ['access', 'audit']);
  }

  directory(organisationId: string | null): Observable<Identity[]> {
    return this.live<Identity[]>('/access/directory', ['access', 'session'], organisationId ? { organisationId } : undefined);
  }

  humoTeam(): Observable<Identity[]> {
    return this.live<Identity[]>('/access/humo-team', ['access']);
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

  /** System.Impersonate only; Act needs a fresh step-up. The app then renders the customer's role. */
  startImpersonation(input: { targetId: string; targetAssignmentId: string; mode: ImpersonationMode; reason: ImpersonationReason; note?: string; ticket?: string }): Observable<ImpersonationSession> {
    return this.command<ImpersonationSession>('POST', '/me/impersonation', input, []).pipe(switchMap((s) => this.reloaded().pipe(map(() => s))));
  }

  /** Always succeeds server-side; the app is Humo's again. */
  endImpersonation(): Observable<void> {
    return this.command('POST', '/me/impersonation/end', null, []).pipe(switchMap(() => this.reloaded()));
  }

  private reloaded(): Observable<void> {
    return this.session.reload().pipe(
      tap(() => this.dataChanges.notify('session')),
      map(() => undefined),
    );
  }
}
