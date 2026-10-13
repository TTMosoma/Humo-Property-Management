import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { OrganisationStore } from './organisation-store';
import { AccessStore } from './access-store';
import { CommercialStore } from './commercial-store';
import { simulationStorage } from '../simulation/simulation-storage';
import {
  ADD_ONS,
  BusinessOverview,
  NUDGES,
  FeatureModule,
  MODULE_KEY_FEATURE,
  MonthPoint,
  NudgeState,
  OrganisationStatus,
  PackageId,
  PlatformCustomer,
  Subscription,
  SubscriptionChange,
  SupportTicket,
  UpgradeRequest,
  applyAgreementChange,
  calculateHealth,
  chargesOn,
  inForce,
  isoDay,
  packageById,
  packageOn,
  termsOn,
  entitlementSet,
  detectOpportunities,
  resolveEntitlements,
} from '../../domain';
import { safeStorage } from '../../core/prototype/safe-storage';
import { CustomerSeed, seedCustomers, seedHistory, seedRequests } from './seed-platform';

/**
 * The prototype's Humo business backend: subscriptions, usage snapshots,
 * upgrade requests and nudge history. Health, opportunities and the business
 * overview are *computed* from these with the domain functions — the same
 * flywheel the real backend will run on real analytics:
 *
 *   usage → health → opportunities → nudge / Account Manager → upgrade → entitlements → usage
 */
const TICKET_TITLES = [
  'Statement PDF cuts off banking details',
  'Split receipt won’t allocate to two units',
  'Trustee can’t see the approved budget',
  'Bulk SMS to Block C not delivered',
  'Owner portal login loop on iPhone',
  'Import of September bank statement failed',
  'Levy increase not applied to two units',
  'Supplier invoice stuck in “awaiting approval”',
];

/** Mock support desk: the snapshot's ticket counts, turned into readable tickets. */
function ticketsFor(c: CustomerSeed): SupportTicket[] {
  const n = c.snapshot.openTickets;
  return Array.from({ length: n }, (_, i) => {
    const k = (c.organisationId.length * 7 + i * 3) % TICKET_TITLES.length;
    const critical = i < c.snapshot.criticalTickets;
    return {
      id: `HUMO-${2300 + ((c.organisationId.charCodeAt(0) * 13 + i * 17) % 90)}`,
      organisationId: c.organisationId,
      title: TICKET_TITLES[k],
      severity: critical ? 'critical' : 'normal',
      status: critical ? 'escalated' : i % 3 === 2 ? 'waiting-on-customer' : 'open',
      openedAt: new Date(Date.now() - (i + 1) * 2.5 * 86_400_000).toISOString(),
      owner: critical ? 'Terry Mosoma' : 'Lerato Dube',
    } satisfies SupportTicket;
  });
}

/** The organisation's lifecycle, as the mock derives it (the real one is recorded, not derived). */
function organisationStatus(c: CustomerSeed): OrganisationStatus {
  if (c.subscription.status === 'cancelled') return 'archived';
  if (c.subscription.status === 'suspended') return 'suspended';
  return Date.now() - new Date(c.customerSince).getTime() < 45 * 86_400_000 ? 'onboarding' : 'active';
}

@Injectable({ providedIn: 'root' })
export class PlatformStore {
  private readonly orgs = inject(OrganisationStore);
  private readonly access = inject(AccessStore);
  private readonly commercial = inject(CommercialStore);
  private readonly saved = simulationStorage.load<{ seeds: CustomerSeed[]; requests: UpgradeRequest[] }>('platform');
  readonly seeds = signal<CustomerSeed[]>(this.saved?.seeds ?? seedCustomers());
  readonly requests = signal<UpgradeRequest[]>(this.saved?.requests ?? seedRequests());
  /** Persisted so a dismissed nudge stays dismissed across reloads in the prototype. */
  readonly nudges = signal<NudgeState[]>(this.readNudges());
  /** The one nudge served in this browser session: it stays put rather than counting as "ignored". */
  sessionNudge: string | null = null;

  /**
   * The subscription in force today: package and add-ons from the commercial
   * agreement's dated lines (so a scheduled change takes effect on its date),
   * and the contract value from its recurring charges.
   */
  readonly effective = computed(() => {
    const today = isoDay(new Date());
    const catalogue = this.commercial.catalogue();
    const agreements = new Map(this.commercial.agreements().map((a) => [a.organisationId, a]));
    return new Map(
      this.seeds().map((c) => {
        const a = agreements.get(c.organisationId);
        if (!a) return [c.organisationId, c.subscription];
        const charges = chargesOn(a, today, { catalogue, schemes: c.snapshot.schemes, packageName: (id) => packageById(id).name });
        const sub: Subscription = {
          ...c.subscription,
          packageId: packageOn(a, today)?.packageId ?? c.subscription.packageId,
          addOns: inForce(a.addOns, today).map((l) => ({ addOnId: l.addOnId, since: l.from })),
          renewsAt: a.renewal.on,
          mrr: charges.recurringMonthly,
        };
        return [c.organisationId, sub];
      }),
    );
  });

  readonly customers = computed<PlatformCustomer[]>(() => {
    const requests = this.requests();
    const effective = this.effective();
    const addOns = this.commercial.catalogue().addOns;
    const people = new Map(this.access.identities().map((i) => [i.id, i.name]));
    return this.seeds().map((seed) => {
      const c = { ...seed, subscription: effective.get(seed.organisationId) ?? seed.subscription };
      const entitlements = resolveEntitlements(c.subscription, new Date(), addOns);
      const health = calculateHealth(c.snapshot, entitlements);
      const opportunities = detectOpportunities({ snapshot: c.snapshot, entitlements, subscription: c.subscription, health });
      return {
        ...c,
        // Live from the staff record, never a stored name.
        accountManager: people.get(c.accountManagerId) ?? 'Unassigned',
        name: this.orgs.get(c.organisationId)?.shortName ?? c.name,
        status: this.orgs.get(c.organisationId)?.status ?? organisationStatus(c),
        entitlements: entitlements.all,
        health,
        opportunities,
        requests: requests.filter((r) => r.organisationId === c.organisationId),
        tickets: ticketsFor(c),
      };
    });
  });

  private readonly history = seedHistory(
    this.seeds().reduce((n, c) => n + c.subscription.mrr, 0),
    this.seeds().length,
    this.seeds().reduce((n, c) => n + c.snapshot.activeUsers30d + (c.snapshot.portalUsers30d ?? 0), 0),
  );

  readonly overview = computed<BusinessOverview>(() => {
    const all = this.customers();
    const live = all.filter((c) => c.subscription.status !== 'cancelled');
    const mrr = live.reduce((n, c) => n + c.subscription.mrr, 0);
    const history: MonthPoint[] = [...this.history.slice(0, -1), { ...this.history.at(-1)!, mrr, customers: live.length }];
    const start = history[0];
    const churned = history.reduce((n, p) => n + p.churned, 0);
    const expansion = history.reduce((n, p) => n + p.expansionMrr, 0);
    const churnedMrr = history.reduce((n, p) => n + p.churnedMrr, 0);
    const startCustomers = start.customers - start.newCustomers + start.churned;

    const pkgs: PackageId[] = ['essentials', 'professional', 'enterprise'];
    const modules: FeatureModule[] = ['portfolio', 'finance', 'maintenance', 'communications', 'documents', 'governance', 'compliance', 'reporting'];
    const opps = all.flatMap((c) => c.opportunities);
    const sales = opps.filter((o) => o.kind !== 'adoption');
    const band = (b: string) => all.filter((c) => c.health.band === b);

    return {
      mrr,
      arr: mrr * 12,
      customers: live.length,
      schemes: live.reduce((n, c) => n + c.snapshot.schemes, 0),
      units: live.reduce((n, c) => n + c.snapshot.units, 0),
      activeUsers: live.reduce((n, c) => n + c.snapshot.activeUsers30d + (c.snapshot.portalUsers30d ?? 0), 0),
      retention: Math.round((1 - churned / startCustomers) * 1000) / 10,
      nrr: Math.round(((start.mrr + expansion - churnedMrr) / start.mrr) * 1000) / 10,
      history,
      byPackage: pkgs.map((p) => {
        const inPkg = live.filter((c) => c.subscription.packageId === p);
        return { packageId: p, customers: inPkg.length, mrr: inPkg.reduce((n, c) => n + c.subscription.mrr, 0) };
      }),
      health: {
        healthy: band('healthy').length,
        atRisk: band('at-risk').length,
        critical: band('critical').length,
        atRiskMrr: [...band('at-risk'), ...band('critical')].reduce((n, c) => n + c.subscription.mrr, 0),
      },
      moduleUsage: modules.map((m) => {
        const entitled = all.filter((c) => entitlementSet(c.entitlements).has(MODULE_KEY_FEATURE[m]));
        const active = entitled.filter((c) => (c.health.modules.find((x) => x.module === m)?.adoption ?? 0) >= 40);
        return { module: m, adoption: entitled.length ? Math.round((active.length / entitled.length) * 100) : 0 };
      }),
      expansion: {
        likelyToUpgrade: new Set(sales.filter((o) => o.strength === 'high').map((o) => o.organisationId)).size,
        potentialMrr: sales.filter((o) => o.strength !== 'low').reduce((n, o) => n + o.potentialMrr, 0),
        underutilising: new Set(opps.filter((o) => o.kind === 'adoption').map((o) => o.organisationId)).size,
        demandWithoutFeature: all.filter((c) => c.health.modules.some((m) => !m.enabled && m.adoption >= 15)).length,
        top: [...sales].sort((a, b) => (a.strength === b.strength ? b.potentialMrr - a.potentialMrr : a.strength === 'high' ? -1 : b.strength === 'high' ? 1 : 0)).slice(0, 12),
      },
    };
  });

  constructor() {
    // Every customer is an organisation record; the generated book of business gets one too.
    for (const c of this.seeds()) {
      if (!this.orgs.get(c.organisationId)) {
        this.orgs.add({ id: c.organisationId, version: 1, kind: 'managing-agency', status: organisationStatus(c), name: c.name, shortName: c.name, city: c.city, province: c.province, schemeCount: c.snapshot.schemes, unitCount: c.snapshot.units });
      }
    }
    // Every customer has a commercial agreement and a storage figure.
    this.commercial.adopt(this.seeds());
    effect(() => safeStorage.set('humo.nudges', JSON.stringify(this.nudges())));
    // DEVELOPMENT / SIMULATION ONLY: subscriptions, accounts and upgrade requests survive a refresh.
    effect(() => {
      const snapshot = { seeds: this.seeds(), requests: this.requests() };
      untracked(() => simulationStorage.save('platform', () => snapshot));
    });
  }

  /** A newly onboarded customer: a trial of the chosen package, and no usage yet. */
  addCustomer(input: { organisationId: string; name: string; city: string; province: string; packageId: PackageId; accountManagerId: string }): void {
    const now = new Date();
    const trialEnds = new Date(now.getTime() + 30 * 86_400_000).toISOString();
    const usage = Object.fromEntries((['portfolio', 'finance', 'maintenance', 'communications', 'documents', 'governance', 'compliance', 'reporting'] as FeatureModule[]).map((m) => [m, { events30d: 0, expected: 100 }]));
    const seed: CustomerSeed = {
      organisationId: input.organisationId,
      name: input.name,
      city: input.city,
      province: input.province,
      customerSince: now.toISOString(),
      accountManagerId: input.accountManagerId,
      subscription: { version: 1, organisationId: input.organisationId, packageId: input.packageId, status: 'trial', startedAt: now.toISOString(), renewsAt: trialEnds, addOns: [], overrides: [], mrr: 0, seats: 5 },
      snapshot: {
        organisationId: input.organisationId, at: now.toISOString(), seats: 5, activeUsers30d: 0, loginsPerUserWeek: 0, moduleUsage: usage,
        workflowsStarted30d: 0, workflowsCompleted30d: 0, openTickets: 0, criticalTickets: 0, paymentStatus: 'current',
        schemes: 0, units: 0, trustees: 0, meetingsPerYear: 0, reportExports30d: 0, maintenanceRequests30d: 0, receiptsAllocated30d: 0, portalUsers30d: 0, scoreHistory: [],
      },
    };
    this.seeds.update((all) => [seed, ...all]);
    this.commercial.adopt([seed]);
  }

  /** Who at Humo looks after the customer. */
  setAccountManager(organisationIds: string[], manager: { id: string }): void {
    const ids = new Set(organisationIds);
    this.seeds.update((all) => all.map((c) => (ids.has(c.organisationId) ? { ...c, accountManagerId: manager.id } : c)));
  }

  /** Keeps the customer record's name and location in step with the organisation. */
  renameCustomer(organisationId: string, details: { name: string; city: string; province: string }): void {
    this.seeds.update((all) => all.map((c) => (c.organisationId === organisationId ? { ...c, ...details } : c)));
  }

  /** The subscription in force today. */
  subscription(organisationId: string): Subscription | undefined {
    return this.effective().get(organisationId);
  }

  change(organisationId: string, change: SubscriptionChange, by: string, byId = ''): void {
    const at = new Date().toISOString();
    if (change.type !== 'override') this.changeAgreement(organisationId, change, by, byId);
    this.seeds.update((all) =>
      all.map((c) => {
        if (c.organisationId !== organisationId) return c;
        const sub = { ...c.subscription, version: c.subscription.version + 1, addOns: [...c.subscription.addOns], overrides: [...c.subscription.overrides] };
        switch (change.type) {
          case 'package':
          case 'add-on':
            // What they have comes from the commercial agreement (changeAgreement above).
            break;
          case 'override':
            sub.overrides = sub.overrides.filter((o) => o.feature !== change.feature);
            if (change.enabled !== null) {
              sub.overrides.push({
                feature: change.feature, enabled: change.enabled, reason: change.reason, by, at,
                expiresAt: change.days ? new Date(Date.now() + change.days * 86_400_000).toISOString() : undefined,
              });
            }
            break;
        }
        return { ...c, subscription: sub };
      }),
    );
    // Conversion closes the loop: nudges for features they now have retire for good.
    this.retireConvertedNudges(organisationId);
  }

  /**
   * An entitlement change from Manage features, effective today. It doesn't
   * change what the customer pays: a new package keeps the agreed price and an
   * add-on is included in it, unless the catalogue has a price. Priced and
   * scheduled changes are made in Billing & agreement (docs/23).
   */
  private changeAgreement(organisationId: string, change: Extract<SubscriptionChange, { type: 'package' | 'add-on' }>, by: string, byId: string): void {
    const a = this.commercial.agreement(organisationId);
    if (!a) return;
    const cat = this.commercial.catalogue();
    const today = isoDay(new Date());
    const actor = { id: byId, name: by, approval: 'Within the Account Manager’s authority for their own customer (D11)' };
    let next: typeof a;
    if (change.type === 'package') {
      const listed = termsOn(cat.packages.find((p) => p.packageId === change.packageId)?.terms ?? [], today)?.monthlyPrice ?? null;
      const monthlyPrice = listed === null ? (packageOn(a, today)?.monthlyPrice ?? null) : undefined;
      next = applyAgreementChange(a, { type: 'package', packageId: change.packageId, effectiveFrom: today, monthlyPrice, reason: change.reason }, cat, actor, new Date(), `Changed package to ${packageById(change.packageId).name}`);
    } else if (change.enabled) {
      const def = cat.addOns.find((x) => x.id === change.addOnId);
      const listed = termsOn(def?.terms ?? [], today)?.price ?? null;
      next = applyAgreementChange(a, { type: 'add-on', addOnId: change.addOnId, quantity: 1, effectiveFrom: today, unitPrice: listed === null ? null : undefined, reason: change.reason }, cat, actor, new Date(), `Added the ${def?.name ?? change.addOnId} add-on`);
      if (listed === null) next.addOns.at(-1)!.priceSource = 'included';
    } else {
      const def = cat.addOns.find((x) => x.id === change.addOnId);
      next = applyAgreementChange(a, { type: 'remove-add-on', addOnId: change.addOnId, effectiveFrom: today, reason: change.reason }, cat, actor, new Date(), `Removed the ${def?.name ?? change.addOnId} add-on`);
    }
    this.commercial.replaceAgreement(next);
  }

  addRequest(r: Omit<UpgradeRequest, 'id' | 'at' | 'status'>): void {
    this.requests.update((all) => [{ ...r, id: `ur-${Date.now()}`, at: new Date().toISOString(), status: 'new' }, ...all]);
  }

  setRequestStatus(id: string, status: UpgradeRequest['status']): void {
    this.requests.update((all) => all.map((r) => (r.id === id ? { ...r, status } : r)));
  }

  recordNudge(nudgeId: string, identityId: string, organisationId: string, event: 'shown' | 'dismissed' | 'not-interested' | 'learn-more' | 'snoozed'): void {
    const at = new Date().toISOString();
    this.nudges.update((all) => {
      const existing = all.find((s) => s.nudgeId === nudgeId && s.identityId === identityId) ?? { nudgeId, identityId, organisationId, shownAt: [] };
      const next: NudgeState = { ...existing };
      if (event === 'shown') next.shownAt = [...existing.shownAt, at];
      if (event === 'dismissed') next.dismissedAt = at;
      if (event === 'not-interested') next.notInterestedAt = at;
      if (event === 'learn-more') next.learnMoreAt = at;
      if (event === 'snoozed') next.snoozedUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();
      return [...all.filter((s) => s !== existing), next];
    });
  }

  /** Prototype toolbar: forget every nudge interaction. */
  resetNudges(): void {
    this.sessionNudge = null;
    this.nudges.set([]);
  }

  private retireConvertedNudges(organisationId: string): void {
    const customer = this.customers().find((c) => c.organisationId === organisationId);
    if (!customer) return;
    const at = new Date().toISOString();
    this.nudges.update((all) =>
      all.map((s) => {
        if (s.organisationId !== organisationId || s.convertedAt) return s;
        const addOn = NUDGES.find((n) => n.id === s.nudgeId)?.addOn;
        const features = ADD_ONS.find((a) => a.id === addOn)?.features ?? [];
        return features.length && features.every((f) => entitlementSet(customer.entitlements).has(f)) ? { ...s, convertedAt: at } : s;
      }),
    );
  }

  private readNudges(): NudgeState[] {
    try {
      return JSON.parse(safeStorage.get('humo.nudges') ?? '[]');
    } catch {
      return [];
    }
  }
}
