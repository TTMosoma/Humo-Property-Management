import { Identity, StaffRef, activeAssignments } from '../../domain';
import { PERSONAS } from './personas';

/**
 * Mock-server helpers for names and managers, derived from the identities —
 * the same joins the API does. Feature code never imports this file. At runtime
 * use StaffDirectory (live identities); the PERSONAS default is for seeding.
 */

/** The longest-standing active portfolio manager covering a scheme. */
export function portfolioManagerOf(schemeId: string, identities: Identity[] = PERSONAS): StaffRef | null {
  const candidates = identities
    .filter((i) => i.status === 'active')
    .flatMap((i) =>
      activeAssignments(i)
        .filter((a) => a.role === 'portfolio-manager' && a.scope.schemeIds.includes(schemeId))
        .map((a) => ({ i, at: a.grantedAt ?? '' })),
    )
    .sort((a, b) => a.at.localeCompare(b.at));
  const first = candidates[0]?.i;
  return first ? { identityId: first.id, staffId: first.staffId, name: first.name } : null;
}

/** Assignee id (staff id or identity id) → name, for read models and activity logs. */
export function personName(id: string | null | undefined, identities: Identity[] = PERSONAS): string {
  if (!id) return 'Unassigned';
  const i = identities.find((p) => p.staffId === id || p.id === id);
  if (!i) return id;
  return i.staffId ? i.name : `${i.name} (${activeAssignments(i).some((a) => a.role === 'trustee') ? 'trustee' : 'resident'})`;
}
