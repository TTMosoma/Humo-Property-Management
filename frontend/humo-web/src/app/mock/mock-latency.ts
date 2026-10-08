import { inject } from '@angular/core';
import { NEVER, Observable, delay, of, switchMap, throwError, timer } from 'rxjs';
import { ApiError } from '../domain';
import { PrototypeStateService } from '../core/prototype/prototype-state.service';

/**
 * Wraps mock data in an Observable that behaves like a network call: it waits
 * a short, slightly random time. The prototype toolbar's state simulator acts
 * here, in the fake network, so pages render their real request states:
 *   loading → the response never arrives
 *   empty   → list responses come back empty
 *   error   → the request fails with a network error
 *
 * Must be called in an injection context (e.g. a field initialiser of a data source).
 */
export function mockResponder() {
  const proto = inject(PrototypeStateService);

  return <T>(value: T): Observable<T> => {
    const ms = proto.latency() ? 250 + Math.round(Math.random() * 350) : 0;
    switch (proto.viewState()) {
      case 'loading':
        return NEVER;
      case 'error':
        return timer(ms).pipe(switchMap(() => throwError(() => new ApiError('network', 'Simulated network error'))));
      case 'empty':
        return of((Array.isArray(value) ? [] : value) as T).pipe(delay(ms));
      default:
        return of(value).pipe(delay(ms));
    }
  };
}
