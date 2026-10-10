import { Observable } from 'rxjs';
import { Scheme, SchemeStatus } from '../models/scheme';
import { ChangeEvent, SchemeHealth } from '../models/scheme-health';

/**
 * Port: how the UI reads schemes.
 *
 * Components depend on this abstract class only. The prototype provides an
 * in-memory implementation (mock/); later an HTTP implementation calling the
 * .NET API is swapped in via app.config.ts without touching any component.
 */
export type SchemeDetails = Pick<Scheme, 'name' | 'code' | 'type' | 'suburb' | 'city' | 'province'>;

export abstract class SchemeDataSource {
  /** Live. Every scheme the caller may see, archived ones included (screens decide what to show). */
  abstract list(): Observable<Scheme[]>;
  abstract get(id: string): Observable<Scheme | undefined>;
  /** Live. Each scheme's vital signs, worked out by the API from its records. */
  abstract health(): Observable<SchemeHealth[]>;
  /** What changed in these schemes since a moment (the dashboard's "since yesterday"), newest first. */
  abstract changes(schemeIds: string[], since: string): Observable<ChangeEvent[]>;
  /** A new scheme starts `onboarding`, with no units yet. Returns its id. */
  abstract create(details: SchemeDetails): Observable<string>;
  abstract update(id: string, details: SchemeDetails, expectedVersion?: number): Observable<void>;
  /** prospect → onboarding → active → closed → archived; closed → active (reopen); archived → closed (restore). */
  abstract setStatus(id: string, status: SchemeStatus, reason: string, expectedVersion?: number): Observable<void>;
}
