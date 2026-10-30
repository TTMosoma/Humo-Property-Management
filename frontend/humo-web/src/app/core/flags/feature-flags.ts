import { Injectable, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, of, retry, switchMap, timer } from 'rxjs';
import { OpsDataSource } from '../../domain';
import { SessionService } from '../session/session.service';

/** Tries after a failed read: 2, 4, 8, 16 and 32 seconds later (about a minute in all). */
const RETRIES = 5;

/**
 * The feature flags evaluated for the signed-in organisation (part of the
 * session bootstrap in the real API). Flags are technical rollout; plan
 * entitlements are separate (SessionService.hasFeature). A screen shows a
 * feature only when both allow it. Unknown or not-yet-loaded flags are off.
 *
 * Read again whenever someone signs in or switches role, and retried after a
 * failure (e.g. the API restarting), so an open tab catches up without a reload.
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlags {
  private readonly ops = inject(OpsDataSource);
  private readonly session = inject(SessionService);
  /** Who's signed in, as which assignment: a change reads the flags again. */
  private readonly who = computed(() => (this.session.signedIn() ? `${this.session.identity().id}:${this.session.assignment().id}` : ''));

  private readonly values = toSignal(
    toObservable(this.who).pipe(
      switchMap((who) =>
        who
          ? this.ops.myFlags().pipe(
              retry({ count: RETRIES, delay: (_e, attempt) => timer(2000 * 2 ** (attempt - 1)) }),
              catchError(() => of({} as Record<string, boolean>)),
            )
          : of({} as Record<string, boolean>),
      ),
    ),
    { initialValue: {} as Record<string, boolean> },
  );

  on(key: string): boolean {
    return !!this.values()[key];
  }
}
