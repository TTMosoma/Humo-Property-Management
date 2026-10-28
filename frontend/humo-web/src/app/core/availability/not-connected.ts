import { InjectionToken } from '@angular/core';

/**
 * The screens whose data isn't on Humo's API yet (docs/28 §1): the live build lists their routes here, the menu leaves
 * them out, and opening one shows "Coming to Humo Property Management" instead of an error. The prototype has every
 * screen, so it lists none. A slice that lands removes its routes from the live list.
 */
export const NOT_CONNECTED = new InjectionToken<readonly string[]>('NOT_CONNECTED', { factory: () => [] });

/** Is this URL (or route) one of the screens not on the API yet? Matches a listed route and everything under it. */
export function notConnected(routes: readonly string[], url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return routes.some((r) => path === r || path.startsWith(r + '/'));
}
