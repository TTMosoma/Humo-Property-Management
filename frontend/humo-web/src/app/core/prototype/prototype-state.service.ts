import { Injectable, effect, signal } from '@angular/core';
import { safeStorage } from './safe-storage';

/**
 * How pages should render, so loading / empty / error states can be reviewed on demand.
 * - live:    normal mock data
 * - loading: pages stay in their loading skeleton
 * - empty:   pages render their empty state
 * - error:   data calls fail and pages render their error state
 */
export type ViewState = 'live' | 'loading' | 'empty' | 'error';
export type ThemePref = 'system' | 'light' | 'dark';

/** Prototype-only controls. Delete this folder when a real backend exists. */
@Injectable({ providedIn: 'root' })
export class PrototypeStateService {
  readonly viewState = signal<ViewState>('live');
  readonly latency = signal(safeStorage.get('humo.latency') !== 'off');
  readonly theme = signal<ThemePref>((safeStorage.get('humo.theme') as ThemePref) ?? 'system');

  constructor() {
    effect(() => {
      const theme = this.theme();
      safeStorage.set('humo.theme', theme);
      const root = document.documentElement;
      if (theme === 'system') {
        root.removeAttribute('data-theme');
      } else {
        root.setAttribute('data-theme', theme);
      }
    });
    effect(() => safeStorage.set('humo.latency', this.latency() ? 'on' : 'off'));
  }
}
