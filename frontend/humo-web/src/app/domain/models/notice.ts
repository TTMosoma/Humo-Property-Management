import { Scheme } from './scheme';
import { Channel } from './settings';

/**
 * A notice: an announcement to a scheme's people from the managing agent or
 * the trustees ("Water off on Thursday", "Revised pet rule"). Residents see
 * it in the portal; it also goes out by the channels the agency's
 * notification rules set for new notices.
 */

export type NoticeAudience = 'residents' | 'owners' | 'trustees';

export const NOTICE_AUDIENCE_LABELS: Record<NoticeAudience, string> = {
  residents: 'Owners and tenants',
  owners: 'Owners only',
  trustees: 'Trustees only',
};

export type NoticeCategory = 'general' | 'maintenance' | 'meeting' | 'finance' | 'security' | 'rules';

export const NOTICE_CATEGORY_LABELS: Record<NoticeCategory, string> = {
  general: 'General',
  maintenance: 'Maintenance',
  meeting: 'Meetings',
  finance: 'Levies & finance',
  security: 'Security',
  rules: 'Rules',
};

export interface Notice {
  id: string;
  version: number;
  /** "NTC-KC-12" */
  ref: string;
  schemeId: string;
  title: string;
  body: string;
  audience: NoticeAudience;
  category: NoticeCategory;
  publishedAt: string;
  publishedBy: string;
  /** Kept at the top of the portal until it's unpinned or expires. */
  pinned: boolean;
  /** After this the notice is archived from the portal. */
  expiresAt?: string;
  /** How it went out, from the agency's notification rules at the time. */
  sentBy: Channel[];
  /** How many people it went to. */
  recipients: number;
  withdrawn?: { at: string; by: string; reason: string };
}

export interface NoticeView {
  notice: Notice;
  scheme: Scheme;
  /** Current: published, not expired, not withdrawn. */
  current: boolean;
}

export interface NewNotice {
  schemeId: string;
  title: string;
  body: string;
  audience: NoticeAudience;
  category: NoticeCategory;
  pinned: boolean;
  expiresAt?: string;
}
