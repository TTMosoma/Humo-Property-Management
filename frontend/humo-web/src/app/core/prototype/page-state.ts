import { DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { PrototypeStateService } from './prototype-state.service';

export type PageStatus = 'loading' | 'ready' | 'error';

/**
 * Gives a page a realistic lifecycle (loading → ready, or error) driven by the
 * prototype's state simulator. Pages render their skeleton, error and empty
 * states from this, so every screen exercises the same states consistently.
 *
 * Must be called in an injection context (a field initialiser).
 */
export function pageState() {
  const proto = inject(PrototypeStateService);
  const status = signal<PageStatus>('loading');
  let timer: ReturnType<typeof setTimeout> | undefined;

  const load = () => {
    clearTimeout(timer);
    status.set('loading');
    const state = proto.viewState();
    if (state === 'loading') return;
    const ms = proto.latency() ? 280 + Math.round(Math.random() * 320) : 0;
    timer = setTimeout(() => status.set(state === 'error' ? 'error' : 'ready'), ms);
  };

  effect(() => {
    proto.viewState();
    untracked(load);
  });
  inject(DestroyRef).onDestroy(() => clearTimeout(timer));

  return {
    status: status.asReadonly(),
    /** True when the simulator asks pages to render as if they had no data. */
    forceEmpty: computed(() => proto.viewState() === 'empty'),
    retry: load,
  };
}
