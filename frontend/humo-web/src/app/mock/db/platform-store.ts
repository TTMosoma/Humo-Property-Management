import { Injectable, computed, effect, signal } from '@angular/core';
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
  calculateHealth,
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
  readonly seeds = signal<CustomerSeed[]>(seedCustomers());
  readonly requests = signal<UpgradeRequest[]>(seedRequests());
  /** Persisted so a dismissed nudge stays dismissed across reloads in the prototype. */
  readonly nudges = signal<NudgeState[]>(this.readNudges());
  /** The one nudge served in this browser session: it stays put rather than counting as "ignored". */
  sessionNudge: string | null = null;

  readonly customers = computed<PlatformCustomer[]>(() => {
    const requests = this.requests();
    return this.seeds().map((c) => {
      const entitlements = resolveEntitlements(c.subscription);
      const health = calculateHealth(c.snapshot, entitlements);
      const opportunities = detectOpportunities({ snapshot: c.snapshot, entitlements, subscription: c.subscription, health });
      return {
        ...c,
        status: organisationStatus(c),
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
    effect(() => safeStorage.set('humo.nudges', JSON.stringify(this.nudges())));
  }

  subscription(organisationId: string): Subscription | undefined {
    return this.seeds().find((c) => c.organisationId === organisationId)?.subscription;
  }

  change(organisationId: string, change: SubscriptionChange, by: string): void {
    const at = new Date().toISOString();
    this.seeds.update((all) =>
      all.map((c) => {
        if (c.organisationId !== organisationId) return c;
        const sub = { ...c.subscription, addOns: [...c.subscription.addOns], overrides: [...c.subscription.overrides] };
        switch (change.type) {
          case 'package':
            sub.packageId = change.packageId;
            break;
          case 'add-on':
            sub.addOns = change.enabled ? [...sub.addOns.filter((a) => a.addOnId !== change.addOnId), { addOnId: change.addOnId, since: at }] : sub.addOns.filter((a) => a.addOnId !== change.addOnId);
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
