/**
 * Platform operations: what Humo's own team uses to run the platform.
 *
 * FEATURE FLAGS are technical: is this code switched on, where, for whom?
 * They're separate from ENTITLEMENTS, which are commercial (has the customer
 * paid for it?). A feature reaches a customer only when both say yes.
 * Flags roll out per environment, by percentage of customers, with allow and
 * deny lists; kill switches turn something off everywhere at once. Every
 * change is audited, and production changes need a fresh step-up.
 */

export type Environment = 'development' | 'staging' | 'production';

export const ENVIRONMENTS: { id: Environment; label: string }[] = [
  { id: 'development', label: 'Development' },
  { id: 'staging', label: 'Staging' },
  { id: 'production', label: 'Production' },
];

/** The environment this prototype's data stands for. */
export const CURRENT_ENVIRONMENT: Environment = 'production';

export type FlagKind = 'release' | 'kill-switch' | 'ops' | 'experiment';

export const FLAG_KIND_LABELS: Record<FlagKind, string> = {
  release: 'Release',
  'kill-switch': 'Kill switch',
  ops: 'Operational',
  experiment: 'Experiment',
};

export interface FlagRule {
  enabled: boolean;
  /** % of customers who get it (0–100), by a stable hash of flag and customer. */
  rollout: number;
  /** Customers who always get it (while enabled). */
  allow: string[];
  /** Customers who never get it. */
  deny: string[];
}

export interface FlagChange {
  id: string;
  at: string;
  by: string;
  environment: Environment;
  /** "Rollout 25% → 50%". */
  summary: string;
  reason: string;
}

export interface FeatureFlag {
  key: string;
  version: number;
  name: string;
  description: string;
  kind: FlagKind;
  /** The team that owns it and decides when to remove it. */
  owner: string;
  /** Where in the product it shows. */
  affects: string;
  rules: Record<Environment, FlagRule>;
  createdAt: string;
  history: FlagChange[];
}

/** Stable 0–99 bucket for a flag and a customer: the same customer stays in or out as the rollout grows. */
export function flagBucket(key: string, organisationId: string): number {
  let h = 2166136261;
  for (const ch of `${key}:${organisationId}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 100;
}

/** Is the flag on for this customer in this environment? Deny wins, then allow, then the rollout. */
export function evaluateFlag(flag: FeatureFlag, environment: Environment, organisationId: string | null): boolean {
  const r = flag.rules[environment];
  if (!r.enabled) return false;
  if (!organisationId) return r.rollout >= 100;
  if (r.deny.includes(organisationId)) return false;
  if (r.allow.includes(organisationId)) return true;
  return flagBucket(flag.key, organisationId) < r.rollout;
}

/** "Off" · "On for everyone" · "25% + 2 customers" — one line per environment. */
export function describeRule(r: FlagRule): string {
  if (!r.enabled) return 'Off';
  const parts: string[] = [];
  if (r.rollout >= 100) parts.push('Everyone');
  else if (r.rollout > 0) parts.push(`${r.rollout}% of customers`);
  if (r.allow.length) parts.push(`${r.allow.length} customer${r.allow.length === 1 ? '' : 's'} allowed`);
  if (r.deny.length) parts.push(`${r.deny.length} excluded`);
  return parts.length ? parts.join(' · ') : 'On for nobody yet';
}

// ------------------------------------------------------------- System configuration

export interface MaintenanceWindow {
  message: string;
  startsAt: string;
  endsAt: string;
}

export interface SystemConfig {
  version: number;
  /** Shown to every signed-in user until it ends. */
  maintenance: MaintenanceWindow | null;
  /** Largest document upload, MB. */
  uploadLimitMb: number;
  /** Signed-in sessions end after this much inactivity. */
  sessionIdleMinutes: number;
  /** Staff must sign in with a passkey (no password fallback). */
  requirePasskeysForStaff: boolean;
  /** Audit records are kept this long. */
  auditRetentionYears: number;
}

// ------------------------------------------------------------- Health

export type ServiceStatus = 'operational' | 'degraded' | 'outage' | 'paused';

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  outage: 'Outage',
  paused: 'Paused',
};

export interface Integration {
  id: string;
  name: string;
  description: string;
  status: ServiceStatus;
  /** Why it isn't operational. */
  note?: string;
  /** Daily availability %, oldest first (30 days). */
  uptime: number[];
}

export type JobStatus = 'succeeded' | 'running' | 'failed' | 'skipped';

export interface JobRun {
  id: string;
  at: string;
  status: JobStatus;
  durationMs: number;
  /** "1 284 receipts imported", or the error. */
  detail: string;
}

export interface BackgroundJob {
  id: string;
  name: string;
  description: string;
  schedule: string;
  /** Newest first. */
  runs: JobRun[];
  nextRunAt?: string;
}

export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
};

export interface Incident {
  id: string;
  version: number;
  /** "INC-0042" */
  ref: string;
  title: string;
  impact: 'minor' | 'major' | 'critical';
  status: IncidentStatus;
  /** Integration ids affected. */
  services: string[];
  startedAt: string;
  resolvedAt?: string;
  updates: { at: string; by: string; status: IncidentStatus; message: string }[];
}

export interface PlatformHealth {
  /** API availability over 30 days, %. */
  availability: number;
  /** p95 response time, ms (last 24h). */
  p95Ms: number;
  /** Requests that failed with a server error, % (last 24h). */
  errorRate: number;
  /** p95 per hour, last 24 hours, oldest first. */
  latencySeries: number[];
  integrations: Integration[];
  jobs: BackgroundJob[];
  incidents: Incident[];
  /** Customers on the platform, for the impact line. */
  customers: number;
  /** Kill switches that are off in production right now. */
  killed: string[];
}

export interface NewIncident {
  title: string;
  impact: Incident['impact'];
  services: string[];
  message: string;
}
