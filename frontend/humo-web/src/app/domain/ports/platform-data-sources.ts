import { Observable } from 'rxjs';
import { ListQuery, Page } from './list-query';
import { AddOn, AddOnId, Feature, FeatureDef, Package, PackageId } from '../models/entitlement';
import { NudgeDefinition, NudgePlacement } from '../models/nudge';
import { UpgradeRequest } from '../models/opportunity';
import { BusinessOverview, CustomerPlan, PlatformCustomer, SubscriptionChange } from '../models/platform';

/** The product catalogue: what can be sold, and what each package and add-on contains. */
export interface Catalogue {
  features: FeatureDef[];
  packages: Package[];
  addOns: AddOn[];
}

/**
 * Published by the API (GET /catalogue); everyone may read it. Editing it is
 * Platform.Packages.Manage, later. Feature keys stay in code — the app gates
 * on them — but names, packaging and add-ons are data.
 */
export abstract class CatalogueDataSource {
  abstract catalogue(): Observable<Catalogue>;
}

/** Humo's customers, subscriptions, health and opportunities (Humo staff only). */
export abstract class PlatformDataSource {
  abstract customers(query?: ListQuery): Observable<Page<PlatformCustomer>>;
  abstract customer(organisationId: string): Observable<PlatformCustomer | undefined>;
  abstract overview(): Observable<BusinessOverview>;
  /** Sensitive: needs Platform.Subscriptions.Manage and step-up. */
  abstract changeSubscription(organisationId: string, change: SubscriptionChange, expectedVersion?: number): Observable<void>;
  abstract updateRequest(requestId: string, status: UpgradeRequest['status']): Observable<void>;
}

/** The customer's own view of their plan (Agency Administrator). They can ask, not enable. */
export abstract class PlanDataSource {
  abstract mine(organisationId: string): Observable<CustomerPlan | undefined>;
  abstract requestUpgrade(input: { organisationId: string; addOn?: AddOnId; package?: PackageId; feature?: Feature; note?: string; source: UpgradeRequest['source'] }): Observable<void>;
}

export interface ServedNudge {
  definition: NudgeDefinition;
  /** The usage line filled in with this customer's own numbers. */
  usageLine: string;
  /** Plain explanation for "Why am I seeing this?". */
  why: string;
}

/**
 * Smart Nudges. The server decides relevance and frequency (so the rules are
 * the same on every device); the client only asks "anything for this place?".
 */
export abstract class NudgeDataSource {
  abstract next(placement: NudgePlacement): Observable<ServedNudge | null>;
  abstract record(nudgeId: string, event: 'dismissed' | 'not-interested' | 'learn-more' | 'snoozed'): Observable<void>;
}
