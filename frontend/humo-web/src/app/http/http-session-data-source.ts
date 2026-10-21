import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, ReplaySubject, catchError, from, map, of, switchMap, tap, throwError } from 'rxjs';
import { CurrentSession, Identity, SIGNED_OUT_SESSION, SessionDataSource, SignInError, SignInFailure } from '../domain';

/** Where the Humo API lives. Same origin by default (Caddy routes /api to the .NET service; doc 25). */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', { factory: () => '/api' });

/**
 * The session over HTTP (D14: ASP.NET Core Identity in Humo's API).
 * - GET /me bootstraps it. Anything but a session (401, the API not deployed,
 *   no network) is "signed out", so the app shows the sign-in page rather than failing.
 * - Passkeys use the browser's WebAuthn API with the server's options JSON.
 * - Email links: POST /auth/link always succeeds (it never says whether an address has an account).
 * The session cookie is HttpOnly: this code never sees or stores a token.
 */
@Injectable()
export class HttpSessionDataSource extends SessionDataSource {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);
  private readonly session$ = new ReplaySubject<CurrentSession>(1);
  private started = false;

  current(): Observable<CurrentSession> {
    if (!this.started) {
      this.started = true;
      this.reload().subscribe();
    }
    return this.session$;
  }

  /** Fetches /me again and publishes it (after sign-in, sign-out or a role switch). */
  reload(): Observable<CurrentSession> {
    return this.http.get<CurrentSession>(`${this.base}/me`, { withCredentials: true }).pipe(
      catchError(() => of(SIGNED_OUT_SESSION)),
      tap((s) => this.session$.next(s)),
    );
  }

  /** Prototype stand-in ("Sign in as"): there is none in production. */
  signIn(): Observable<void> {
    return throwError(() => new SignInError('unavailable', 'Choose a passkey or an email link'));
  }

  signInWithPasskey(emailHint?: string, ownComputer = false): Observable<void> {
    if (!webAuthnJson()) return throwError(() => new SignInError('no-passkey', 'This browser can’t use passkeys'));
    return this.http.post<PublicKeyCredentialRequestOptionsJSON>(`${this.base}/auth/passkey/options`, { email: emailHint ?? null }, { withCredentials: true }).pipe(
      switchMap((options) => from(navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) }))),
      switchMap((credential) => this.http.post(`${this.base}/auth/passkey`, { credential: (credential as PublicKeyCredential).toJSON(), ownComputer }, { withCredentials: true })),
      switchMap(() => this.reload()),
      map(() => undefined),
      catchError((e: unknown) => throwError(() => signInError(e, 'no-passkey'))),
    );
  }

  sendSignInLink(email: string): Observable<string> {
    return this.http.post<{ code: string }>(`${this.base}/auth/link`, { email }, { withCredentials: true }).pipe(
      map((sent) => sent.code),
      catchError((e: unknown) => throwError(() => signInError(e, 'unavailable'))),
    );
  }

  completeSignInLink(token: string, code: string): Observable<void> {
    return this.http.post(`${this.base}/auth/link/complete`, { token, code }, { withCredentials: true }).pipe(
      switchMap(() => this.reload()),
      map(() => undefined),
      catchError((e: unknown) => throwError(() => signInError(e, 'link-expired'))),
    );
  }

  registerPasskey(): Observable<void> {
    if (!webAuthnJson()) return throwError(() => new SignInError('no-passkey', 'This browser can’t create passkeys'));
    return this.http.post<PublicKeyCredentialCreationOptionsJSON>(`${this.base}/me/passkeys/options`, null, { withCredentials: true }).pipe(
      switchMap((options) => from(navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) }))),
      switchMap((credential) => this.http.post(`${this.base}/me/passkeys`, { credential: (credential as PublicKeyCredential).toJSON() }, { withCredentials: true })),
      map(() => undefined),
      catchError((e: unknown) => throwError(() => signInError(e, 'no-passkey'))),
    );
  }

  /** Prototype only: there are no demo identities in production. */
  demoIdentities(): Observable<Identity[]> {
    return of([]);
  }
}

/** Browsers that read and write WebAuthn options as JSON (all current major browsers). */
function webAuthnJson(): boolean {
  return typeof PublicKeyCredential !== 'undefined' && 'parseRequestOptionsFromJSON' in PublicKeyCredential;
}

/**
 * The API's 400 answers carry the frontend's SignInFailure code. The person
 * dismissing the passkey prompt is "cancelled"; an unreachable API is "unavailable".
 */
function signInError(e: unknown, fallback: SignInFailure): SignInError {
  if (e instanceof SignInError) return e;
  if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return new SignInError('cancelled', 'The passkey prompt was closed');
  if (e instanceof HttpErrorResponse) {
    const code = (e.error as { code?: string } | null)?.code;
    if (code === 'paused' || code === 'link-expired' || code === 'no-passkey' || code === 'wrong-code') return new SignInError(code, e.error?.title ?? code);
    if (e.status === 0 || e.status >= 500 || e.status === 404) return new SignInError('unavailable', 'Sign-in can’t be reached right now');
  }
  return new SignInError(fallback, 'Sign-in didn’t go through');
}
