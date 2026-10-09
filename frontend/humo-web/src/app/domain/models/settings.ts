import { TrustAccount } from './account';
import { Scheme } from './scheme';

/**
 * An agency's own settings (Settings › Agency, Billing configuration,
 * Notifications) and each person's preferences (Settings › My profile).
 * The rules that billing, credit control and notifications follow come from
 * here, not from constants: the API reads them when it applies the rules.
 */

/** Billing and credit control rules, agency-wide. */
export interface BillingSettings {
  /** Interest on overdue amounts, % per month (e.g. 2 = 2% a month). */
  interestRate: number;
  /** Day of the month the next month's runs are prepared (1–28). */
  billingDay: number;
  /** Day of the month levies are due (1–28). */
  dueDay: number;
  /** Days between collection letters before the next step is due. */
  stepDays: number;
  /** Months after the financial year-end the AGM must be held by. */
  agmMonths: number;
}

export const DEFAULT_BILLING: BillingSettings = { interestRate: 2, billingDay: 25, dueDay: 7, stepDays: 14, agmMonths: 4 };

export type Channel = 'email' | 'sms' | 'whatsapp' | 'portal' | 'push';

export const CHANNEL_LABELS: Record<Channel, string> = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp', portal: 'Portal', push: 'Humo Mobile' };

/** Things that happen that someone should hear about. */
export type NotificationEvent =
  | 'payment-received'
  | 'statement-issued'
  | 'job-updated'
  | 'notice-published'
  | 'document-published'
  | 'collection-letter'
  | 'approval-waiting'
  | 'compliance-due';

export interface NotificationEventDef {
  id: NotificationEvent;
  label: string;
  /** Who receives it. */
  audience: 'residents' | 'staff' | 'trustees';
  description: string;
  channels: Channel[];
  /** Some messages must go out whatever the agency prefers (e.g. letters of demand by their legal channel). */
  required?: boolean;
}

export const NOTIFICATION_EVENTS: NotificationEventDef[] = [
  { id: 'payment-received', label: 'Payment received', audience: 'residents', description: 'An owner’s payment is allocated to their account.', channels: ['email', 'sms', 'portal'] },
  { id: 'statement-issued', label: 'Statement issued', audience: 'residents', description: 'The monthly statement is sent from a billing run.', channels: ['email', 'portal'] },
  { id: 'job-updated', label: 'Request updated', audience: 'residents', description: 'A request a resident reported moves on: quoted, scheduled, fixed.', channels: ['email', 'sms', 'whatsapp', 'portal'] },
  { id: 'notice-published', label: 'New notice', audience: 'residents', description: 'The agency or trustees publish a notice to the scheme.', channels: ['email', 'sms', 'whatsapp', 'portal'] },
  { id: 'document-published', label: 'New document', audience: 'residents', description: 'A document is shared with owners or a unit.', channels: ['email', 'portal'] },
  { id: 'collection-letter', label: 'Collection letters', audience: 'residents', description: 'Reminders, final demands and letters of demand. Always sent by the letter’s own channel.', channels: ['email', 'sms', 'portal'], required: true },
  { id: 'approval-waiting', label: 'Approval waiting', audience: 'trustees', description: 'A quote, invoice, payment or resolution needs a trustee’s decision.', channels: ['email', 'push', 'portal'] },
  { id: 'compliance-due', label: 'Compliance due', audience: 'staff', description: 'A compliance item becomes due within 30 days or overdue.', channels: ['email', 'push'] },
];

export interface NotificationRule {
  event: NotificationEvent;
  enabled: boolean;
  channels: Channel[];
}

export interface AgencyDetails {
  name: string;
  shortName: string;
  registrationNumber: string;
  vatNumber?: string;
  /** PPRA Fidelity Fund certificate number. */
  ffcNumber?: string;
  address: string;
  city: string;
  province: string;
  email: string;
  phone: string;
}

export interface AgencySettings {
  organisationId: string;
  /** Concurrency token. */
  version: number;
  details: AgencyDetails;
  billing: BillingSettings;
  notifications: NotificationRule[];
}

/** Each scheme's trust bank account, as statements and letters show it. */
export interface SchemeTrustAccount {
  scheme: Scheme;
  account: TrustAccount;
  /** The bank's confirmation is on file. */
  verified: boolean;
}

/** A person's own notification preferences. */
export interface PersonalPreferences {
  identityId: string;
  version: number;
  /** How the person hears about Tasks assigned to them and approvals waiting. */
  work: Channel[];
  /** A summary email of the day's work. */
  digest: 'none' | 'daily' | 'weekly';
  /** Quiet hours: no SMS or push between these times (24h "HH:MM"). */
  quietFrom?: string;
  quietTo?: string;
}
