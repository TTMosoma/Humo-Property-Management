import { inject } from '@angular/core';
import { Observable, delay, of, throwError, timer, switchMap } from 'rxjs';
import { PrototypeStateService } from '../core/prototype/prototype-state.service';

/**
 * Wraps mock data in an Observable that behaves like a network call:
 * it waits a short, slightly random time and can be forced to fail
 * from the prototype toolbar's state simulator.
 *
 * Must be called in an injection context (e.g. a field initialiser of a data source).
 */
export function mockResponder() {
  const proto = inject(PrototypeStateService);

  return <T>(value: T): Observable<T> => {
    const ms = proto.latency() ? 250 + Math.round(Math.random() * 350) : 0;
    if (proto.viewState() === 'error') {
      return timer(ms).pipe(switchMap(() => throwError(() => new Error('Simulated network error'))));
    }
    return of(value).pipe(delay(ms));
  };
}
