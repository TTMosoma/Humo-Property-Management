import { Injectable, inject } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { EMPTY, Observable, defer, map, of, switchMap } from 'rxjs';
import { StepUpRequest, StepUpResult } from '../../domain';
import { SessionService } from '../session/session.service';
import { StepUpDialog } from './step-up-dialog';

/**
 * Asks for a fresh proof of identity before a sensitive action.
 *
 *   this.stepUp.guard({ action: 'release-payment', detail: '…' }, () => data.releaseBatch(id))
 *
 * If a proof is still fresh (5 minutes), the action runs straight away. If the
 * person cancels, nothing runs. The API checks freshness again — this is the UX.
 */
@Injectable({ providedIn: 'root' })
export class StepUpService {
  private readonly dialog = inject(Dialog);
  private readonly session = inject(SessionService);

  /** Emits true once verified (or already fresh), false if cancelled or failed. */
  require(request: StepUpRequest): Observable<boolean> {
    if (this.session.stepUpFresh()) return of(true);
    return defer(() => {
      const ref = this.dialog.open<StepUpResult, StepUpRequest>(StepUpDialog, {
        data: request,
        ariaLabel: 'Additional verification required',
        backdropClass: 'cdk-overlay-dark-backdrop',
        panelClass: 'step-up-pane',
        disableClose: false,
        autoFocus: 'first-tabbable',
      });
      return ref.closed;
    }).pipe(
      map((result) => {
        if (result?.verified) this.session.stepUpProof.set(result);
        return !!result?.verified;
      }),
    );
  }

  /** Runs `action` only after verification. Completes silently if cancelled. */
  guard<T>(request: StepUpRequest, action: () => Observable<T>): Observable<T> {
    return this.require(request).pipe(switchMap((ok) => (ok ? action() : EMPTY)));
  }
}
