import { Injectable, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, map, of, switchMap, throwError } from 'rxjs';
import {
  ADD_ONS,
  AddOnId,
  BusinessOverview,
  Catalogue,
  CatalogueDataSource,
  CustomerPlan,
  FEATURES,
  FEATURE_META,
  Feature,
  FieldErrors,
  InvoiceDocument,
  ListQuery,
  NUDGES,
  NudgeDataSource,
  NudgePlacement,
  PACKAGES,
  PackageId,
  Page,
  PlanDataSource,
  PlatformCustomer,
  PlatformDataSource,
  PolicyError,
  ServedNudge,
  SubscriptionChange,
  UpgradeRequest,
  evaluateNudge,
  fillNudge,
  isHumoRole,
  packageById,
} from '../../domain';
import { MockAuthSession } from '../server/mock-auth-session';
import { PlatformStore } from '../db/platform-store';
import { CommercialStore } from '../db/commercial-store';
import { StorageMeter } from '../db/storage-meter';
import { mockResponder } from '../mock-latency';
import { toPage } from '../mock-page';
import { MockGateway } from '../server/mock-gateway';

function describe(change: SubscriptionChange): string {
  switch (change.type) {
    case 'package':
      return `Changed package to ${packageById(change.packageId).name}`;
    case 'add-on':
      return `${change.enabled ? 'Added' : 'Removed'} the ${ADD_ONS.find((a) => a.id === change.addOnId)?.name} add-on`;
    case 'override':
      return change.enabled === null
        ? `Cleared the override on ${FEATURE_META[change.feature].label}`
        : `${change.enabled ? 'Granted' : 'Switched off'} ${FEATURE_META[change.feature].label}${change.days ? ` for ${change.days} days` : ''}`;
  }
}

@Injectable()
export class InMemoryPlatformDataSource extends PlatformDataSource {
  private readonly store = inject(PlatformStore);
  private readonly session = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();
  private readonly customers$ = toObservable(this.store.customers);
  private readonly overview$ = toObservable(this.store.overview);

  customers(query?: ListQuery): Observable<Page<PlatformCustomer>> {
    return this.customers$.pipe(switchMap((c) => this.respond(toPage(c, query))));
  }

  customer(organisationId: string): Observable<PlatformCustomer | undefined> {
    return this.customers$.pipe(switchMap((all) => this.respond(all.find((c) => c.organisationId === organisationId))));
  }

  overview(): Observable<BusinessOverview> {
    return this.overview$.pipe(switchMap((o) => this.respond(o)));
  }

  changeSubscription(organisationId: string, change: SubscriptionChange, expectedVersion?: number): Observable<void> {
    const customer = this.store.customers().find((c) => c.organisationId === organisationId);
    return this.gateway
      .command(
        {
          action: `${describe(change)} for ${customer?.name} — ${change.reason}`,
          resource: 'Subscription',
          resourceId: organisationId,
          category: 'security',
          permission: 'Platform.Subscriptions.Manage',
          version: { expected: expectedVersion, current: customer?.subscription.version },
          // D11: no approval, but every change is audited with its reason, so the API requires one.
          validate: (): FieldErrors | null => (!customer ? { organisationId: 'No such customer.' } : change.reason.trim().length < 8 ? { reason: 'Say why, in a few words. It goes in the audit log.' } : null),
        },
        () => {
          // "Where authorised": without Platform.Customers.AnyAccount, only the accounts you look after (D11).
          if (!this.session.can('Platform.Customers.AnyAccount') && customer?.accountManagerId !== this.session.actor().id) {
            throw new PolicyError('forbidden', 'Not one of your accounts');
          }
          this.store.change(organisationId, change, this.session.actor().name);
        },
      )
      .pipe(map(() => undefined));
  }

  updateRequest(requestId: string, status: UpgradeRequest['status']): Observable<void> {
    return this.gateway
      .command({ action: `Marked upgrade request ${status}`, resource: 'Upgrade request', resourceId: requestId, permission: 'Platform.Opportunities.Manage' }, () =>
        this.store.setRequestStatus(requestId, status),
      )
      .pipe(map(() => undefined));
  }
}

@Injectable()
export class InMemoryPlanDataSource extends PlanDataSource {
  private readonly store = inject(PlatformStore);
  private readonly session = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();
  private readonly commercial = inject(CommercialStore);
  private readonly storage = inject(StorageMeter);
  private readonly customers$ = toObservable(computed(() => ({ customers: this.store.customers(), agreements: this.commercial.agreements() })));
  private readonly invoices$ = toObservable(computed(() => (this.commercial.payments(), this.commercial.invoices())));

  /** Only what the customer should see about their own plan — not Humo's health or opportunity data. */
  mine(organisationId: string): Observable<CustomerPlan | undefined> {
    return this.customers$.pipe(
      switchMap(({ customers: all }) => {
        const c = all.find((x) => x.organisationId === organisationId);
        const agreement = this.commercial.agreement(organisationId);
        const plan: CustomerPlan | undefined = c && {
          organisationId,
          packageId: c.subscription.packageId,
          status: c.subscription.status,
          renewsAt: c.subscription.renewsAt,
          addOns: c.subscription.addOns,
          entitlements: c.entitlements,
          accountManager: c.accountManager,
          requests: c.requests,
          // Their storage and how they pay; never Humo's prices for other customers or its health data.
          storage: this.storage.summary(organisationId),
          billing: agreement && { preference: agreement.billing.preference, nextBillingDate: agreement.billing.nextBillingDate, renewal: { on: agreement.renewal.on, fee: agreement.renewal.fee } },
        };
        return this.respond(plan);
      }),
    );
  }

  /** Their own invoices only: an Agency Administrator of that organisation (the API checks the token's organisation). */
  invoices(organisationId: string): Observable<InvoiceDocument[]> {
    const refused = this.ownBilling(organisationId);
    if (refused) return throwError(() => refused);
    return this.invoices$.pipe(
      switchMap((all) =>
        this.respond(
          all
            .filter((i) => i.organisationId === organisationId)
            .sort((x, y) => y.periodStart.localeCompare(x.periodStart))
            .map((i) => this.commercial.invoiceDocument(i.id)!)
            .filter(Boolean),
        ),
      ),
    );
  }

  invoice(organisationId: string, invoiceId: string): Observable<InvoiceDocument | undefined> {
    const refused = this.ownBilling(organisationId);
    if (refused) return throwError(() => refused);
    return this.invoices$.pipe(
      switchMap(() => {
        const doc = this.commercial.invoiceDocument(invoiceId);
        return this.respond(doc?.invoice.organisationId === organisationId ? doc : undefined);
      }),
    );
  }

  private ownBilling(organisationId: string): PolicyError | null {
    if (this.session.current.organisation?.id !== organisationId) return new PolicyError('forbidden', 'Not your organisation');
    if (!this.session.can('Subscription.Request')) return new PolicyError('forbidden', 'Only agency administrators see Humo invoices');
    return null;
  }

  requestUpgrade(input: { organisationId: string; addOn?: AddOnId; package?: PackageId; feature?: Feature; note?: string; source: UpgradeRequest['source'] }): Observable<void> {
    const what = input.addOn ? ADD_ONS.find((a) => a.id === input.addOn)?.name : input.package ? packageById(input.package).name : input.feature ? FEATURE_META[input.feature].label : 'an upgrade';
    const me = this.session.current.identity;
    return this.gateway
      .command({ action: `Asked Humo about ${what}`, resource: 'Upgrade request', permission: 'Subscription.Request' }, () =>
        this.store.addRequest({ organisationId: input.organisationId, addOn: input.addOn, package: input.package, note: input.note, source: input.source, requestedBy: `${me.name} (Agency Administrator)` }),
      )
      .pipe(map(() => undefined));
  }
}

/**
 * The "server" side of Smart Nudges: relevance comes from the customer's
 * detected opportunities; frequency from evaluateNudge(). At most one nudge per
 * session, and never while impersonating.
 */
@Injectable()
export class InMemoryNudgeDataSource extends NudgeDataSource {
  private readonly store = inject(PlatformStore);
  private readonly session = inject(MockAuthSession);
  private readonly sources$ = toObservable(computed(() => ({ customers: this.store.customers(), states: this.store.nudges() })));

  next(placement: NudgePlacement): Observable<ServedNudge | null> {
    return this.sources$.pipe(
      map(({ customers, states }) => {
        const organisationId = this.session.current.organisation?.id;
        const me = this.session.current.identity.id;
        const customer = customers.find((c) => c.organisationId === organisationId);
        if (!customer || !!this.session.current.impersonation || isHumoRole(this.session.assignment().role)) return null;
        const served = this.store.sessionNudge;
        for (const def of NUDGES) {
          if (!def.placements.includes(placement) || !def.audience.includes(this.session.assignment().role)) continue;
          if (served && served !== def.id) continue;
          const state = states.find((s) => s.nudgeId === def.id && s.identityId === me);
          const verdict = evaluateNudge(def, state, customer.opportunities, new Date(), served === def.id);
          if (!verdict.show) continue;
          if (!served) {
            this.store.sessionNudge = def.id;
            queueMicrotask(() => this.store.recordNudge(def.id, me, customer.organisationId, 'shown'));
          }
          const opp = customer.opportunities.find((o) => o.rule === def.trigger.rule)!;
          return {
            definition: def,
            usageLine: fillNudge(def.usageLine, customer.snapshot),
            why: `Because ${opp.reasons.join(', ').toLowerCase()}. Humo Property Management shows a suggestion like this at most once a month, never again if you choose “Not interested”, and never once you have it.`,
          };
        }
        return null;
      }),
    );
  }

  record(nudgeId: string, event: 'dismissed' | 'not-interested' | 'learn-more' | 'snoozed'): Observable<void> {
    if (!this.session.current.impersonation) {
      this.store.recordNudge(nudgeId, this.session.current.identity.id, this.session.current.organisation?.id ?? '', event);
    }
    if (event !== 'learn-more') this.store.sessionNudge = null;
    return of(undefined);
  }
}

/** The catalogue: features and packages from the seed constants; add-ons from the commercial catalogue (docs/23). */
@Injectable()
export class InMemoryCatalogueDataSource extends CatalogueDataSource {
  private readonly addOns$ = toObservable(inject(CommercialStore).catalogue);

  catalogue(): Observable<Catalogue> {
    // Retired add-ons stay listed (existing lines still name them) but after the ones on sale.
    return this.addOns$.pipe(map((c) => ({ features: FEATURES, packages: PACKAGES, addOns: [...c.addOns].sort((a, b) => Number(a.status === 'retired') - Number(b.status === 'retired')).map(({ id, name, description, features }) => ({ id, name, description, features })) })));
  }
}
