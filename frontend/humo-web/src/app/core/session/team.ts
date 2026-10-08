import { Signal, computed, inject } from '@angular/core';
import { AccessDataSource, Identity, Role, activeAssignments } from '../../domain';
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
  /** Agency staff: everyone with a staff id. */
  staff: Signal<TeamMember[]>;
  /** Display name for an assignee id ("Unassigned" for none). */
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
    staff: computed(() => everyone().filter((m) => (directory.value() ?? []).some((i) => i.id === m.identityId && !!i.staffId))),
    nameOf: (id) => (id ? (byId().get(id)?.name ?? id) : 'Unassigned'),
    initialsOf: (id) => (id ? (byId().get(id)?.initials ?? '•') : '—'),
  };
}
