import { Injectable, computed, effect, signal } from '@angular/core';
import { Agency, Persona, Role } from '../../domain';
import { AGENCIES } from '../../mock/fixtures/agencies';
import { PERSONAS } from '../../mock/fixtures/personas';
import { safeStorage } from '../prototype/safe-storage';

/**
 * The current user and agency context.
 *
 * Prototype stand-in for authentication: the persona is chosen in the
 * prototype toolbar. Later this will be fed by the real identity provider,
 * and the rest of the app (which only reads these signals) won't change.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly personas = PERSONAS;
  readonly agencies = AGENCIES;

  private readonly personaId = signal(this.initialPersonaId());
  /** Only meaningful for the System Administrator, who can view any agency. */
  private readonly viewedAgencyId = signal<string>('acacia');

  readonly persona = computed<Persona>(
    () => PERSONAS.find((p) => p.id === this.personaId()) ?? PERSONAS[1],
  );
  readonly role = computed<Role>(() => this.persona().role);

  readonly agency = computed<Agency | undefined>(() => {
    const id = this.persona().agencyId ?? this.viewedAgencyId();
    return AGENCIES.find((a) => a.id === id);
  });

  readonly isStaff = computed(() =>
    ['agency-admin', 'portfolio-manager', 'finance'].includes(this.role()),
  );
  readonly isResident = computed(() => ['owner', 'tenant'].includes(this.role()));

  /** Where each role lands after "sign in" or when it opens a page it can't access. */
  readonly homeRoute = computed(() => {
    switch (this.role()) {
      case 'system-admin':
        return '/platform/agencies';
      case 'owner':
      case 'tenant':
        return '/my/home';
      default:
        return '/dashboard';
    }
  });

  constructor() {
    effect(() => safeStorage.set('humo.persona', this.personaId()));
  }

  switchPersona(id: string): void {
    this.personaId.set(id);
  }

  viewAgency(id: string): void {
    this.viewedAgencyId.set(id);
  }

  hasRole(roles: readonly Role[] | undefined): boolean {
    return !roles || roles.includes(this.role());
  }

  private initialPersonaId(): string {
    const stored = safeStorage.get('humo.persona');
    return PERSONAS.some((p) => p.id === stored) ? stored! : 'p-thandeka';
  }
}
