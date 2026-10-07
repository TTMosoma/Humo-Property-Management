import { Observable } from 'rxjs';
import { Scheme } from '../models/scheme';
import { SchemeHealth } from '../models/scheme-health';

/**
 * Port: how the UI reads schemes.
 *
 * Components depend on this abstract class only. The prototype provides an
 * in-memory implementation (mock/); later an HTTP implementation calling the
 * .NET API is swapped in via app.config.ts without touching any component.
 */
export abstract class SchemeDataSource {
  abstract list(): Observable<Scheme[]>;
  abstract get(id: string): Observable<Scheme | undefined>;
  abstract health(): Observable<SchemeHealth[]>;
}
