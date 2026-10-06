export type NotificationKind = 'maintenance' | 'finance' | 'compliance' | 'communication' | 'governance';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  detail: string;
  schemeName?: string;
  /** ISO timestamp. */
  at: string;
  read: boolean;
  link: string;
}
