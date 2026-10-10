import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { OpsDataSource } from '../../domain';

/**
 * The feature flags evaluated for the signed-in organisation (part of the
 * session bootstrap in the real API). Flags are technical rollout; plan
 * entitlements are separate (SessionService.hasFeature). A screen shows a
 * feature only when both allow it. Unknown or not-yet-loaded flags are off.
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlags {
  private readonly values = toSignal(inject(OpsDataSource).myFlags().pipe(catchError(() => of({} as Record<string, boolean>))), {
    initialValue: {} as Record<string, boolean>,
  });

  on(key: string): boolean {
    return !!this.values()[key];
  }
}
