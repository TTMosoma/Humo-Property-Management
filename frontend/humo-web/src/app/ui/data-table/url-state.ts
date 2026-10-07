import { WritableSignal, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

/**
 * A page's list state (view, search, filters) kept in the URL query string,
 * so a filtered view survives reloads and can be shared as a link.
 *
 *   readonly state = urlState({ view: 'mine', q: '', scheme: null });
 *
 * Must be called in an injection context (a field initialiser).
 */
export function urlState<K extends string>(defaults: Record<K, string | null>): WritableSignal<Record<K, string | null>> {
  type T = Record<K, string | null>;
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const params = route.snapshot.queryParamMap;

  const initial = { ...defaults };
  for (const key of Object.keys(defaults) as K[]) {
    const v = params.get(key);
    if (v !== null) initial[key] = v;
  }
  const state = signal<T>(initial);

  effect(() => {
    const s = state();
    const queryParams: Record<string, string | null> = {};
    for (const key of Object.keys(defaults) as K[]) {
      const v = s[key];
      queryParams[key] = v && v !== defaults[key] ? v : null;
    }
    router.navigate([], { relativeTo: route, queryParams, queryParamsHandling: 'merge', replaceUrl: true });
  });

  return state;
}
