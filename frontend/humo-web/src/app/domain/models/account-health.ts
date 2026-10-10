import { EntitlementSet, FeatureModule, MODULE_KEY_FEATURE } from './entitlement';

/**
 * Account Health: how well a customer is getting value from Humo Property Management
 * (the same model can serve other Humo products later).
 *
 * Raw usage (a UsageSnapshot, produced later by the analytics pipeline) goes in;
 * an explainable score comes out. Every signal shows its own value, weight and
 * reason, so an Account Manager can say *why* an account is at risk.
 */

/** Usage analytics for one customer over the last 30 days (mock today, event pipeline later). */
export interface UsageSnapshot {
  organisationId: string;
  at: string;
  seats: number;
  activeUsers30d: number;
  /** Average sign-ins per active user per week. */
  loginsPerUserWeek: number;
  /** Per module: meaningful events vs what a customer of this size would normally do. */
  moduleUsage: Partial<Record<FeatureModule, { events30d: number; expected: number }>>;
  workflowsStarted30d: number;
  workflowsCompleted30d: number;
  openTickets: number;
  criticalTickets: number;
  paymentStatus: 'current' | 'overdue' | 'suspended';
  // Domain signals that opportunity rules look at
  schemes: number;
  units: number;
  trustees: number;
  meetingsPerYear: number;
  reportExports30d: number;
  maintenanceRequests30d: number;
  receiptsAllocated30d: number;
  /** Owners and tenants active in the portal (counted in company-wide active users, not seats). */
  portalUsers30d?: number;
  /** Trend of the overall score, oldest first (weekly). */
  scoreHistory?: number[];
}

export type HealthBand = 'healthy' | 'at-risk' | 'critical';

export type HealthSignalKey = 'active-users' | 'logins' | 'adoption' | 'workflows' | 'support' | 'utilisation' | 'payment' | 'dormant';

export interface HealthSignal {
  key: HealthSignalKey;
  label: string;
  /** 0–100. */
  score: number;
  weight: number;
  /** Plain-language reason, e.g. "41 of 52 seats active in 30 days". */
  detail: string;
}

export interface ModuleAdoption {
  module: FeatureModule;
  enabled: boolean;
  /** 0–100. For modules that aren't enabled, this is a demand signal (related activity elsewhere). */
  adoption: number;
}

export interface AccountHealth {
  organisationId: string;
  score: number;
  band: HealthBand;
  signals: HealthSignal[];
  modules: ModuleAdoption[];
  history: number[];
  computedAt: string;
}

/** Weights sum to 1. Configurable later; kept here so the formula is visible and testable. */
export const DEFAULT_HEALTH_WEIGHTS: Record<HealthSignalKey, number> = {
  'active-users': 0.18,
  logins: 0.1,
  adoption: 0.2,
  workflows: 0.14,
  support: 0.1,
  utilisation: 0.1,
  payment: 0.1,
  dormant: 0.08,
};

export const HEALTH_BANDS: { band: HealthBand; min: number; label: string }[] = [
  { band: 'healthy', min: 75, label: 'Healthy' },
  { band: 'at-risk', min: 50, label: 'At risk' },
  { band: 'critical', min: 0, label: 'Critical' },
];

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function bandOf(score: number): HealthBand {
  return HEALTH_BANDS.find((b) => score >= b.min)!.band;
}

/** Module adoption: events against an expected baseline for a customer of this size. */
export function moduleAdoption(s: UsageSnapshot, ent: EntitlementSet): ModuleAdoption[] {
  const modules: FeatureModule[] = ['portfolio', 'finance', 'maintenance', 'communications', 'documents', 'governance', 'compliance', 'reporting'];
  return modules.map((m) => {
    const u = s.moduleUsage[m];
    const adoption = u && u.expected > 0 ? clamp((u.events30d / u.expected) * 100) : 0;
    return { module: m, enabled: ent.has(MODULE_KEY_FEATURE[m]), adoption };
  });
}

/**
 * The health calculation. Pure: same snapshot + entitlements → same score.
 * The backend will run the same formula on real analytics.
 */
export function calculateHealth(s: UsageSnapshot, ent: EntitlementSet, weights = DEFAULT_HEALTH_WEIGHTS): AccountHealth {
  const modules = moduleAdoption(s, ent);
  const enabled = modules.filter((m) => m.enabled);
  const meanAdoption = enabled.length ? enabled.reduce((n, m) => n + m.adoption, 0) / enabled.length : 0;
  const dormant = enabled.filter((m) => m.adoption < 25);
  const used = enabled.filter((m) => m.adoption >= 40).length;
  const completion = s.workflowsStarted30d ? (s.workflowsCompleted30d / s.workflowsStarted30d) * 100 : 100;

  const signals: HealthSignal[] = [
    { key: 'active-users', label: 'Active users', score: clamp((s.activeUsers30d / Math.max(1, s.seats)) * 110), weight: weights['active-users'], detail: `${s.activeUsers30d} of ${s.seats} users active in 30 days` },
    { key: 'logins', label: 'Sign-in activity', score: clamp((s.loginsPerUserWeek / 5) * 100), weight: weights.logins, detail: `${s.loginsPerUserWeek.toFixed(1)} sign-ins per active user per week` },
    { key: 'adoption', label: 'Feature adoption', score: clamp(meanAdoption), weight: weights.adoption, detail: `${Math.round(meanAdoption)}% average across ${enabled.length} enabled modules` },
    { key: 'workflows', label: 'Workflow completion', score: clamp(completion), weight: weights.workflows, detail: `${s.workflowsCompleted30d} of ${s.workflowsStarted30d} workflows completed` },
    {
      key: 'support', label: 'Support issues', score: clamp(100 - s.openTickets * 6 - s.criticalTickets * 25), weight: weights.support,
      detail: s.openTickets ? `${s.openTickets} open tickets${s.criticalTickets ? `, ${s.criticalTickets} critical` : ''}` : 'No open tickets',
    },
    { key: 'utilisation', label: 'Subscription utilisation', score: clamp((used / Math.max(1, enabled.length)) * 100), weight: weights.utilisation, detail: `${used} of ${enabled.length} enabled modules in regular use` },
    {
      key: 'payment', label: 'Payment status', score: s.paymentStatus === 'current' ? 100 : s.paymentStatus === 'overdue' ? 40 : 0, weight: weights.payment,
      detail: s.paymentStatus === 'current' ? 'Paid up to date' : s.paymentStatus === 'overdue' ? 'Invoice overdue' : 'Account suspended',
    },
    {
      key: 'dormant', label: 'Dormant areas', score: clamp(100 - dormant.length * 30), weight: weights.dormant,
      detail: dormant.length ? `Barely used: ${dormant.map((d) => d.module).join(', ')}` : 'Every enabled module is in use',
    },
  ];

  const score = clamp(signals.reduce((n, sig) => n + sig.score * sig.weight, 0));
  return {
    organisationId: s.organisationId,
    score,
    band: bandOf(score),
    signals,
    modules,
    history: [...(s.scoreHistory ?? []), score],
    computedAt: s.at,
  };
}
