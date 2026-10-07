import { Injectable, computed, effect, signal } from '@angular/core';
import { AGENCY_STAFF, Agency, Membership, Persona, Role } from '../../domain';
import { AGENCIES } from '../../mock/fixtures/agencies';
import { PERSONAS } from '../../mock/fixtures/personas';
import { safeStorage } from '../prototype/safe-storage';

/**
 * The current user, their active membership (role + scope) and agency context.
 *
 * Prototype stand-in for authentication: the persona is chosen in the
 * prototype toolbar. Later this will be fed by the real identity provider,
 * and the rest of the app (which only reads these signals) won't change.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly personas = PERSONAS;
  readonly agencies = AGENCIES;

  private readonly personaId = signal(this.initial('humo.persona', PERSONAS.map((p) => p.id), 'p-thandeka'));
  private readonly membershipId = signal<string | null>(safeStorage.get('humo.membership'));

  /** System Administrator only: the agency being viewed in support mode (null = platform view). */
  readonly supportAgencyId = signal<string | null>(null);

  readonly persona = computed<Persona>(() => PERSONAS.find((p) => p.id === this.personaId()) ?? PERSONAS[1]);
  readonly memberships = computed(() => this.persona().memberships);

  readonly membership = computed<Membership>(() => {
    const all = this.memberships();
    return all.find((m) => m.id === this.membershipId()) ?? all[0];
  });

  readonly role = computed<Role>(() => this.membership().role);

  readonly agency = computed<Agency | undefined>(() => {
    const id = this.membership().agencyId ?? this.supportAgencyId();
    return AGENCIES.find((a) => a.id === id);
  });

  readonly isStaff = computed(() => AGENCY_STAFF.includes(this.role()));
  readonly isResident = computed(() => this.role() === 'owner' || this.role() === 'tenant');

  /** Ids that work items may be assigned to for this person (staff id and persona id). */
  readonly selfIds = computed(() => [this.persona().staffId, this.persona().id].filter((x): x is string => !!x));

  /** Where each role lands. The dashboard returns as the landing page once it is built on real data. */
  readonly homeRoute = computed(() => {
    switch (this.role()) {
      case 'system-admin':
        return '/platform/agencies';
      case 'owner':
      case 'tenant':
        return '/my/home';
      case 'trustee':
        return '/approvals';
      default:
        return '/tasks';
    }
  });

  constructor() {
    effect(() => safeStorage.set('humo.persona', this.personaId()));
    effect(() => safeStorage.set('humo.membership', this.membership().id));
  }

  switchPersona(id: string): void {
    this.personaId.set(id);
    this.membershipId.set(null);
    this.supportAgencyId.set(null);
  }

  switchMembership(id: string): void {
    this.membershipId.set(id);
  }

  viewAgency(id: string | null): void {
    this.supportAgencyId.set(id);
  }

  hasRole(roles: readonly Role[] | undefined): boolean {
    return !roles || roles.includes(this.role());
  }

  private initial(key: string, allowed: string[], fallback: string): string {
    const stored = safeStorage.get(key);
    return stored && allowed.includes(stored) ? stored : fallback;
  }
}
