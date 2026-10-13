import { Environment, FeatureFlag, FlagRule, IncidentStatus, MaintenanceWindow, NewIncident, PlatformHealth, SystemConfig } from '../models/ops';
import { Observable } from 'rxjs';
import { ListQuery, Page } from './list-query';
import { AddOn, AddOnId, Feature, FeatureDef, Package, PackageId } from '../models/entitlement';
import { NudgeDefinition, NudgePlacement } from '../models/nudge';
import { UpgradeRequest } from '../models/opportunity';
import { BusinessOverview, CustomerPlan, PlatformCustomer, SubscriptionChange } from '../models/platform';
import { InvoiceDocument } from '../models/commercial';
import { AccountApprovalPolicy, AccountDecision, AccountPolicySetting, AccountRequestView, AccountSubmission, NewAccountDetails } from '../models/account-request';

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
  /** Their own Humo invoices (Agency Administrator, own organisation only), newest first. */
  abstract invoices(organisationId: string): Observable<InvoiceDocument[]>;
  abstract invoice(organisationId: string, invoiceId: string): Observable<InvoiceDocument | undefined>;
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

/**
 * Platform operations (Humo staff only):
 *   GET   /ops/flags                       every flag with its rules per environment
 *   PUT   /ops/flags/{key}/{environment}   change a rule (production: step-up); audited with a reason
 *   GET   /me/flags                        the flags evaluated for the caller's organisation (session bootstrap)
 *   GET   /ops/config   PUT /ops/config    system configuration
 *   GET   /system/status                   public: the maintenance banner
 *   GET   /ops/health                      availability, latency, integrations, jobs, incidents
 *   POST  /ops/jobs/{id}/retry
 *   POST  /ops/incidents   POST /ops/incidents/{id}/updates
 */
export abstract class OpsDataSource {
  abstract flags(): Observable<FeatureFlag[]>;
  abstract updateFlag(key: string, environment: Environment, rule: FlagRule, reason: string, expectedVersion?: number): Observable<void>;
  abstract myFlags(): Observable<Record<string, boolean>>;
  abstract config(): Observable<SystemConfig>;
  abstract updateConfig(config: Omit<SystemConfig, 'version'>, reason: string, expectedVersion?: number): Observable<void>;
  abstract maintenance(): Observable<MaintenanceWindow | null>;
  abstract health(): Observable<PlatformHealth>;
  abstract retryJob(jobId: string): Observable<void>;
  abstract declareIncident(input: NewIncident): Observable<string>;
  abstract updateIncident(id: string, status: IncidentStatus, message: string, expectedVersion?: number): Observable<void>;
}

/**
 * New customer accounts (docs/21). Opening an account is a request: the API
 * decides from the submitter's permissions and the policy whether it waits for
 * a System Administrator or is activated under delegated authority. The client
 * never says which.
 *
 *   GET   /platform/account-requests                 requests, with their organisation's status
 *   POST  /platform/account-requests                 submit → { outcome: pending | activated }
 *   POST  /platform/account-requests/{id}/decision   approve | reject (Platform.Customers.Approve)
 *   GET   /platform/account-policy                   the policy in force
 *   PUT   /platform/account-policy                   change it (Platform.Config.Manage, step-up, reason)
 */
export abstract class AccountRequestDataSource {
  abstract list(): Observable<AccountRequestView[]>;
  abstract get(id: string): Observable<AccountRequestView | undefined>;
  abstract submit(details: NewAccountDetails): Observable<AccountSubmission>;
  abstract decide(id: string, decision: AccountDecision, expectedVersion?: number): Observable<void>;
  abstract policy(): Observable<AccountPolicySetting>;
  abstract setPolicy(policy: AccountApprovalPolicy, reason: string, expectedVersion?: number): Observable<void>;
}
