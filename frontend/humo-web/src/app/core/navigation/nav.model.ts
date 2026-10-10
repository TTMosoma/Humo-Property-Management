import { Feature, Permission, Role } from '../../domain';
import type { AttentionKey } from '../attention/attention.service';

export interface NavLink {
  id: string;
  label: string;
  icon?: string;
  route: string;
  /** Who may see it: the permission its route needs. */
  permission: Permission;
  /** Presentation only: limit the entry to these roles' menus (access is still the permission). */
  audience?: readonly Role[];
  /** The plan feature it needs. Not entitled → shown locked (it explains and offers an upgrade request). */
  feature?: Feature;
  /** Set at runtime: the role may use it, but the plan doesn't include it. */
  locked?: boolean;
  /** Live count from the Attention model. Never hard-code numbers here. */
  badge?: AttentionKey;
  /** 'attention' is used sparingly: only for queues where items are overdue or at risk. */
  badgeTone?: 'neutral' | 'attention';
  /** Extra words the command palette should match, e.g. "arrears" for Credit control. */
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
