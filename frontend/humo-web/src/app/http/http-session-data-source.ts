import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, catchError, of, shareReplay, throwError } from 'rxjs';
import { CurrentSession, Identity, SIGNED_OUT_SESSION, SessionDataSource, SignInError } from '../domain';

/** Where the Humo API lives. Same origin by default (the host routes /api to the .NET service). */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', { factory: () => '/api' });

const UNAVAILABLE = () => throwError(() => new SignInError('unavailable', 'Sign-in isn’t available yet'));

/**
 * The session bootstrap over HTTP: GET /me (docs/08). Anything but a session —
 * 401, the API not deployed yet, no network — is "signed out", so the app
 * shows the sign-in page rather than failing.
 *
 * Sign-in itself belongs to the identity provider (D5): until it's chosen and
 * wired, the sign-in methods answer "unavailable" and the page says so.
 */
@Injectable()
export class HttpSessionDataSource extends SessionDataSource {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);
  private readonly me$ = this.http.get<CurrentSession>(`${this.base}/me`, { withCredentials: true }).pipe(
    catchError(() => of(SIGNED_OUT_SESSION)),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  current(): Observable<CurrentSession> {
    return this.me$;
  }

  signIn(): Observable<void> {
    return UNAVAILABLE();
  }

  signInWithPasskey(): Observable<void> {
    return UNAVAILABLE();
  }

  sendSignInLink(): Observable<void> {
    return UNAVAILABLE();
  }

  completeSignInLink(): Observable<void> {
    return UNAVAILABLE();
  }

  /** Prototype only: there are no demo identities in production. */
  demoIdentities(): Observable<Identity[]> {
    return of([]);
  }
}
