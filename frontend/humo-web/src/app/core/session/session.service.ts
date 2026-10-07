import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  AGENCY_STAFF,
  Agency,
  EntitlementSet,
  Feature,
  Identity,
  ImpersonationSession,
  PERMISSION_META,
  Permission,
  ROLE_PERMISSIONS,
  RoleAssignment,
  Role,
  STEP_UP_FRESH_MS,
  StepUpResult,
  isHumoRole,
  resolveEntitlements,
} from '../../domain';
import { AccessStore } from '../../mock/db/access-store';
import { PlatformStore } from '../../mock/db/platform-store';
import { AGENCIES } from '../../mock/fixtures/agencies';
import { safeStorage } from '../prototype/safe-storage';

/**
 * Who is signed in, and in what capacity.
 *
 *   Identity → Role (active assignment) → Permissions → Scope → Entitlements → Context
 *
 * - `actor()`   the authenticated human. Never changes when switching role.
 * - `persona()` the identity the app is rendered for: the actor, or the
 *               impersonated customer user during impersonation.
 * - `membership()` the active role assignment (role + scope).
 * - `can(p)`    the role's permissions, plus individual grants, minus anything
 *               that mutates while in Observe impersonation.
 *
 * Prototype stand-in for authentication: the signed-in identity is chosen in the
 * prototype toolbar. The real identity provider will feed the same signals.
 * None of this is a security boundary — the API enforces every rule again.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly store = inject(AccessStore);
  private readonly platform = inject(PlatformStore);
  readonly agencies = AGENCIES;

  /** Identities offered in the prototype's "Sign in as" list. */
  readonly personas = computed(() => this.store.identities().filter((i) => i.demo));

  private readonly signedInId = signal(this.initial('humo.persona', 'p-sarah'));

  /** One Humo session covers every Humo product; signing out of one signs out of all. */
  readonly signedIn = signal(safeStorage.get('humo.signedOut') !== '1');
  private readonly membershipId = signal<string | null>(safeStorage.get('humo.membership'));

  /** Active impersonation (set only through ImpersonationService). */
  readonly impersonation = signal<ImpersonationSession | null>(this.restoreImpersonation());

  /** Last successful step-up proof in this session (the API checks the same freshness). */
  readonly stepUpProof = signal<StepUpResult | null>(null);

  /** Humo staff only: the agency being looked at in support view (null = platform view). */
  readonly supportAgencyId = signal<string | null>(null);

  /** The authenticated human. */
  readonly actor = computed<Identity>(() => this.find(this.signedInId()) ?? this.store.identities()[0]);

  /** The identity the app is rendered for (the impersonated user while impersonating). */
  readonly persona = computed<Identity>(() => {
    const imp = this.impersonation();
    return (imp && this.find(imp.targetId)) || this.actor();
  });

  readonly isImpersonating = computed(() => !!this.impersonation());
  /** Observe impersonation: nothing that changes data is offered (and the API refuses it). */
  readonly readOnly = computed(() => this.impersonation()?.mode === 'observe');

  /** Assignments available to switch between. Impersonation is pinned to one assignment. */
  readonly memberships = computed<RoleAssignment[]>(() => {
    const imp = this.impersonation();
    const all = this.persona().memberships;
    return imp ? all.filter((m) => m.id === imp.targetAssignmentId) : all;
  });

  readonly membership = computed<RoleAssignment>(() => {
    const all = this.memberships();
    return all.find((m) => m.id === this.membershipId()) ?? all[0];
  });

  readonly role = computed<Role>(() => this.membership().role);

  readonly agency = computed<Agency | undefined>(() => {
    const id = this.membership().agencyId ?? this.supportAgencyId();
    return AGENCIES.find((a) => a.id === id);
  });

  readonly isHumo = computed(() => isHumoRole(this.role()));
  readonly isStaff = computed(() => AGENCY_STAFF.includes(this.role()));
  readonly isResident = computed(() => this.role() === 'owner' || this.role() === 'tenant');

  /** What the active role (plus individual grants) allows, before impersonation limits. */
  private readonly granted = computed<Set<Permission>>(
    () => new Set([...ROLE_PERMISSIONS[this.role()], ...(this.membership().grants ?? [])]),
  );

  /** Effective permissions in this moment. */
  readonly permissions = computed<Set<Permission>>(() => {
    const granted = this.granted();
    if (!this.readOnly()) return granted;
    return new Set([...granted].filter((p) => !PERMISSION_META[p].mutates));
  });

  /** Ids that work items may be assigned to for this person (staff id and persona id). */
  readonly selfIds = computed(() => [this.persona().staffId, this.persona().id].filter((x): x is string => !!x));

  /** Where each role lands. */
  readonly homeRoute = computed(() => {
    const role = this.role();
    // Each Humo role has its own home: the board view, the book of accounts, or the customer list.
    if (role === 'humo-executive') return '/platform/executive';
    if (role === 'humo-account-manager') return '/platform/accounts';
    if (isHumoRole(role)) return '/platform/customers';
    switch (role) {
      case 'owner':
      case 'tenant':
        return '/my/home';
      case 'supplier':
        return '/contractor';
      // Agency staff and trustees start on their dashboard: "what needs my attention?"
      default:
        return '/dashboard';
    }
  });

  constructor() {
    effect(() => safeStorage.set('humo.persona', this.signedInId()));
    effect(() => safeStorage.set('humo.signedOut', this.signedIn() ? '0' : '1'));
    effect(() => safeStorage.set('humo.membership', this.membership().id));
    effect(() => safeStorage.set('humo.impersonation', JSON.stringify(this.impersonation())));
  }

  /** Can the current role do this right now? UX only — the API decides. */
  can(permission: Permission): boolean {
    return this.permissions().has(permission);
  }

  /** The actor's own permission, regardless of impersonation (e.g. System.Impersonate). */
  actorCan(permission: Permission): boolean {
    return this.actor().memberships.some((m) => ROLE_PERMISSIONS[m.role].includes(permission) || m.grants?.includes(permission));
  }

  /**
   * The agency's effective entitlements (package + add-ons + overrides).
   * Humo staff without an agency context aren't limited by a customer plan.
   */
  readonly subscription = computed(() => {
    const agency = this.agency();
    return agency && !this.isHumo() ? this.platform.subscription(agency.id) : undefined;
  });

  readonly entitlements = computed<EntitlementSet | null>(() => {
    const agency = this.agency();
    return agency && !this.isHumo() ? resolveEntitlements(this.platform.subscription(agency.id)) : null;
  });

  /** Is this feature enabled for the agency? Never "is this customer Enterprise?". */
  hasFeature(feature: Feature): boolean {
    return this.entitlements()?.has(feature) ?? true;
  }

  /** A step-up proof is still fresh enough for a sensitive action. */
  stepUpFresh(): boolean {
    const p = this.stepUpProof();
    return !!p?.verified && Date.now() - new Date(p.at).getTime() < STEP_UP_FRESH_MS;
  }

  /** Prototype: sign in as a different identity. Ends any impersonation. */
  /** End the Humo session: impersonation and any step-up proof go with it. Call through SignOutService. */
  signOut(): void {
    this.impersonation.set(null);
    this.stepUpProof.set(null);
    this.supportAgencyId.set(null);
    this.membershipId.set(null);
    this.signedIn.set(false);
  }

  /** Prototype sign-in: the real identity provider (passkey / Humo Mobile) replaces this. */
  signIn(id?: string): void {
    if (id) this.switchPersona(id);
    this.signedIn.set(true);
  }

  switchPersona(id: string): void {
    this.signedIn.set(true);
    this.signedInId.set(id);
    this.membershipId.set(null);
    this.supportAgencyId.set(null);
    this.impersonation.set(null);
    this.stepUpProof.set(null);
  }

  /** Changes the active assignment. Call through RoleSwitcher, which also tells the API. */
  switchMembership(id: string): void {
    if (this.memberships().some((m) => m.id === id)) this.membershipId.set(id);
  }

  viewAgency(id: string | null): void {
    this.supportAgencyId.set(id);
  }

  hasRole(roles: readonly Role[] | undefined): boolean {
    return !roles || roles.includes(this.role());
  }

  private find(id: string): Identity | undefined {
    return this.store.identities().find((i) => i.id === id);
  }

  private initial(key: string, fallback: string): string {
    const stored = safeStorage.get(key);
    return stored && this.store.identities().some((i) => i.id === stored && i.demo) ? stored : fallback;
  }

  private restoreImpersonation(): ImpersonationSession | null {
    try {
      const s = JSON.parse(safeStorage.get('humo.impersonation') ?? 'null') as ImpersonationSession | null;
      return s && s.actorId === this.signedInId() && this.store.identity(s.targetId) ? s : null;
    } catch {
      return null;
    }
  }
}
