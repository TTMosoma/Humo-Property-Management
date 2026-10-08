import { Observable } from 'rxjs';
import { AddOnId, Feature, PackageId } from '../models/entitlement';
import { NudgeDefinition, NudgePlacement } from '../models/nudge';
import { UpgradeRequest } from '../models/opportunity';
import { BusinessOverview, CustomerPlan, PlatformCustomer, SubscriptionChange } from '../models/platform';

/** Humo's customers, subscriptions, health and opportunities (Humo staff only). */
export abstract class PlatformDataSource {
  abstract customers(): Observable<PlatformCustomer[]>;
  abstract customer(organisationId: string): Observable<PlatformCustomer | undefined>;
  abstract overview(): Observable<BusinessOverview>;
  /** Sensitive: needs Platform.Subscriptions.Manage and step-up. */
  abstract changeSubscription(organisationId: string, change: SubscriptionChange): Observable<void>;
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
