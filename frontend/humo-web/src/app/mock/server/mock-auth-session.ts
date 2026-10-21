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
import { OrganisationStore } from '../db/organisation-store';

interface AuthState {
  identityId: string;
  signedIn: boolean;
  assignmentId: string | null;
  impersonation: ImpersonationSession | null;
}

const KEYS = { identity: 'humo.persona', signedOut: 'humo.signedOut', assignment: 'humo.membership', impersonation: 'humo.impersonation', browser: 'humo.browserTrust' };

/** Wrong codes a link takes before it's spent (the API's MaxCodeAttempts). */
const MAX_LINK_TRIES = 5;

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
  private readonly orgs = inject(OrganisationStore);

  private state: AuthState = this.restore();
  /** Server-side record of the latest step-up proof (the API checks its freshness). */
  private proof: StepUpResult | null = null;

  readonly session$ = new BehaviorSubject<CurrentSession>(this.compute());

  constructor() {
    // Role grants and subscription changes made elsewhere change what /me returns.
    effect(() => {
      this.store.identities();
      this.platform.seeds();
      this.orgs.all();
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

  /**
   * "Is this your own computer?", answered once per person on this browser (the API keeps it against the browser's
   * cookie). `true` means their own; `false` means shared.
   */
  browserAnswered(identityId: string): boolean {
    return identityId in this.browserAnswers();
  }

  answerBrowser(identityId: string, trusted: boolean): void {
    safeStorage.set(KEYS.browser, JSON.stringify({ ...this.browserAnswers(), [identityId]: trusted }));
  }

  /** Removing the trusted computer: the question comes back on the next sign-in here. */
  forgetBrowser(identityId: string): void {
    const { [identityId]: _, ...rest } = this.browserAnswers();
    safeStorage.set(KEYS.browser, JSON.stringify(rest));
  }

  private browserAnswers(): Record<string, boolean> {
    try {
      return JSON.parse(safeStorage.get(KEYS.browser) ?? '{}') as Record<string, boolean>;
    } catch {
      return {};
    }
  }

  /** Whose passkey this device holds: the last person who signed in here. */
  deviceIdentityId(): string {
    return this.state.identityId;
  }

  // ---- Sign-in links (SIMULATED, docs/18 R-8): kept in memory; the "email" is shown by the prototype controls.

  private readonly links = new Map<string, { identityId: string; code: string; triesLeft: number; expiresAt: number }>();

  /**
   * A one-time link for an active identity, and the six-digit code the asking
   * screen shows. Unknown addresses get nothing, silently (the code is still returned).
   */
  issueLink(email: string): string {
    const who = this.store.identities().find((i) => i.email.toLowerCase() === email.toLowerCase() && i.status === 'active');
    const token = `lnk-${Math.random().toString(36).slice(2, 12)}`;
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    if (who) this.links.set(token, { identityId: who.id, code, triesLeft: MAX_LINK_TRIES, expiresAt: Date.now() + 15 * 60_000 });
    return code;
  }

  /**
   * The identity a link signs in, when the code matches. A wrong code spends one
   * of five tries (`triesLeft` says how many remain); undefined if the link is
   * unknown, used, expired or out of tries.
   */
  redeemLink(token: string, code: string): { identityId: string } | { triesLeft: number } | undefined {
    const link = this.links.get(token);
    if (!link || link.expiresAt <= Date.now()) {
      this.links.delete(token);
      return undefined;
    }
    if (link.code !== code) {
      link.triesLeft -= 1;
      if (link.triesLeft > 0) return { triesLeft: link.triesLeft };
      this.links.delete(token);
      return undefined;
    }
    this.links.delete(token);
    return { identityId: link.identityId };
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

    // Server rule: nobody works in a suspended or archived organisation, and suspended people can't sign in at all.
    const open = (a: RoleAssignment) => {
      const org = this.orgs.get(a.scope.organisationId);
      return !org || org.status === 'active' || org.status === 'onboarding';
    };
    const available = activeAssignments(identity).filter(open);
    const assignments = target ? available.filter((a) => a.id === impersonation!.targetAssignmentId) : available;
    const active = assignments.find((a) => a.id === this.state.assignmentId) ?? assignments[0] ?? identity.assignments[0];

    const granted = new Set<Permission>([...ROLE_PERMISSIONS[active.role], ...(active.grants ?? [])]);
    // Observe impersonation: nothing that changes data (the gateway refuses it too).
    const permissions = impersonation?.mode === 'observe' ? [...granted].filter((p) => !PERMISSION_META[p].mutates) : [...granted];
    const actorPermissions = [...new Set(activeAssignments(actor).flatMap((a) => [...ROLE_PERMISSIONS[a.role], ...(a.grants ?? [])]))];

    const organisation = this.orgs.get(active.scope.organisationId) ?? null;
    const blocked: CurrentSession['blocked'] =
      actor.status === 'suspended' || actor.status === 'deactivated'
        ? `identity-${actor.status}`
        : !target && available.length === 0 && activeAssignments(identity).length > 0
          ? 'organisation-suspended'
          : null;
    const customerPlan = organisation && !isHumoRole(active.role);
    const subscription = customerPlan ? (this.platform.subscription(organisation.id) ?? null) : null;

    return {
      signedIn: this.state.signedIn && actor.status === 'active' && !blocked,
      blocked,
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
    const identityId = stored && this.store.identities().some((i) => i.id === stored) ? stored : 'p-sarah';
    let impersonation: ImpersonationSession | null = null;
    try {
      const s = JSON.parse(safeStorage.get(KEYS.impersonation) ?? 'null') as ImpersonationSession | null;
      impersonation = s && s.actorId === identityId && this.store.identity(s.targetId) ? s : null;
    } catch {
      impersonation = null;
    }
    return {
      identityId,
      // A first visit starts signed out, at the sign-in page.
      signedIn: safeStorage.get(KEYS.signedOut) === '0',
      assignmentId: safeStorage.get(KEYS.assignment) || null,
      impersonation,
    };
  }
}
