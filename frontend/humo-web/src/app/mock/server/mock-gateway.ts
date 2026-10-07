import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap, throwError, timer } from 'rxjs';
import {
  AuditCategory,
  AuditEvent,
  Feature,
  PERMISSION_META,
  Permission,
  PolicyDenial,
  PolicyError,
  ROLE_PERMISSIONS,
  StepUpMethod,
} from '../../domain';
import { PolicyNotices } from '../../core/security/policy-notices';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { AccessStore } from '../db/access-store';
import { mockResponder } from '../mock-latency';

export interface CommandSpec {
  /** Past tense for the audit log, e.g. "Released payment batch". */
  action: string;
  resource?: string;
  resourceId?: string;
  amount?: number;
  schemeId?: string | null;
  /** The permission the API's policy requires. */
  permission?: Permission;
  /** The entitlement the API checks for the customer's subscription. */
  feature?: Feature;
  /** Force (or waive) step-up regardless of the permission's default, e.g. large approvals. */
  stepUp?: boolean;
  category?: AuditCategory;
  /** Allowed in Observe impersonation (e.g. ending the impersonation itself). */
  allowedWhileObserving?: boolean;
}

const DENIAL_REASON: Record<PolicyDenial, string> = {
  'observe-only': 'Observe mode is read-only',
  forbidden: 'Role does not have this permission',
  'step-up-required': 'Step-up verification was not fresh',
  'not-entitled': 'Not included in the agency’s plan',
};

/**
 * The prototype's stand-in for the API boundary. Every command from every mock
 * data source passes through here, which is where the real backend will:
 *   1. authorise (role permission, scope, entitlement) from the token's claims,
 *   2. refuse writes in Observe impersonation,
 *   3. require a fresh step-up proof for sensitive commands,
 *   4. append an audit record naming the actor AND the impersonated user.
 *
 * The browser's own checks (SessionService.can) are UX; these are the rules.
 */
@Injectable({ providedIn: 'root' })
export class MockGateway {
  private readonly session = inject(SessionService);
  private readonly scope = inject(ScopeService);
  private readonly store = inject(AccessStore);
  private readonly notices = inject(PolicyNotices);
  private readonly respond = mockResponder();

  command<T>(spec: CommandSpec, apply: () => T): Observable<T> {
    const denial = this.authorise(spec);
    if (denial) {
      this.audit(spec, 'denied', DENIAL_REASON[denial]);
      this.notices.report(denial);
      return timer(150).pipe(switchMap(() => throwError(() => new PolicyError(denial, DENIAL_REASON[denial]))));
    }
    return this.respond(null).pipe(
      map(() => {
        try {
          const result = apply();
          this.audit(spec, 'success');
          return result;
        } catch (e) {
          // Domain-level refusals (e.g. self-escalation) are audited like any other denial.
          if (e instanceof PolicyError) {
            this.audit(spec, 'denied', e.message);
            this.notices.report(e.code);
          }
          throw e;
        }
      }),
    );
  }

  /** Records an event without a command (e.g. the API noticing a sign-in). */
  audit(spec: CommandSpec, result: AuditEvent['result'], reason?: string, stepUp?: { method: StepUpMethod; device?: string }): void {
    const imp = this.session.impersonation();
    const actor = this.session.actor();
    const proof = this.session.stepUpProof();
    const needsProof = spec.stepUp ?? (spec.permission ? PERMISSION_META[spec.permission].stepUp : false);
    this.store.record({
      category: spec.category ?? 'activity',
      actor: { identityId: actor.id, name: actor.name },
      actingAs: imp ? { identityId: this.session.persona().id, name: this.session.persona().name } : undefined,
      role: this.session.role(),
      agencyId: this.session.agency()?.id ?? null,
      schemeId: spec.schemeId ?? this.scope.scopeId(),
      action: spec.action,
      resource: spec.resource,
      resourceId: spec.resourceId,
      amount: spec.amount,
      result,
      reason,
      stepUp: stepUp ?? (needsProof && result === 'success' && proof?.method ? { method: proof.method, device: proof.device } : undefined),
      impersonation: imp ? { mode: imp.mode, reason: imp.reason, note: imp.ticket } : undefined,
      session: { ip: '196.21.45.10', device: 'Chrome on Windows 11', sessionId: 's-current' },
    });
  }

  private authorise(spec: CommandSpec): PolicyDenial | null {
    if (this.session.readOnly() && !spec.allowedWhileObserving) return 'observe-only';
    if (spec.permission) {
      const m = this.session.membership();
      const granted = ROLE_PERMISSIONS[m.role].includes(spec.permission) || !!m.grants?.includes(spec.permission);
      if (!granted) return 'forbidden';
    }
    if (spec.feature && !this.session.hasFeature(spec.feature)) return 'not-entitled';
    const needsProof = spec.stepUp ?? (spec.permission ? PERMISSION_META[spec.permission].stepUp : false);
    if (needsProof && !this.session.stepUpFresh()) return 'step-up-required';
    return null;
  }
}
