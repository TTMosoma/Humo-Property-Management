import { AccountHealth, UsageSnapshot } from './account-health';
import { EntitlementSet, PackageId, Subscription } from './entitlement';
import { Opportunity, UpgradeRequest } from './opportunity';

/**
 * The Humo business layer: Humo's customers (managing agencies), their
 * subscriptions and how they're doing. Customer-facing Humo PM never sees this.
 */
export interface PlatformCustomer {
  agencyId: string;
  name: string;
  city: string;
  province: string;
  customerSince: string;
  /** Humo Account Manager (identity id) and display name. */
  accountManagerId: string;
  accountManager: string;
  subscription: Subscription;
  entitlements: EntitlementSet;
  snapshot: UsageSnapshot;
  health: AccountHealth;
  opportunities: Opportunity[];
  requests: UpgradeRequest[];
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
  agencyId: string;
  packageId: PackageId;
  status: Subscription['status'];
  renewsAt: string;
  addOns: Subscription['addOns'];
  entitlements: EntitlementSet;
  accountManager: string;
  requests: UpgradeRequest[];
}

/** A change an authorised Humo person makes to a subscription. Always audited. */
export type SubscriptionChange =
  | { type: 'package'; packageId: PackageId; reason: string }
  | { type: 'add-on'; addOnId: Subscription['addOns'][number]['addOnId']; enabled: boolean; reason: string }
  | { type: 'override'; feature: Subscription['overrides'][number]['feature']; enabled: boolean | null; days?: number; reason: string };
