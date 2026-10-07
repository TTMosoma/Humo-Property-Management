import { Identity, ROLE_LABELS, ROLE_META, RoleAssignment, RoleFamily } from '../../domain';

/** Shared helpers for the access screens. */

export function roleColor(a: Pick<RoleAssignment, 'role'>): string {
  return `var(--role-${ROLE_META[a.role].family})`;
}

export function assignmentTitle(a: RoleAssignment): string {
  return ROLE_LABELS[a.role];
}

/** Which tab a person falls under in Users & access (by their most senior assignment). */
export function familyOf(i: Identity, agencyId: string | null): RoleFamily {
  const order: RoleFamily[] = ['agency', 'governance', 'supplier', 'resident'];
  const fams = i.memberships.filter((m) => agencyId === null || m.agencyId === agencyId).map((m) => ROLE_META[m.role].family);
  return order.find((f) => fams.includes(f)) ?? 'resident';
}

export const FAMILY_LABELS: Record<RoleFamily, string> = {
  agency: 'Agency staff',
  governance: 'Trustees',
  resident: 'Owners & tenants',
  supplier: 'Suppliers',
  humo: 'Humo',
};
