import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, map, shareReplay, take } from 'rxjs';
import {
  AGENCY_STAFF,
  EntitlementSet,
  Feature,
  Identity,
  Organisation,
  Permission,
  RoleAssignment,
  Role,
  STEP_UP_FRESH_MS,
  SessionDataSource,
  StepUpResult,
  entitlementSet,
  isHumoRole,
  SIGNED_OUT_SESSION,
} from '../../domain';

/** Shown only for the instant before /me answers; guards keep the shell closed until then. */
const SIGNED_OUT = SIGNED_OUT_SESSION;

/**
 * Who is signed in, and in what capacity — the client's view of the server
 * session (`SessionDataSource.current()`, i.e. GET /me).
 *
 *   Identity → Role (active assignment) → Permissions → Scope → Entitlements → Context
 *
 * - `actor()`    the authenticated human. Never changes when switching role.
 * - `identity()` the identity the app is rendered for: the actor, or the
 *                impersonated customer user during impersonation.
 * - `assignment()` the active role assignment (role + scope).
 * - `can(p)`     the effective permissions the server computed for it.
 *
 * Nothing here is computed from a permission table or a subscription: the
 * server decides and this service renders it. None of it is a security
 * boundary — the API enforces every rule again.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly source = inject(SessionDataSource);
  private readonly snapshot = toSignal(this.source.current(), { initialValue: SIGNED_OUT });
  private readonly firstAnswer$ = this.source.current().pipe(take(1), map(() => undefined), shareReplay(1));
  /** Set when the browser forgets the session even though the API didn't answer. */
  private readonly forgotten = signal(false);

  readonly signedIn = computed(() => this.snapshot().signedIn && !this.forgotten());

  /**
   * Completes once the server has answered /me (at once in the simulation). Guards wait for it,
   * so a reload or a link to a page doesn't land on the sign-in page while /me is on its way.
   */
  loaded(): Observable<void> {
    return this.firstAnswer$;
  }
  /** Why access is paused, if it is (an organisation suspended, or the person suspended). */
  readonly blocked = computed(() => this.snapshot().blocked);

  /** Last successful step-up proof, so the UI can skip asking again (the API checks freshness itself). */
  readonly stepUpProof = signal<StepUpResult | null>(null);

  /** Humo staff only: the organisation being looked at in support view (null = platform view). */
  private readonly supportView = signal<Organisation | null>(null);
  readonly supportOrganisationId = computed(() => this.supportView()?.id ?? null);

  readonly actor = computed<Identity>(() => this.snapshot().actor);
  readonly identity = computed<Identity>(() => this.snapshot().identity);
  readonly impersonation = computed(() => this.snapshot().impersonation);
  readonly isImpersonating = computed(() => !!this.impersonation());
  /** Observe impersonation: nothing that changes data is offered (and the API refuses it). */
  readonly readOnly = computed(() => this.impersonation()?.mode === 'observe');

  /** Assignments available to switch between. Impersonation is pinned to one assignment. */
  readonly assignments = computed<RoleAssignment[]>(() => this.snapshot().assignments);
  readonly assignment = computed<RoleAssignment>(() => {
    const s = this.snapshot();
    return s.assignments.find((a) => a.id === s.activeAssignmentId) ?? s.assignments[0];
  });
  readonly role = computed<Role>(() => this.assignment().role);

  /** The organisation in context: the assignment's, or the one Humo staff are viewing in support view. */
  readonly organisation = computed<Organisation | undefined>(() => this.snapshot().organisation ?? this.supportView() ?? undefined);

  readonly isHumo = computed(() => isHumoRole(this.role()));
  readonly isStaff = computed(() => AGENCY_STAFF.includes(this.role()));
  readonly isResident = computed(() => this.role() === 'owner' || this.role() === 'tenant');

  /** Effective permissions in this moment. */
  readonly permissions = computed<Set<Permission>>(() => new Set(this.snapshot().permissions));
  private readonly actorPermissions = computed<Set<Permission>>(() => new Set(this.snapshot().actorPermissions));
  private readonly pagePermissions = computed<Set<Permission>>(() => new Set(this.snapshot().pagePermissions));

  /** Ids that work items may be assigned to for this person (staff id and identity id). */
  readonly selfIds = computed(() => [this.identity().staffId, this.identity().id].filter((x): x is string => !!x));

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
      // Agency staff and trustees start on their dashboard: "what needs my attention?"
      default:
        return '/dashboard';
    }
  });

  /** The organisation's subscription (null for Humo staff). */
  readonly subscription = computed(() => this.snapshot().subscription ?? undefined);

  /** The organisation's effective entitlements (package + add-ons + overrides), as the server resolved them. */
  readonly entitlements = computed<EntitlementSet | null>(() => {
    const list = this.snapshot().entitlements;
    return list ? entitlementSet(list) : null;
  });

  /** Can the current role do this right now? UX only — the API decides. */
  can(permission: Permission): boolean {
    return this.permissions().has(permission);
  }

  /** May the active assignment open pages that need this permission? (Observe impersonation still can.) */
  canOpen(permission: Permission): boolean {
    return this.pagePermissions().has(permission);
  }

  /** The actor's own permission, regardless of impersonation (e.g. System.Impersonate). */
  actorCan(permission: Permission): boolean {
    return this.actorPermissions().has(permission);
  }

  /** Is this feature enabled for the organisation? Never "is this customer Enterprise?". */
  hasFeature(feature: Feature): boolean {
    return this.entitlements()?.has(feature) ?? true;
  }

  /** A step-up proof is still fresh enough for a sensitive action. */
  stepUpFresh(): boolean {
    const p = this.stepUpProof();
    return !!p?.verified && Date.now() - new Date(p.at).getTime() < STEP_UP_FRESH_MS;
  }

  /** Humo staff: look at one customer organisation in support view (null returns to the platform view). */
  viewOrganisation(organisation: Organisation | null): void {
    this.supportView.set(organisation);
  }

  /**
   * The browser forgets the session (sign-out, or ending impersonation when the
   * API is unreachable). Server-side state follows through AccessDataSource.
   */
  forgetLocalState(): void {
    this.stepUpProof.set(null);
    this.supportView.set(null);
  }

  /** Sign-out: forget everything locally, whether or not the API confirmed it. */
  signedOutLocally(): void {
    this.forgetLocalState();
    this.forgotten.set(true);
  }

  /** Called after the identity provider signs someone in. */
  signedInAgain(): void {
    this.forgetLocalState();
    this.forgotten.set(false);
  }
}
