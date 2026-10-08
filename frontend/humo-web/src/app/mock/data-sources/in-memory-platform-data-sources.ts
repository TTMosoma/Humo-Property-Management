import { Injectable, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, map, of, switchMap } from 'rxjs';
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
        },
        () => {
          // "Where authorised": Account Managers change only the accounts they look after.
          const role = this.session.assignment().role;
          if (role === 'humo-account-manager' && customer?.accountManagerId !== this.session.actor().id) {
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
  private readonly customers$ = toObservable(this.store.customers);

  /** Only what the customer should see about their own plan — not Humo's health or opportunity data. */
  mine(organisationId: string): Observable<CustomerPlan | undefined> {
    return this.customers$.pipe(
      switchMap((all) => {
        const c = all.find((x) => x.organisationId === organisationId);
        const plan: CustomerPlan | undefined = c && {
          organisationId,
          packageId: c.subscription.packageId,
          status: c.subscription.status,
          renewsAt: c.subscription.renewsAt,
          addOns: c.subscription.addOns,
          entitlements: c.entitlements,
          accountManager: c.accountManager,
          requests: c.requests,
        };
        return this.respond(plan);
      }),
    );
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
            why: `Because ${opp.reasons.join(', ').toLowerCase()}. Humo shows a suggestion like this at most once a month, never again if you choose “Not interested”, and never once you have it.`,
          };
        }
        return null;
      }),
    );
  }

  record(nudgeId: string, event: 'dismissed' | 'not-interested' | 'learn-more' | 'snoozed'): Observable<void> {
    if (!!!this.session.current.impersonation) {
      this.store.recordNudge(nudgeId, this.session.current.identity.id, this.session.current.organisation?.id ?? '', event);
    }
    if (event !== 'learn-more') this.store.sessionNudge = null;
    return of(undefined);
  }
}

/** The catalogue, from the seed constants the mock server prices with. */
@Injectable()
export class InMemoryCatalogueDataSource extends CatalogueDataSource {
  catalogue(): Observable<Catalogue> {
    return of({ features: FEATURES, packages: PACKAGES, addOns: ADD_ONS });
  }
}
