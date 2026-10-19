import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { map, switchMap, tap } from 'rxjs';
import { AccessDataSource, SessionDataSource } from '../domain';
import { DataChanges } from '../core/data/data-changes';
import { API_BASE_URL, HttpSessionDataSource } from './http-session-data-source';
import { partlyConnected } from './not-connected';

/**
 * Users & access over HTTP. Slice 1, step 1 connects the session commands:
 * sign out (ends the server session, so a reload stays signed out) and switch
 * role (the API re-issues the session for that assignment). Inviting, roles and
 * impersonation follow later in slice 1 (doc 24 §7–§8).
 */
export function httpAccessDataSource(): AccessDataSource {
  const http = inject(HttpClient);
  const base = inject(API_BASE_URL);
  const session = inject(SessionDataSource) as HttpSessionDataSource;
  const changes = inject(DataChanges);
  // Lists scoped by the session (schemes, organisations…) re-fetch for the new role.
  const reloaded = () => session.reload().pipe(tap(() => changes.notify('session')), map(() => undefined));
  return partlyConnected<AccessDataSource>('AccessDataSource', {
    signOut: () => http.post(`${base}/auth/sign-out`, null, { withCredentials: true }).pipe(switchMap(reloaded)),
    switchRole: (assignmentId: string) =>
      http.put(`${base}/me/assignment`, { assignmentId }, { withCredentials: true }).pipe(switchMap(reloaded)),
  });
}
