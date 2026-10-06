import { Role } from '../../domain';

export interface NavBadge {
  count: number;
  /** 'attention' is used sparingly: only for items that are overdue or at risk. */
  tone?: 'neutral' | 'attention';
  label: string;
}

export interface NavLink {
  id: string;
  label: string;
  icon?: string;
  route: string;
  roles: readonly Role[];
  badge?: NavBadge;
  /** Extra words the command palette should match, e.g. "arrears" for Debtors. */
  keywords?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: string;
  children: NavLink[];
}

export type NavNode = NavLink | NavGroup;

export interface NavSection {
  id: string;
  /** Optional small caps heading above the section. */
  label?: string;
  nodes: NavNode[];
}

export function isGroup(node: NavNode): node is NavGroup {
  return (node as NavGroup).children !== undefined;
}
