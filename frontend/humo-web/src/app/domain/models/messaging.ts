import { Scheme } from './scheme';
import { Channel } from './settings';

/**
 * Communications (review finding F19: a capability, not a destination).
 * Templates with merge fields, Compose to an audience, and Sent — one record
 * of everything Humo PM sent (composed messages, notices, collection letters,
 * statements, inbox replies) with its delivery to each person.
 */

export type TemplateCategory = 'levies' | 'collections' | 'maintenance' | 'meetings' | 'general';

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  levies: 'Levies & statements',
  collections: 'Collections',
  maintenance: 'Maintenance',
  meetings: 'Meetings',
  general: 'General',
};

export interface MergeField {
  key: string;
  label: string;
  example: string;
}

/** What a template can fill in for each recipient. */
export const MERGE_FIELDS: MergeField[] = [
  { key: 'person.name', label: 'Recipient’s name', example: 'Anele Mthembu' },
  { key: 'person.firstName', label: 'First name', example: 'Anele' },
  { key: 'unit.number', label: 'Unit number', example: '42' },
  { key: 'scheme.name', label: 'Scheme', example: 'Kingfisher Court' },
  { key: 'account.number', label: 'Account number', example: 'KC-042' },
  { key: 'account.balance', label: 'Balance owing', example: 'R 4 405.50' },
  { key: 'account.overdue', label: 'Amount overdue', example: 'R 1 290.00' },
  { key: 'agency.name', label: 'Agency', example: 'Acacia' },
  { key: 'agency.phone', label: 'Agency phone', example: '011 555 0142' },
];

/** "{person.firstName}" → the value; unknown fields are left as they are so a mistake is visible. */
export function renderMerge(text: string, values: Record<string, string>): string {
  return text.replace(/\{([a-z]+\.[a-zA-Z]+)\}/g, (m, k: string) => values[k] ?? m);
}

export interface MessageTemplate {
  id: string;
  version: number;
  name: string;
  category: TemplateCategory;
  /** Email subject; SMS and WhatsApp use the body only. */
  subject: string;
  body: string;
  /** The channels it's written for (SMS needs it short). */
  channels: Channel[];
  /** Humo PM's starter templates can be edited but not deleted. */
  builtIn: boolean;
  updatedAt: string;
  updatedBy: string;
  archived?: boolean;
}

export type AudienceKind = 'owners' | 'residents' | 'tenants' | 'trustees' | 'arrears' | 'units';

export const AUDIENCE_LABELS: Record<AudienceKind, string> = {
  owners: 'All owners',
  residents: 'Owners and tenants',
  tenants: 'Tenants only',
  trustees: 'Trustees',
  arrears: 'Owners in arrears',
  units: 'Chosen units',
};

export interface Audience {
  schemeId: string;
  kind: AudienceKind;
  /** For "arrears": at least this many days overdue. */
  minDays?: 30 | 60 | 90;
  /** For "units": unit ids; their owners (and tenants, if `includeTenants`). */
  unitIds?: string[];
  includeTenants?: boolean;
}

export type DeliveryStatus = 'scheduled' | 'queued' | 'delivered' | 'read' | 'failed' | 'bounced';

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  scheduled: 'Scheduled',
  queued: 'Queued',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
  bounced: 'Bounced',
};

export interface Delivery {
  id: string;
  personId: string;
  name: string;
  unitLabel?: string;
  channel: Channel;
  /** Email address, phone number or "portal". */
  address: string;
  status: DeliveryStatus;
  at: string;
  error?: string;
  /** The merge values used for this person. */
  values: Record<string, string>;
  /** A statement link was emailed to this person, which staff can revoke. */
  hasLink?: boolean;
}

/** Someone the audience includes who can't be reached by any chosen channel. */
export interface SkippedRecipient {
  personId: string;
  name: string;
  unitLabel?: string;
  reason: string;
}

export type SentKind = 'message' | 'notice' | 'letter' | 'statement' | 'reminder' | 'reply';

export const SENT_KIND_LABELS: Record<SentKind, string> = {
  message: 'Message',
  notice: 'Notice',
  letter: 'Collection letter',
  statement: 'Statements',
  reminder: 'Reminders',
  reply: 'Inbox reply',
};

export interface SentMessage {
  id: string;
  version: number;
  /** "MSG-2041" */
  ref: string;
  kind: SentKind;
  schemeId: string;
  subject: string;
  /** The text with merge fields; each delivery has its own values. */
  body: string;
  templateId?: string;
  channels: Channel[];
  /** Who it went to, in words: "All owners · Kingfisher Court". */
  audienceLabel: string;
  createdAt: string;
  sentBy: string;
  /** In the future while scheduled. */
  sendAt: string;
  cancelled?: { at: string; by: string };
  deliveries: Delivery[];
  skipped: SkippedRecipient[];
  /** The record it came from (a notice, a billing run, a collection case). */
  source?: { label: string; route: string };
}

export interface SentView {
  message: SentMessage;
  scheme: Scheme;
  counts: Record<DeliveryStatus, number>;
  state: 'scheduled' | 'sending' | 'sent' | 'cancelled';
}

export interface ComposeInput {
  audience: Audience;
  templateId?: string;
  subject: string;
  body: string;
  channels: Channel[];
  /** ISO; omit to send now. */
  sendAt?: string;
}

export interface ComposePreview {
  audienceLabel: string;
  recipients: { personId: string; name: string; unitLabel?: string; channel: Channel; address: string; values: Record<string, string> }[];
  skipped: SkippedRecipient[];
  byChannel: Partial<Record<Channel, number>>;
}

export interface TemplateInput {
  name: string;
  category: TemplateCategory;
  subject: string;
  body: string;
  channels: Channel[];
}
