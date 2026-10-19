import { throwError } from 'rxjs';
import { ApiError } from '../domain';

/**
 * A port whose HTTP adapter isn't written yet. Every method answers with an
 * ApiError('server') — screens already show it as "Something went wrong on our
 * side; nothing was changed" — so a production build never falls back to
 * simulated data. Each port is replaced by its real HTTP adapter as the .NET
 * slices land (docs/audit/backend-readiness-and-prioritised-roadmap.md §4).
 */
export function notConnected<T extends object>(port: string): T {
  return partlyConnected<T>(port, {});
}

/**
 * A port with some methods already on the API: those come from `connected`,
 * the rest still answer "not connected yet" until their slice lands.
 */
export function partlyConnected<T extends object>(port: string, connected: Partial<T>): T {
  return new Proxy({} as T, {
    get(_target, member) {
      // Not a thenable, and not mistaken for one by RxJS or Angular.
      if (typeof member === 'symbol' || member === 'then') return undefined;
      const real = (connected as Record<string, unknown>)[member];
      if (typeof real === 'function') return real;
      return () => throwError(() => new ApiError('server', `${port}.${member} isn’t connected to Humo’s API yet`));
    },
  });
}
