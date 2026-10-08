import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map, of, switchMap, tap } from 'rxjs';
import { AccessDataSource, ImpersonationMode, ImpersonationReason, ROLE_LABELS } from '../../domain';
import { FeedbackService } from '../feedback/feedback.service';
import { ScopeService } from '../scope/scope.service';
import { SessionService } from '../session/session.service';
import { StepUpService } from './step-up.service';

export interface StartImpersonation {
  targetId: string;
  targetAssignmentId: string;
  mode: ImpersonationMode;
  reason: ImpersonationReason;
  note?: string;
  ticket?: string;
}

/**
 * Impersonation is NOT role switching:
 *   Role switch   — "I am Sarah, operating as Finance User."
 *   Impersonation — "I am Terry, viewing Humo Property Management as Sarah."
 *
 * Only identities individually granted System.Impersonate can start it. Every
 * start, end and action is audited with both identities. Act mode needs a
 * fresh step-up; Observe mode is read-only (enforced by the API).
 */
@Injectable({ providedIn: 'root' })
export class ImpersonationService {
  private readonly session = inject(SessionService);
  private readonly scope = inject(ScopeService);
  private readonly access = inject(AccessDataSource);
  private readonly stepUp = inject(StepUpService);
  private readonly router = inject(Router);
  private readonly feedback = inject(FeedbackService);

  readonly busy = signal(false);

  /** Emits true when impersonation started, false if cancelled at step-up. */
  start(input: StartImpersonation, targetName: string): Observable<boolean> {
    const verify =
      input.mode === 'act'
        ? this.stepUp.require({ action: 'impersonate-act', detail: `Act as ${targetName}, with the ability to change their data` })
        : of(true);
    return verify.pipe(
      switchMap((ok) => {
        if (!ok) return of(false);
        this.busy.set(true);
        return this.access.startImpersonation(input).pipe(
          tap({
            next: (s) => {
              this.busy.set(false);
              this.scope.setScope(null);
              // The server session now renders the target; /me reflects it.
              this.router.navigateByUrl(this.session.homeRoute());
            },
            error: () => this.busy.set(false),
          }),
          map(() => true),
        );
      }),
    );
  }

  exit(): void {
    const imp = this.session.impersonation();
    if (!imp) return;
    const name = this.session.identity().name;
    const role = ROLE_LABELS[this.session.role()];
    this.busy.set(true);
    this.access.endImpersonation(imp.id).subscribe({
      next: () => this.finish(name, role),
      // Ending must always work for the person, even if the response is lost; the server ends it on receipt.
      error: () => this.finish(name, role),
    });
  }

  private finish(name: string, role: string): void {
    this.busy.set(false);
    this.session.forgetLocalState();
    this.scope.setScope(null);
    this.router.navigateByUrl('/platform/users');
    this.feedback.info(`Impersonation ended. You’re back as ${this.session.actor().name} — you were viewing as ${name} (${role}).`);
  }
}
