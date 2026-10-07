import { Feature, Role } from '../../domain';
import type { AttentionKey } from '../attention/attention.service';

export interface NavLink {
  id: string;
  label: string;
  icon?: string;
  route: string;
  roles: readonly Role[];
  /** Hidden when the agency's plan doesn't include the feature. */
  feature?: Feature;
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
