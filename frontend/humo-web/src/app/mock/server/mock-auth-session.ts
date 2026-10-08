import { Injectable, effect, inject, untracked } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  CurrentSession,
  Feature,
  Identity,
  ImpersonationSession,
  PERMISSION_META,
  Permission,
  ROLE_PERMISSIONS,
  RoleAssignment,
  STEP_UP_FRESH_MS,
  StepUpResult,
  activeAssignments,
  isHumoRole,
  resolveEntitlements,
} from '../../domain';
import { safeStorage } from '../../core/prototype/safe-storage';
import { AccessStore } from '../db/access-store';
import { PlatformStore } from '../db/platform-store';
import { ORGANISATIONS } from '../fixtures/organisations';

interface AuthState {
  identityId: string;
  signedIn: boolean;
  assignmentId: string | null;
  impersonation: ImpersonationSession | null;
}

const KEYS = { identity: 'humo.persona', signedOut: 'humo.signedOut', assignment: 'humo.membership', impersonation: 'humo.impersonation' };

/**
 * The prototype's server-side session: who is signed in, which assignment the
 * token is scoped to, any impersonation, and the last step-up proof. The real
 * API keeps this in the token and its session store; the client only ever sees
 * the computed `CurrentSession` (GET /me).
 */
@Injectable({ providedIn: 'root' })
export class MockAuthSession {
  private readonly store = inject(AccessStore);
  private readonly platform = inject(PlatformStore);

  private state: AuthState = this.restore();
  /** Server-side record of the latest step-up proof (the API checks its freshness). */
  private proof: StepUpResult | null = null;

  readonly session$ = new BehaviorSubject<CurrentSession>(this.compute());

  constructor() {
    // Role grants and subscription changes made elsewhere change what /me returns.
    effect(() => {
      this.store.identities();
      this.platform.seeds();
      untracked(() => this.publish());
    });
  }

  get current(): CurrentSession {
    return this.session$.value;
  }

  actor(): Identity {
    return this.current.actor;
  }

  assignment(): RoleAssignment {
    const s = this.current;
    return s.assignments.find((a) => a.id === s.activeAssignmentId)!;
  }

  can(permission: Permission): boolean {
    return this.current.permissions.includes(permission);
  }

  hasFeature(feature: Feature): boolean {
    const list = this.current.entitlements;
    return !list || !!list.find((e) => e.feature === feature)?.enabled;
  }

  stepUpFresh(): boolean {
    return !!this.proof?.verified && Date.now() - new Date(this.proof.at).getTime() < STEP_UP_FRESH_MS;
  }

  stepUpProof(): StepUpResult | null {
    return this.proof;
  }

  // ---- Session commands (called by the mock data sources) ----

  signIn(identityId?: string): void {
    const id = identityId && this.store.identity(identityId) ? identityId : this.state.identityId;
    this.proof = null;
    this.update({ identityId: id, signedIn: true, assignmentId: identityId ? null : this.state.assignmentId, impersonation: null });
  }

  signOut(): void {
    this.proof = null;
    this.update({ ...this.state, signedIn: false, assignmentId: null, impersonation: null });
  }

  switchAssignment(assignmentId: string): boolean {
    if (!this.current.assignments.some((a) => a.id === assignmentId)) return false;
    this.update({ ...this.state, assignmentId });
    return true;
  }

  startImpersonation(session: ImpersonationSession): void {
    this.update({ ...this.state, impersonation: session });
  }

  endImpersonation(): void {
    this.proof = null;
    this.update({ ...this.state, impersonation: null });
  }

  recordProof(result: StepUpResult): void {
    if (result.verified) this.proof = result;
  }

  // ---- Internals ----

  private update(next: AuthState): void {
    this.state = next;
    safeStorage.set(KEYS.identity, next.identityId);
    safeStorage.set(KEYS.signedOut, next.signedIn ? '0' : '1');
    safeStorage.set(KEYS.assignment, next.assignmentId ?? '');
    safeStorage.set(KEYS.impersonation, JSON.stringify(next.impersonation));
    this.publish();
  }

  private publish(): void {
    this.session$.next(this.compute());
  }

  private compute(): CurrentSession {
    const { identityId, impersonation } = this.state;
    const actor = this.store.identity(identityId) ?? this.store.identities()[0];
    const target = impersonation ? this.store.identity(impersonation.targetId) : undefined;
    const identity = target ?? actor;

    const available = activeAssignments(identity);
    const assignments = target ? available.filter((a) => a.id === impersonation!.targetAssignmentId) : available;
    const active = assignments.find((a) => a.id === this.state.assignmentId) ?? assignments[0] ?? identity.assignments[0];

    const granted = new Set<Permission>([...ROLE_PERMISSIONS[active.role], ...(active.grants ?? [])]);
    // Observe impersonation: nothing that changes data (the gateway refuses it too).
    const permissions = impersonation?.mode === 'observe' ? [...granted].filter((p) => !PERMISSION_META[p].mutates) : [...granted];
    const actorPermissions = [...new Set(activeAssignments(actor).flatMap((a) => [...ROLE_PERMISSIONS[a.role], ...(a.grants ?? [])]))];

    const organisation = ORGANISATIONS.find((o) => o.id === active.scope.organisationId) ?? null;
    const customerPlan = organisation && !isHumoRole(active.role);
    const subscription = customerPlan ? (this.platform.subscription(organisation.id) ?? null) : null;

    return {
      signedIn: this.state.signedIn && actor.status === 'active',
      actor,
      identity,
      assignments,
      activeAssignmentId: active.id,
      permissions,
      pagePermissions: [...granted],
      actorPermissions,
      organisation,
      subscription,
      entitlements: customerPlan ? resolveEntitlements(subscription ?? undefined).all : null,
      impersonation: target ? impersonation : null,
    };
  }

  private restore(): AuthState {
    const stored = safeStorage.get(KEYS.identity);
    const identityId = stored && this.store.identities().some((i) => i.id === stored && i.demo) ? stored : 'p-sarah';
    let impersonation: ImpersonationSession | null = null;
    try {
      const s = JSON.parse(safeStorage.get(KEYS.impersonation) ?? 'null') as ImpersonationSession | null;
      impersonation = s && s.actorId === identityId && this.store.identity(s.targetId) ? s : null;
    } catch {
      impersonation = null;
    }
    return {
      identityId,
      signedIn: safeStorage.get(KEYS.signedOut) !== '1',
      assignmentId: safeStorage.get(KEYS.assignment) || null,
      impersonation,
    };
  }
}
