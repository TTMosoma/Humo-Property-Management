import { AccountHealth, UsageSnapshot } from './account-health';
import { Entitlement, PackageId, Subscription } from './entitlement';
import { OrganisationStatus } from './organisation';
import { BillingPreference, StorageSummary } from './commercial';
import { Opportunity, UpgradeRequest } from './opportunity';

/**
 * The Humo business layer: Humo's customers (managing agencies), their
 * subscriptions and how they're doing. Customer-facing Humo PM never sees this.
 */
export interface PlatformCustomer {
  organisationId: string;
  name: string;
  city: string;
  province: string;
  customerSince: string;
  /** Humo Account Manager (identity id) and display name. */
  accountManagerId: string;
  accountManager: string;
  /** The organisation's lifecycle (distinct from the subscription's commercial status). */
  status: OrganisationStatus;
  subscription: Subscription;
  /** Effective entitlements, as the API sends them (wrap with `entitlementSet()` for lookups). */
  entitlements: Entitlement[];
  snapshot: UsageSnapshot;
  health: AccountHealth;
  opportunities: Opportunity[];
  requests: UpgradeRequest[];
  /** Open support tickets (from the support desk later; mock today). */
  tickets: SupportTicket[];
}

export interface SupportTicket {
  id: string;
  organisationId: string;
  title: string;
  severity: 'critical' | 'normal';
  status: 'open' | 'escalated' | 'waiting-on-customer';
  openedAt: string;
  /** Humo person handling it. */
  owner: string;
}

export interface MonthPoint {
  /** "2026-10". */
  month: string;
  mrr: number;
  customers: number;
  newCustomers: number;
  churned: number;
  expansionMrr: number;
  churnedMrr: number;
  activeUsers: number;
}

/** Board-level view of the business, computed from customers + history. */
export interface BusinessOverview {
  mrr: number;
  arr: number;
  customers: number;
  schemes: number;
  units: number;
  activeUsers: number;
  /** Logo retention, trailing 12 months. */
  retention: number;
  /** Net revenue retention, trailing 12 months. */
  nrr: number;
  history: MonthPoint[];
  byPackage: { packageId: PackageId; customers: number; mrr: number }[];
  health: { healthy: number; atRisk: number; critical: number; atRiskMrr: number };
  /** Share of entitled customers actively using each module. */
  moduleUsage: { module: string; adoption: number }[];
  expansion: {
    likelyToUpgrade: number;
    potentialMrr: number;
    underutilising: number;
    demandWithoutFeature: number;
    top: Opportunity[];
  };
}

/** The customer's own view of their subscription: no health scores, opportunities or contract values. */
export interface CustomerPlan {
  organisationId: string;
  packageId: PackageId;
  status: Subscription['status'];
  renewsAt: string;
  addOns: Subscription['addOns'];
  entitlements: Entitlement[];
  accountManager: string;
  requests: UpgradeRequest[];
  storage?: StorageSummary;
  /** Their own terms: how they pay, and their own renewal fee (never other customers' prices). */
  billing?: { preference: BillingPreference; nextBillingDate: string; renewal: { on: string; fee: number | null } };
  /** This month's SMS and WhatsApp: what the package and bundles include, and what's been used. Resets on the 1st. */
  messages?: MessageAllowance[];
}

/** A month's messages on one channel. Nothing carries over to the next month. */
export interface MessageAllowance {
  channel: 'sms' | 'whatsapp';
  /** "SMS" (counted in billed parts) or "WhatsApp messages". */
  unit: string;
  /** With the package. */
  included: number;
  /** From bundles (allowance × quantity). */
  bundles: number;
  allowance: number;
  used: number;
  remaining: number;
  /** "2026-10" */
  period: string;
  /** The 1st of next month. */
  resetsOn: string;
  state: 'ok' | 'warning' | 'over';
}

/** A change an authorised Humo person makes to a subscription. Always audited. */
export type SubscriptionChange =
  | { type: 'package'; packageId: PackageId; reason: string }
  | { type: 'add-on'; addOnId: Subscription['addOns'][number]['addOnId']; enabled: boolean; reason: string }
  | { type: 'override'; feature: Subscription['overrides'][number]['feature']; enabled: boolean | null; days?: number; reason: string };
