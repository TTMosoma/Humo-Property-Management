import { Signal, computed, inject } from '@angular/core';
import { AGENCY_QUEUE, AGENCY_STAFF, AccessDataSource, Identity, ROLE_PERMISSIONS, Role, activeAssignments } from '../../domain';
import { loadable } from '../data/loadable';
import { SessionService } from './session.service';

export interface TeamMember {
  /** The id work items and jobs use for assignees (staff id, or identity id for non-staff such as trustees). */
  id: string;
  identityId: string;
  name: string;
  initials: string;
  title?: string;
  roles: Role[];
}

export interface Team {
  /** Agency staff: everyone holding a staff role here. */
  staff: Signal<TeamMember[]>;
  /** Display name for an assignee id (the agency queue for none, P2-7). */
  nameOf(id: string | null | undefined): string;
  initialsOf(id: string | null | undefined): string;
}

function member(i: Identity, organisationId: string): TeamMember {
  return {
    id: i.staffId ?? i.id,
    identityId: i.id,
    name: i.name,
    initials: i.initials,
    title: i.title,
    roles: activeAssignments(i).filter((a) => a.scope.organisationId === organisationId).map((a) => a.role),
  };
}

/** D32: a rule breach goes only to someone who can act on it. The API checks this too. */
export function canTakeRuleBreaches(m: TeamMember): boolean {
  return m.roles.some((r) => ROLE_PERMISSIONS[r].includes('Rules.Enforce'));
}

/**
 * The organisation's people, for assignee pickers and names — from the access
 * directory, not a fixture. Call in an injection context.
 */
export function organisationTeam(): Team {
  const session = inject(SessionService);
  const access = inject(AccessDataSource);
  const orgId = computed(() => session.organisation()?.id ?? '');
  const directory = loadable(() => access.directory(orgId()));
  const everyone = computed(() => (directory.value() ?? []).map((i) => member(i, orgId())));
  const byId = computed(() => new Map(everyone().flatMap((m) => [[m.id, m] as const, [m.identityId, m] as const])));

  return {
    staff: computed(() => everyone().filter((m) => m.roles.some((r) => AGENCY_STAFF.includes(r)))),
    nameOf: (id) => (id ? (byId().get(id)?.name ?? id) : AGENCY_QUEUE),
    initialsOf: (id) => (id ? (byId().get(id)?.initials ?? '•') : '—'),
  };
}
