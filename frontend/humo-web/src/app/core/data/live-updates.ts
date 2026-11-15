import { InjectionToken } from '@angular/core';

/**
 * Other people's changes arriving while the app is open (docs/08 §5). The live build provides it
 * (`provideHttpData`, over SignalR); the prototype doesn't need it, as everything happens in this browser.
 */
export interface LiveUpdates {
  /** Starts listening, and keeps the connection in step with who is signed in. */
  start(): void;
}

export const LIVE_UPDATES = new InjectionToken<LiveUpdates>('LIVE_UPDATES');
