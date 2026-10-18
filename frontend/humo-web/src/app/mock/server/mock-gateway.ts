import { Injectable, Injector, inject } from '@angular/core';
import { Observable, map, switchMap, throwError, timer } from 'rxjs';
import {
  ApiError,
  AuditCategory,
  AuditEvent,
  Feature,
  FieldErrors,
  PERMISSION_META,
  Permission,
  PolicyDenial,
  PolicyError,
  ROLE_PERMISSIONS,
  StepUpMethod,
} from '../../domain';
import { PolicyNotices } from '../../core/security/policy-notices';
import { ScopeService } from '../../core/scope/scope.service';
import { AccessStore } from '../db/access-store';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from './mock-auth-session';

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
  /** Server-side validation, after authorisation: field → message, or null when the input is fine. */
  validate?: () => FieldErrors | null;
  /** Optimistic concurrency: the version the caller saw, and the record's version now. */
  version?: { expected?: number; current?: number };
}

const DENIAL_REASON: Record<PolicyDenial, string> = {
  'observe-only': 'Observe mode is read-only',
  forbidden: 'Role does not have this permission',
  'step-up-required': 'Step-up verification was not fresh',
  'not-entitled': 'Not included in the agency’s plan',
  'out-of-scope': 'Outside the assignment’s schemes (D1)',
};

/**
 * The prototype's stand-in for the API boundary. Every command from every mock
 * data source passes through here, which is where the real backend will:
 *   1. refuse writes in Observe impersonation,
 *   2. authorise (role permission, scope, entitlement) from the token's claims,
 *   3. check the record hasn't changed since the caller saw it (409),
 *   4. validate the input (422 with field errors),
 *   5. only then require a fresh step-up proof for sensitive commands: a
 *      "step-up required" challenge the client answers with a passkey and
 *      retries, so nobody verifies for a request that was going to fail,
 *   6. append an audit record naming the actor AND the impersonated user.
 *
 * The browser's own checks (SessionService.can) are UX; these are the rules.
 */
@Injectable({ providedIn: 'root' })
export class MockGateway {
  private readonly auth = inject(MockAuthSession);
  /** The scheme in the client's scope chip (a request header in the real API). Looked up when needed: ScopeService itself reads schemes through this gateway's data sources. */
  private readonly injector = inject(Injector);
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
        const v = spec.version;
        if (v?.expected !== undefined && v.current !== undefined && v.expected !== v.current) {
          throw new ApiError('conflict', 'Someone else changed this first');
        }
        const invalid = spec.validate?.();
        if (invalid && Object.keys(invalid).length) throw new ApiError('validation', 'Some details need attention', invalid);
        // Step-up comes after validation. It's a challenge, not a refusal: nothing is audited until
        // the retried command succeeds (or is refused for another reason).
        if (this.needsProof(spec) && !this.auth.stepUpFresh()) throw new PolicyError('step-up-required', DENIAL_REASON['step-up-required']);
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
    const s = this.auth.current;
    const imp = s.impersonation;
    const actor = s.actor;
    const proof = this.auth.stepUpProof();
    const needsProof = this.needsProof(spec);
    this.store.record({
      category: spec.category ?? 'activity',
      actor: { identityId: actor.id, name: actor.name },
      actingAs: imp ? { identityId: s.identity.id, name: s.identity.name } : undefined,
      role: this.auth.assignment().role,
      organisationId: s.organisation?.id ?? null,
      schemeId: spec.schemeId ?? this.injector.get(ScopeService).scopeId(),
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
    if (this.auth.current.impersonation?.mode === 'observe' && !spec.allowedWhileObserving) return 'observe-only';
    // Permission is checked against the token's role, not the observe-filtered list (observe is reported above).
    if (spec.permission && !this.roleGrants(spec.permission)) return 'forbidden';
    if (spec.feature && !this.auth.hasFeature(spec.feature)) return 'not-entitled';
    // D1: changes are limited to the assignment's schemes, whatever the person may browse.
    if (spec.schemeId && this.outsideAssignment(spec.schemeId)) return 'out-of-scope';
    return null;
  }

  /** A scheme-scoped assignment acting on a scheme it doesn't cover. Organisation-wide and Humo roles aren't limited here. */
  private outsideAssignment(schemeId: string): boolean {
    const a = this.auth.assignment();
    return a.scope.type === 'schemes' && !a.scope.schemeIds.includes(schemeId);
  }

  /** Sensitive commands need a fresh step-up proof: forced or waived per command, otherwise the permission's default. */
  private needsProof(spec: CommandSpec): boolean {
    return spec.stepUp ?? (spec.permission ? !!PERMISSION_META[spec.permission].stepUp : false);
  }

  private roleGrants(permission: Permission): boolean {
    const a = this.auth.assignment();
    return ROLE_PERMISSIONS[a.role].includes(permission) || !!a.grants?.includes(permission);
  }
}
