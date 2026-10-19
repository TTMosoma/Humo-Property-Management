import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { map, switchMap } from 'rxjs';
import { AccessDataSource, SessionDataSource } from '../domain';
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
  return partlyConnected<AccessDataSource>('AccessDataSource', {
    signOut: () => http.post(`${base}/auth/sign-out`, null, { withCredentials: true }).pipe(switchMap(() => session.reload()), map(() => undefined)),
    switchRole: (assignmentId: string) =>
      http.put(`${base}/me/assignment`, { assignmentId }, { withCredentials: true }).pipe(switchMap(() => session.reload()), map(() => undefined)),
  });
}
