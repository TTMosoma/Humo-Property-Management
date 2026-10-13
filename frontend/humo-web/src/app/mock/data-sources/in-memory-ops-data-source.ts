import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, switchMap } from 'rxjs';
import { BackgroundJob, CURRENT_ENVIRONMENT, Environment, FeatureFlag, FieldErrors, FlagRule, IncidentStatus, Integration, JobRun, MaintenanceWindow, NewIncident, OpsDataSource, PlatformHealth, ServiceStatus, SystemConfig, todaySA } from '../../domain';
import { BillingStore } from '../db/billing-store';
import { MockDb } from '../db/mock-db';
import { OpsStore } from '../db/ops-store';
import { PlatformStore } from '../db/platform-store';
import { seeded } from '../db/random';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
/** The top of the current hour, minus n hours. */
const hourAgo = (n: number) => {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return new Date(d.getTime() - n * HOUR).toISOString();
};

@Injectable()
export class InMemoryOpsDataSource extends OpsDataSource {
  private readonly store = inject(OpsStore);
  private readonly db = inject(MockDb);
  private readonly billing = inject(BillingStore);
  private readonly platform = inject(PlatformStore);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  // =================================================================== Flags

  flags(): Observable<FeatureFlag[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.flags)));
  }

  updateFlag(key: string, environment: Environment, rule: FlagRule, reason: string, expectedVersion?: number): Observable<void> {
    const f = this.store.flags.find((x) => x.key === key);
    return this.gateway
      .command(
        {
          action: `Changed feature flag ${key} in ${environment}`,
          resource: 'FeatureFlag',
          resourceId: key,
          permission: 'Platform.Config.Manage',
          // Production changes reach customers: always a fresh step-up. Development and staging don't.
          stepUp: environment === 'production',
          version: { expected: expectedVersion, current: f?.version },
          validate: () => this.store.checkFlag(key, rule, reason),
        },
        () => this.store.updateFlag(key, environment, rule, reason, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }

  /** Session bootstrap: every flag evaluated for the caller's organisation (Humo staff: none). */
  myFlags(): Observable<Record<string, boolean>> {
    return combineLatest([this.auth.session$, this.db.changes$]).pipe(switchMap(([s]) => this.respond(this.store.evaluated(s.organisation?.id ?? null))));
  }

  // =================================================================== Config

  config(): Observable<SystemConfig> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.config)));
  }

  updateConfig(config: Omit<SystemConfig, 'version'>, reason: string, expectedVersion?: number): Observable<void> {
    return this.gateway
      .command(
        {
          action: `Changed system configuration: ${reason.trim()}`,
          resource: 'SystemConfig',
          permission: 'Platform.Config.Manage',
          version: { expected: expectedVersion, current: this.store.config.version },
          validate: () => this.store.checkConfig(config, reason),
        },
        () => this.store.updateConfig(config),
      )
      .pipe(map(() => undefined));
  }

  maintenance(): Observable<MaintenanceWindow | null> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.maintenance())));
  }

  // =================================================================== Health

  health(): Observable<PlatformHealth> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.build())));
  }

  private build(): PlatformHealth {
    const jobs = this.jobs();
    const open = this.store.incidents.filter((i) => i.status !== 'resolved');
    const nedbankDown = jobs.find((j) => j.id === 'bank-nedbank')!.runs[0].status === 'failed';
    const whatsappKilled = !this.store.flags.find((f) => f.key === 'channels.whatsapp')?.rules[CURRENT_ENVIRONMENT].enabled;
    const statementsKilled = !this.store.flags.find((f) => f.key === 'billing.statement-sending')?.rules[CURRENT_ENVIRONMENT].enabled;
    const statusFromIncidents = (id: string, base: ServiceStatus = 'operational'): ServiceStatus => {
      const hit = open.filter((i) => i.services.includes(id));
      if (!hit.length) return base;
      return hit.some((i) => i.impact === 'critical') ? 'outage' : 'degraded';
    };
    const integration = (id: string, name: string, description: string, status: ServiceStatus, note?: string): Integration => ({ id, name, description, status, note, uptime: uptime(id, status) });
    const integrations: Integration[] = [
      integration('api', 'Humo API', 'Every screen and the mobile app.', statusFromIncidents('api')),
      integration('email', 'Email delivery', 'Statements, letters, notices and notifications by email.', statusFromIncidents('email'), statementsKilled ? 'Working. Statement sending from billing runs is paused by its kill switch; other email goes out.' : undefined),
      integration('sms', 'SMS gateway', 'Payment confirmations, reminders and notices by SMS.', statusFromIncidents('sms'), open.find((i) => i.services.includes('sms'))?.updates[0].message),
      integration('whatsapp', 'WhatsApp Business', 'Notices and notifications by WhatsApp.', whatsappKilled ? 'paused' : statusFromIncidents('whatsapp'), whatsappKilled ? 'Switched off by the kill switch: messages go by the other channels.' : undefined),
      integration('bank-fnb', 'Bank feed: FNB', 'Statement imports into the trust accounts.', statusFromIncidents('bank-fnb')),
      integration('bank-nedbank', 'Bank feed: Nedbank', 'Statement imports into the trust accounts.', nedbankDown ? 'degraded' : statusFromIncidents('bank-nedbank'), nedbankDown ? 'The last imports timed out. Receipts will arrive with the next successful import.' : undefined),
      integration('payments', 'Card & instant EFT', 'Owners paying levies online.', statusFromIncidents('payments')),
      integration('rendering', 'Document rendering', 'Statements, notices, minutes and letters as A4 PDFs.', statusFromIncidents('rendering')),
      integration('contractor', 'Humo Contractor', 'Quote requests and work orders with contractors.', statusFromIncidents('contractor')),
    ];
    const r = seeded(`latency:${new Date().toISOString().slice(0, 13)}`);
    const latencySeries = Array.from({ length: 24 }, (_, i) => Math.round(180 + r() * 70 + (i === 9 || i === 10 ? 60 : 0)));
    return {
      availability: 99.96,
      p95Ms: latencySeries.at(-1)!,
      errorRate: 0.08,
      latencySeries,
      integrations,
      jobs,
      incidents: [...this.store.incidents].sort((a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved') || b.startedAt.localeCompare(a.startedAt)),
      customers: this.platform.customers().length,
      killed: this.store.flags.filter((f) => f.kind === 'kill-switch' && !f.rules[CURRENT_ENVIRONMENT].enabled).map((f) => f.name),
    };
  }

  /** Background jobs: seeded history, plus what the simulation itself did (billing runs, statements, receipts, retries). */
  private jobs(): BackgroundJob[] {
    const extra = (id: string) => this.store.extraRuns.get(id) ?? [];
    const hourly = (id: string, detail: (n: number) => string, failLast = 0): JobRun[] =>
      Array.from({ length: 8 }, (_, n) => ({ id: `${id}-${n}`, at: hourAgo(n), status: n < failLast ? 'failed' : 'succeeded', durationMs: n < failLast ? 30_000 : 1200 + ((n * 377) % 900), detail: n < failLast ? 'Bank feed timed out after 30 seconds.' : detail(n) }) as JobRun);
    const todayReceipts = this.db.receipts.filter((x) => x.date.slice(0, 10) === todaySA()).length;
    const withExtra = (id: string, runs: JobRun[]) => [...extra(id), ...runs].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);

    const runs = this.billing.runs.filter((b) => Date.now() - new Date(b.createdAt).getTime() < 30 * DAY).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const sent = this.billing.runs.filter((b) => b.statements).sort((a, b) => b.statements!.at.localeCompare(a.statements!.at));
    const nedbankRetried = extra('bank-nedbank')[0];
    return [
      { id: 'bank-fnb', name: 'Bank statement import: FNB', description: 'Imports trust account statements and matches receipts to accounts.', schedule: 'Hourly', nextRunAt: hourAgo(-1), runs: withExtra('bank-fnb', hourly('bank-fnb', (n) => (n === 0 ? (todayReceipts ? `${todayReceipts} receipts imported today` : 'No new receipts this hour') : `${3 + ((n * 7) % 11)} receipts imported`))) },
      { id: 'bank-nedbank', name: 'Bank statement import: Nedbank', description: 'Imports trust account statements and matches receipts to accounts.', schedule: 'Hourly', nextRunAt: hourAgo(-1), runs: withExtra('bank-nedbank', hourly('bank-nedbank', (n) => `${2 + ((n * 5) % 7)} receipts imported`, nedbankRetried ? 0 : 2)) },
      {
        id: 'billing', name: 'Billing run calculation', description: 'Works out each account’s charges and exceptions when a run is prepared.', schedule: 'When a run is prepared',
        runs: withExtra('billing', runs.slice(0, 8).map((b) => ({ id: `br-${b.id}`, at: b.createdAt, status: 'succeeded' as const, durationMs: 800 + b.lines.length * 12, detail: `${b.ref}: ${b.lines.length || 'history'} accounts` }))),
      },
      {
        id: 'statements', name: 'Statement delivery', description: 'Renders and sends each owner’s statement after a run is posted.', schedule: 'When a run’s statements are sent',
        runs: withExtra('statements', sent.slice(0, 8).map((b) => ({ id: `st-${b.id}`, at: b.statements!.at, status: 'succeeded' as const, durationMs: 4000 + (b.statements!.email + b.statements!.post + b.statements!.portal) * 40, detail: `${b.ref}: ${b.statements!.email} email · ${b.statements!.post} post · ${b.statements!.portal} portal` }))),
      },
      { id: 'notifications', name: 'Notification dispatch', description: 'Sends email, SMS, WhatsApp and push notifications by the agencies’ rules.', schedule: 'Every minute', nextRunAt: ago(-60_000), runs: withExtra('notifications', Array.from({ length: 6 }, (_, n) => ({ id: `nd-${n}`, at: ago(n * 60_000 + 20_000), status: 'succeeded' as const, durationMs: 300 + n * 40, detail: n === 0 ? 'SMS queued at the gateway (INC-0042)' : `${12 + n * 3} messages sent` }))) },
      { id: 'compliance', name: 'Compliance check', description: 'Works out compliance items and keeps their Tasks in step.', schedule: 'On every change, and nightly', runs: withExtra('compliance', [{ id: 'cc-0', at: ago(2 * 60_000), status: 'succeeded', durationMs: 640, detail: 'Tasks up to date' }, { id: 'cc-1', at: hourAgo(Number(new Date().getHours())), status: 'succeeded', durationMs: 5400, detail: 'Nightly check: every scheme' }]) },
      { id: 'backup', name: 'Database backup', description: 'Encrypted backup, copied to a second region.', schedule: 'Daily at 02:00', runs: withExtra('backup', Array.from({ length: 7 }, (_, n) => ({ id: `bk-${n}`, at: new Date(new Date().setHours(2, 0, 0, 0) - n * DAY).toISOString(), status: 'succeeded' as const, durationMs: 840_000 + n * 3000, detail: '42.1 GB, verified' }))) },
    ];
  }

  retryJob(jobId: string): Observable<void> {
    return this.gateway
      .command(
        {
          action: `Retried background job ${jobId}`,
          resource: 'Job',
          resourceId: jobId,
          permission: 'Platform.Operations.Manage',
          validate: () => (this.jobs().some((j) => j.id === jobId) ? null : { jobId: 'No such job.' }),
        },
        () => this.store.addRun(jobId, { at: new Date().toISOString(), status: 'succeeded', durationMs: 2100, detail: jobId.startsWith('bank') ? 'Retried: 14 receipts imported' : 'Retried: completed' }),
      )
      .pipe(map(() => undefined));
  }

  declareIncident(input: NewIncident): Observable<string> {
    return this.gateway.command(
      {
        action: `Declared incident: ${input.title.trim()}`,
        resource: 'Incident',
        permission: 'Platform.Operations.Manage',
        validate: () => this.store.checkIncident(input),
      },
      () => this.store.declare(input, this.auth.current.identity.name),
    );
  }

  updateIncident(id: string, status: IncidentStatus, message: string, expectedVersion?: number): Observable<void> {
    const i = this.store.incidents.find((x) => x.id === id);
    return this.gateway
      .command(
        {
          action: `Incident ${i?.ref ?? id}: ${status}`,
          resource: 'Incident',
          resourceId: i?.ref,
          permission: 'Platform.Operations.Manage',
          version: { expected: expectedVersion, current: i?.version },
          validate: (): FieldErrors | null => {
            if (!i) return { id: 'No such incident.' };
            if (i.status === 'resolved') return { status: 'It’s already resolved: declare a new incident if it’s back.' };
            return message.trim().length < 10 ? { message: 'Say what changed.' } : null;
          },
        },
        () => this.store.update(id, status, message, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }
}

/** 30 days of availability: a dip on days with past incidents, today's status at the end. */
function uptime(id: string, status: ServiceStatus): number[] {
  const r = seeded(`uptime:${id}`);
  return Array.from({ length: 30 }, (_, i) => {
    if (i === 29) return status === 'outage' ? 92 : status === 'degraded' ? 99.2 : 100;
    const dip = r();
    return dip > 0.93 ? Math.round((99 + r()) * 100) / 100 : 100;
  });
}
