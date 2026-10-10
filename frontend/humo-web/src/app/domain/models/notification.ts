import { Role } from './role';

export type NotificationKind = 'maintenance' | 'finance' | 'compliance' | 'communication' | 'governance';

/**
 * Something that happened (informational). Distinct from a WorkItem, which asks
 * someone to act. One event can produce both, but they are counted separately.
 */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  detail: string;
  /** Null for agency-wide events (e.g. a bank import). */
  schemeId: string | null;
  /** Roles that should receive it. */
  audience: Role[];
  /** For resident notifications: the unit it concerns. */
  unitLabel?: string;
  /** ISO timestamp. */
  at: string;
  read: boolean;
  link: string;
}
