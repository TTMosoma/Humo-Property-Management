import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, map, tap, throwError } from 'rxjs';
import { ApiError, FieldErrors, PolicyDenial, PolicyError } from '../domain';
import { DataChanges, DataTopic, liveQuery } from '../core/data/data-changes';
import { PolicyNotices } from '../core/security/policy-notices';
import { API_BASE_URL } from './http-session-data-source';

const DENIALS: PolicyDenial[] = ['observe-only', 'forbidden', 'step-up-required', 'not-entitled', 'out-of-scope', 'conflict-of-interest'];

/**
 * The API's ProblemDetails as an ApiError (docs/08 §4):
 * 422/400 → validation with field errors; 401/403 → PolicyError with its code;
 * 404 → not-found; 409/412 → conflict; 0 → network; anything else → server.
 */
export function toApiErrorFromHttp(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (!(e instanceof HttpErrorResponse)) return new ApiError('network', e instanceof Error ? e.message : 'The request failed');
  const body = (e.error ?? {}) as { title?: string; code?: string; errors?: FieldErrors };
  const title = body.title ?? e.statusText ?? 'The request failed';
  switch (true) {
    case e.status === 400 || e.status === 422:
      return new ApiError('validation', title, body.errors ?? {});
    case e.status === 401:
      return new PolicyError('forbidden', 'You’re not signed in');
    case e.status === 403:
      return new PolicyError(DENIALS.includes(body.code as PolicyDenial) ? (body.code as PolicyDenial) : 'forbidden', title);
    case e.status === 404:
      return new ApiError('not-found', title);
    case e.status === 409 || e.status === 412:
      return new ApiError('conflict', title);
    case e.status === 0:
      return new ApiError('network', 'Humo can’t be reached');
    default:
      return new ApiError('server', title);
  }
}

/**
 * Base for the HTTP adapters: reads are live (re-fetched when a topic changes), commands
 * announce what they changed, and policy refusals are explained like the simulation's (PolicyNotices).
 */
export abstract class HttpPort {
  protected readonly http = inject(HttpClient);
  protected readonly base = inject(API_BASE_URL);
  protected readonly dataChanges = inject(DataChanges);
  private readonly notices = inject(PolicyNotices);

  /** A live GET: fetched now and again whenever one of the topics changes. */
  protected live<T>(path: string, topics: DataTopic[], params?: Record<string, string | string[]>): Observable<T> {
    return liveQuery(this.dataChanges, topics, () => this.http.get<T>(`${this.base}${path}`, { withCredentials: true, params }).pipe(catchError((e) => this.fail(e))));
  }

  /** A command: on success, the topics it changed are re-fetched everywhere. */
  protected command<T = void>(method: 'POST' | 'PUT' | 'DELETE', path: string, body: unknown, changed: DataTopic[]): Observable<T> {
    return this.http.request<T>(method, `${this.base}${path}`, { body, withCredentials: true }).pipe(
      tap(() => this.dataChanges.notify(...changed)),
      catchError((e) => this.fail(e)),
    );
  }

  /** A command that answers `{ id }`: returns the new id. */
  protected createId(path: string, body: unknown, changed: DataTopic[]): Observable<string> {
    return this.command<{ id: string }>('POST', path, body, changed).pipe(map((r) => r.id));
  }

  private fail(e: unknown): Observable<never> {
    const error = toApiErrorFromHttp(e);
    // A step-up challenge is answered by verifying and resending (docs/08 §1), not explained as a refusal.
    if (error instanceof PolicyError && error.code !== 'step-up-required') this.notices.report(error.code);
    return throwError(() => error);
  }
}
