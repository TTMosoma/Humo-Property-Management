import { PersonSummary, RelationshipView } from '../../domain';
import { links } from '../accounts/account-view';

export interface RoleChip {
  label: string;
  kind: 'owner' | 'tenant' | 'trustee';
  route: string;
}

/** "Owner · KC 42", "Tenant · KC 17", "Chairperson · KC" — compact, clickable role labels. */
export function roleChips(p: PersonSummary): RoleChip[] {
  return p.relationships.map((r) => chipFor(r));
}

export function chipFor(r: RelationshipView): RoleChip {
  const { relationship: rel, scheme, unit } = r;
  if (rel.type === 'trustee') {
    return { kind: 'trustee', label: `${rel.portfolio ?? 'Trustee'} · ${scheme.code}`, route: links.scheme(scheme) };
  }
  return {
    kind: rel.type,
    label: `${rel.type === 'owner' ? 'Owner' : 'Tenant'} · ${scheme.code} ${unit?.number ?? ''}`,
    route: unit ? links.unit(scheme, unit) : links.scheme(scheme),
  };
}

export function hasRole(p: PersonSummary, type: 'owner' | 'tenant' | 'trustee'): boolean {
  return p.relationships.some((r) => r.relationship.type === type);
}
