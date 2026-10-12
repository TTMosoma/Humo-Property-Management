import { Injectable, inject } from '@angular/core';
import {
  CURRENT_ENVIRONMENT,
  Environment,
  FeatureFlag,
  FieldErrors,
  FlagRule,
  Incident,
  IncidentStatus,
  JobRun,
  NewIncident,
  SystemConfig,
  evaluateFlag,
} from '../../domain';
import { simulationStorage } from '../simulation/simulation-storage';
import { MockDb } from './mock-db';
import { PlatformStore } from './platform-store';

/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface OpsSnapshot {
  flags: FeatureFlag[];
  config: SystemConfig;
  incidents: Incident[];
  /** Runs added in this simulation (retries), by job id. */
  extraRuns: [string, JobRun[]][];
  seq: number;
}

const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const off: FlagRule = { enabled: false, rollout: 0, allow: [], deny: [] };
const all: FlagRule = { enabled: true, rollout: 100, allow: [], deny: [] };
const some = (rollout: number, allow: string[] = []): FlagRule => ({ enabled: true, rollout, allow, deny: [] });

/**
 * Platform operations state for the prototype: feature flags, system
 * configuration and incidents. Other stores ask `isOn()` for server-side
 * flags (kill switches), as API handlers will.
 */
@Injectable({ providedIn: 'root' })
export class OpsStore {
  private readonly db = inject(MockDb);
  private readonly platform = inject(PlatformStore);

  flags: FeatureFlag[];
  config: SystemConfig;
  incidents: Incident[];
  readonly extraRuns = new Map<string, JobRun[]>();
  private seq: number;

  constructor() {
    const saved = simulationStorage.load<OpsSnapshot>('ops');
    // Flags added to the seed after a simulation was saved join it (off where the seed says off).
    const seeded = this.seedFlags();
    this.flags = saved?.flags ? [...saved.flags, ...seeded.filter((f) => !saved.flags.some((s) => s.key === f.key))] : seeded;
    this.config = saved?.config ?? { version: 1, maintenance: null, uploadLimitMb: 25, sessionIdleMinutes: 30, requirePasskeysForStaff: true, auditRetentionYears: 7 };
    // Notices saved before the product-name fix said "Humo will be unavailable": it's this application that goes offline.
    if (this.config.maintenance?.message.startsWith('Humo will be unavailable')) {
      this.config.maintenance.message = this.config.maintenance.message.replace(/^Humo will/, 'Humo Property Management will');
    }
    this.incidents = saved?.incidents ?? this.seedIncidents();
    for (const [k, v] of saved?.extraRuns ?? []) this.extraRuns.set(k, v);
    this.seq = saved?.seq ?? 100;
  }

  // =================================================================== Flags

  /** Server-side check, as an API handler would make it. Unknown flags are off. */
  isOn(key: string, organisationId: string | null, environment: Environment = CURRENT_ENVIRONMENT): boolean {
    const f = this.flags.find((x) => x.key === key);
    return !!f && evaluateFlag(f, environment, organisationId);
  }

  evaluated(organisationId: string | null): Record<string, boolean> {
    return Object.fromEntries(this.flags.map((f) => [f.key, evaluateFlag(f, CURRENT_ENVIRONMENT, organisationId)]));
  }

  checkFlag(key: string, rule: FlagRule, reason: string): FieldErrors | null {
    const e: FieldErrors = {};
    if (!this.flags.some((f) => f.key === key)) e['key'] = 'No such flag.';
    if (!(Number.isInteger(rule.rollout) && rule.rollout >= 0 && rule.rollout <= 100)) e['rollout'] = 'A whole percentage from 0 to 100.';
    if (rule.allow.some((id) => rule.deny.includes(id))) e['allow'] = 'A customer can’t be both allowed and excluded.';
    const known = new Set(this.platform.customers().map((c) => c.organisationId));
    if ([...rule.allow, ...rule.deny].some((id) => !known.has(id))) e['allow'] = 'Unknown customer.';
    if (reason.trim().length < 5) e['reason'] = 'Say why: it’s in the flag’s history and the audit log.';
    return Object.keys(e).length ? e : null;
  }

  updateFlag(key: string, environment: Environment, rule: FlagRule, reason: string, by: string): void {
    const f = this.flags.find((x) => x.key === key)!;
    const before = f.rules[environment];
    f.rules = { ...f.rules, [environment]: { ...rule, allow: [...rule.allow], deny: [...rule.deny] } };
    f.version++;
    f.history = [{ id: `fc-${++this.seq}`, at: new Date().toISOString(), by, environment, summary: changeSummary(before, rule, (id) => this.customerName(id)), reason: reason.trim() }, ...f.history];
    this.commit();
  }

  customerName(id: string): string {
    return this.platform.customers().find((c) => c.organisationId === id)?.name ?? id;
  }

  // =================================================================== Config

  checkConfig(c: Omit<SystemConfig, 'version'>, reason: string): FieldErrors | null {
    const e: FieldErrors = {};
    if (!(c.uploadLimitMb >= 5 && c.uploadLimitMb <= 100)) e['uploadLimitMb'] = 'Between 5 and 100 MB.';
    if (!(c.sessionIdleMinutes >= 5 && c.sessionIdleMinutes <= 480)) e['sessionIdleMinutes'] = 'Between 5 minutes and 8 hours.';
    if (!(c.auditRetentionYears >= 5 && c.auditRetentionYears <= 15)) e['auditRetentionYears'] = 'At least 5 years: trust-account records must be kept that long.';
    if (c.maintenance) {
      if (c.maintenance.message.trim().length < 10) e['message'] = 'Tell people what will happen.';
      if (!(new Date(c.maintenance.endsAt) > new Date(c.maintenance.startsAt))) e['endsAt'] = 'It must end after it starts.';
    }
    if (reason.trim().length < 5) e['reason'] = 'Say why, for the audit log.';
    return Object.keys(e).length ? e : null;
  }

  updateConfig(c: Omit<SystemConfig, 'version'>): void {
    this.config = { ...c, version: this.config.version + 1 };
    this.commit();
  }

  /** The banner, while the window hasn't ended. */
  maintenance() {
    const m = this.config.maintenance;
    return m && new Date(m.endsAt).getTime() > Date.now() ? m : null;
  }

  // =================================================================== Jobs & incidents

  addRun(jobId: string, run: Omit<JobRun, 'id'>): void {
    this.extraRuns.set(jobId, [{ ...run, id: `jr-${++this.seq}` }, ...(this.extraRuns.get(jobId) ?? [])]);
    this.commit();
  }

  checkIncident(input: NewIncident): FieldErrors | null {
    const e: FieldErrors = {};
    if (input.title.trim().length < 5) e['title'] = 'What are customers seeing?';
    if (!input.services.length) e['services'] = 'Which services are affected?';
    if (input.message.trim().length < 10) e['message'] = 'The first update: what you know and what you’re doing.';
    return Object.keys(e).length ? e : null;
  }

  declare(input: NewIncident, by: string): string {
    const n = Math.max(0, ...this.incidents.map((i) => Number(i.ref.split('-')[1]) || 0)) + 1;
    const id = `inc-${++this.seq}`;
    const at = new Date().toISOString();
    this.incidents = [{ id, version: 1, ref: `INC-${String(n).padStart(4, '0')}`, title: input.title.trim(), impact: input.impact, status: 'investigating', services: input.services, startedAt: at, updates: [{ at, by, status: 'investigating', message: input.message.trim() }] }, ...this.incidents];
    this.commit();
    return id;
  }

  update(id: string, status: IncidentStatus, message: string, by: string): void {
    const i = this.incidents.find((x) => x.id === id)!;
    const at = new Date().toISOString();
    i.status = status;
    if (status === 'resolved') i.resolvedAt = at;
    i.updates = [{ at, by, status, message: message.trim() }, ...i.updates];
    i.version++;
    this.commit();
  }

  // =================================================================== Seed

  private seedFlags(): FeatureFlag[] {
    const created = ago(120 * 24 * HOUR);
    const f = (key: string, name: string, kind: FeatureFlag['kind'], owner: string, affects: string, description: string, rules: FeatureFlag['rules'], history: FeatureFlag['history'] = []): FeatureFlag => ({
      key, version: 1, name, kind, owner, affects, description, rules, createdAt: created, history,
    });
    return [
      f('dashboard.since-yesterday', 'Dashboard: since yesterday', 'release', 'Experience', 'Dashboard › Since yesterday',
        'What changed in the last 24 hours, on the operational dashboard.',
        { development: all, staging: all, production: some(50, ['acacia']) },
        [{ id: 'fc-1', at: ago(9 * 24 * HOUR), by: 'Terry Mosoma', environment: 'production', summary: 'Rollout 10% → 50%', reason: 'No errors at 10% for a week.' }]),
      f('mobile.report-tab', 'Field mode: Report tab', 'release', 'Mobile', 'Phone tab bar › Report',
        'Photo-first job capture from the phone tab bar, for staff who log jobs.',
        { development: all, staging: all, production: some(25, ['acacia']) }),
      f('reports.csv-export', 'Reports: CSV export', 'release', 'Insights', 'Reports › Export CSV',
        'Download any report as CSV.',
        { development: all, staging: all, production: all }),
      f('notifications.resident-live', 'Resident notifications from live events', 'release', 'Residents', 'Resident portal › Notifications',
        'Owners and tenants hear about payments, statements, requests, notices and documents as they happen.',
        { development: all, staging: all, production: all }),
      f('channels.whatsapp', 'WhatsApp sending', 'kill-switch', 'Messaging', 'Notices and notifications sent by WhatsApp',
        'Turn off to stop every WhatsApp message at once (e.g. if the provider misbehaves). Messages then go by the other channels only.',
        { development: all, staging: all, production: all }),
      f('billing.statement-sending', 'Statement sending', 'kill-switch', 'Finance', 'Billing run › Send statements',
        'Turn off to pause sending statements from billing runs everywhere (e.g. while a template bug is fixed). Posting still works.',
        { development: all, staging: all, production: all }),
      f('receipt-capture', 'Receipt capture and bank-statement import', 'release', 'Finance', 'Finance › Receipts › Capture, Import',
        'Capture receipts by hand and import bank statements as CSV, with duplicates skipped (docs/22 §1). Pilot with Acacia.',
        { development: all, staging: all, production: some(0, ['acacia']) }),
      f('meter-readings', 'Meter readings', 'release', 'Finance', 'Levies & billing › Meter readings',
        'Capture water readings by grid or CSV; billing charges actual consumption (docs/22 §2). Pilot with Acacia.',
        { development: all, staging: all, production: some(0, ['acacia']) }),
      f('levy-model', 'Levy model per scheme', 'release', 'Finance', 'Levies & billing › How levies are set',
        'Choose manual levies or levies derived from the approved budget, proposed and applied from the next run (D13, docs/22 §3). Pilot with Acacia.',
        { development: all, staging: all, production: some(0, ['acacia']) }),
      f('billing.correction-runs', 'Billing correction runs', 'release', 'Finance', 'Not built yet',
        'Correct a posted run in bulk instead of one journal per account. In development.',
        { development: all, staging: some(100), production: off }),
      f('ops.bank-feed-v2', 'Bank feed v2', 'ops', 'Payments', 'Background job › Bank statement import',
        'The new bank statement importer, rolled out customer by customer.',
        { development: all, staging: all, production: some(10) }),
    ];
  }

  private seedIncidents(): Incident[] {
    return [
      {
        id: 'inc-042', version: 1, ref: 'INC-0042', title: 'SMS delivery delayed', impact: 'minor', status: 'identified', services: ['sms'], startedAt: ago(3 * HOUR),
        updates: [
          { at: ago(1.5 * HOUR), by: 'Lerato Dube', status: 'identified', message: 'The SMS gateway is queueing messages for up to 10 minutes. They are delivered, late. The provider is working on it.' },
          { at: ago(3 * HOUR), by: 'Lerato Dube', status: 'investigating', message: 'Some customers report payment-received SMSes arriving late. Investigating.' },
        ],
      },
      {
        id: 'inc-041', version: 3, ref: 'INC-0041', title: 'Statement emails delayed', impact: 'minor', status: 'resolved', services: ['email'], startedAt: ago(26 * 24 * HOUR), resolvedAt: ago(26 * 24 * HOUR - 2 * HOUR),
        updates: [
          { at: ago(26 * 24 * HOUR - 2 * HOUR), by: 'Terry Mosoma', status: 'resolved', message: 'All delayed statement emails were delivered. Cause: a provider rate limit; raised with them.' },
          { at: ago(26 * 24 * HOUR), by: 'Terry Mosoma', status: 'investigating', message: 'Statement emails from billing runs are going out slowly.' },
        ],
      },
      {
        id: 'inc-040', version: 2, ref: 'INC-0040', title: 'Sign-in slow for some users', impact: 'major', status: 'resolved', services: ['api'], startedAt: ago(41 * 24 * HOUR), resolvedAt: ago(41 * 24 * HOUR - 45 * 60_000),
        updates: [
          { at: ago(41 * 24 * HOUR - 45 * 60_000), by: 'Terry Mosoma', status: 'resolved', message: 'A database index was rebuilt; sign-in is back to normal.' },
          { at: ago(41 * 24 * HOUR), by: 'Terry Mosoma', status: 'investigating', message: 'Sign-in is taking over 10 seconds for some users.' },
        ],
      },
    ];
  }

  private commit(): void {
    simulationStorage.save('ops', (): OpsSnapshot => ({ flags: this.flags, config: this.config, incidents: this.incidents, extraRuns: [...this.extraRuns.entries()], seq: this.seq }));
    this.db.touch();
  }
}

function changeSummary(a: FlagRule, b: FlagRule, name: (id: string) => string): string {
  const out: string[] = [];
  if (a.enabled !== b.enabled) out.push(b.enabled ? 'Switched on' : 'Switched off');
  if (a.rollout !== b.rollout) out.push(`Rollout ${a.rollout}% → ${b.rollout}%`);
  const added = (x: string[], y: string[]) => y.filter((id) => !x.includes(id));
  for (const id of added(a.allow, b.allow)) out.push(`Allowed ${name(id)}`);
  for (const id of added(b.allow, a.allow)) out.push(`Removed ${name(id)} from allowed`);
  for (const id of added(a.deny, b.deny)) out.push(`Excluded ${name(id)}`);
  for (const id of added(b.deny, a.deny)) out.push(`Stopped excluding ${name(id)}`);
  return out.join(' · ') || 'No change';
}
