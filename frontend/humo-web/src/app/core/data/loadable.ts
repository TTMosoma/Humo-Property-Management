import { Signal, computed, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, map, of, scan, startWith, switchMap } from 'rxjs';
import { ApiError, toApiError } from '../../domain';

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface Loadable<T> {
  /** The latest value; kept while a new request is loading, so screens don't blank out. */
  readonly value: Signal<T | undefined>;
  readonly status: Signal<LoadStatus>;
  /** True until the first value arrives (later reloads keep showing the old value). */
  readonly loading: Signal<boolean>;
  readonly failed: Signal<boolean>;
  readonly error: Signal<ApiError | null>;
  /** Sends the request again (the error state's "Try again"). */
  retry(): void;
}

interface State<T> {
  status: LoadStatus;
  value: T | undefined;
  error: ApiError | null;
}

/**
 * A page's data, with the state of the request that fetches it:
 *
 *   protected readonly data = loadable(() => this.units.list(this.scope.effectiveIds()));
 *
 * `request` may read signals; when they change, the request is sent again
 * (and an in-flight one is dropped). Live queries keep updating `value`.
 * Call in an injection context (a field initialiser).
 */
export function loadable<T>(request: () => Observable<T>): Loadable<T> {
  const attempt = signal(0);
  const request$ = toObservable(
    computed(() => {
      attempt();
      return request();
    }),
  );

  const state = toSignal(
    request$.pipe(
      switchMap((source) =>
        source.pipe(
          map((value): Partial<State<T>> => ({ status: 'ready', value, error: null })),
          catchError((e) => of<Partial<State<T>>>({ status: 'error', error: toApiError(e) })),
          startWith<Partial<State<T>>>({ status: 'loading', error: null }),
        ),
      ),
      scan((prev: State<T>, next) => ({ ...prev, ...next }), { status: 'loading', value: undefined, error: null } as State<T>),
    ),
    { initialValue: { status: 'loading', value: undefined, error: null } as State<T> },
  );

  return {
    value: computed(() => state().value),
    status: computed(() => state().status),
    loading: computed(() => state().status === 'loading' && state().value === undefined),
    failed: computed(() => state().status === 'error'),
    error: computed(() => state().error),
    retry: () => attempt.update((n) => n + 1),
  };
}
