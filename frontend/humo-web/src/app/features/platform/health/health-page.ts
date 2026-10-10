import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import {
  BackgroundJob,
  INCIDENT_STATUS_LABELS,
  Incident,
  IncidentStatus,
  Integration,
  OpsDataSource,
  SERVICE_STATUS_LABELS,
  ServiceStatus,
} from '../../../domain';
import { FeedbackService } from '../../../core/feedback/feedback.service';
import { loadable } from '../../../core/data/loadable';
import { SessionService } from '../../../core/session/session.service';
import { AreaChart } from '../../../ui/charts/charts';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { formatDate } from '../../../ui/format/money';
import { relativeTime } from '../../../ui/format/relative-time';
import { PageHeader } from '../../../ui/page-header/page-header';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { StatusPill, Tone } from '../../../ui/status-pill/status-pill';
import { openForm } from '../../shared/form-drawer';

const SERVICE_TONE: Record<ServiceStatus, Tone> = { operational: 'success', degraded: 'warning', outage: 'danger', paused: 'neutral' };
const INCIDENT_TONE: Record<IncidentStatus, Tone> = { investigating: 'danger', identified: 'warning', monitoring: 'info', resolved: 'success' };

/**
 * Platform › Platform health: is Humo working for customers right now?
 * API availability and latency, every integration, the background jobs
 * (bank imports, billing, statements, notifications, backups) and incidents.
 */
@Component({
  selector: 'app-health-page',
  imports: [PageHeader, AreaChart, StatusPill, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Platform" title="Platform health" subtitle="Availability, integrations, background jobs and incidents across every customer.">
      @if (canManage()) {
        <button type="button" class="btn btn-secondary" (click)="declare()"><ion-icon name="alert-circle-outline" aria-hidden="true" /> Declare incident</button>
      }
    </ui-page-header>

    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="4" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load platform health" (retry)="result.retry()" /></div>
    } @else {
      @let h = result.value()!;
      <div class="status surface" [class]="'status surface ' + overall()">
        <ion-icon [name]="overall() === 'operational' ? 'checkmark-circle-outline' : 'alert-circle-outline'" aria-hidden="true" />
        <strong>{{ overallText() }}</strong>
      </div>

      <div class="tiles">
        <div class="tile surface"><div class="label-caps">Availability (30 days)</div><div class="big">{{ h.availability }}%</div><div class="muted">target 99.9%</div></div>
        <div class="tile surface"><div class="label-caps">Response time (p95)</div><div class="big">{{ h.p95Ms }} ms</div><div class="muted">last hour</div></div>
        <div class="tile surface"><div class="label-caps">Server errors</div><div class="big">{{ h.errorRate }}%</div><div class="muted">of requests, last 24 hours</div></div>
        <div class="tile surface"><div class="label-caps">Open incidents</div><div class="big" [class.warn]="openIncidents().length">{{ openIncidents().length }}</div><div class="muted">{{ h.customers }} customers on the platform</div></div>
      </div>

      <section class="surface panel">
        <h2 class="section-title">Response time, last 24 hours (p95, ms)</h2>
        <ui-area-chart [values]="h.latencySeries" [labels]="['24h ago', '18h', '12h', '6h', 'now']" label="p95 response time over the last 24 hours" />
      </section>

      @if (openIncidents().length) {
        <section class="surface panel">
          <h2 class="section-title">Open incidents</h2>
          @for (i of openIncidents(); track i.id) {
            <article class="incident">
              <div class="i-head">
                <span class="ref">{{ i.ref }}</span>
                <strong>{{ i.title }}</strong>
                <ui-status-pill [label]="statusLabel(i)" [tone]="incidentTone(i)" />
                <span class="muted">{{ i.impact }} · started {{ ago(i.startedAt) }} · {{ serviceNames(i) }}</span>
                @if (canManage()) {
                  <button type="button" class="btn btn-secondary btn-sm" (click)="post(i)">Post update</button>
                }
              </div>
              <ol class="updates">
                @for (u of i.updates; track u.at) {
                  <li><span class="u-when">{{ formatDate(u.at, true) }} {{ time(u.at) }}</span> <strong>{{ incidentStatus(u.status) }}</strong> — {{ u.message }} <span class="muted">({{ u.by }})</span></li>
                }
              </ol>
            </article>
          }
        </section>
      }

      <section class="surface panel">
        <h2 class="section-title">Integrations</h2>
        <ul class="integrations">
          @for (s of h.integrations; track s.id) {
            <li>
              <div class="s-main">
                <div class="s-name">{{ s.name }}</div>
                <div class="muted">{{ s.note ?? s.description }}</div>
              </div>
              <div class="bars" role="img" [attr.aria-label]="s.name + ': 30-day availability ' + avg(s) + '%'">
                @for (u of s.uptime; track $index) {
                  <span [class]="barClass(u)" [title]="u + '%'"></span>
                }
              </div>
              <ui-status-pill [label]="serviceLabel(s)" [tone]="serviceTone(s)" />
            </li>
          }
        </ul>
      </section>

      <section class="surface panel">
        <h2 class="section-title">Background jobs</h2>
        <table class="jobs">
          <thead><tr><th>Job</th><th>Schedule</th><th>Last run</th><th>Result</th><th></th></tr></thead>
          <tbody>
            @for (j of h.jobs; track j.id) {
              @let last = j.runs[0];
              <tr [class.failed]="last?.status === 'failed'">
                <td>
                  <button type="button" class="link" (click)="toggle(j.id)" [attr.aria-expanded]="open() === j.id">{{ j.name }}</button>
                  <div class="muted">{{ j.description }}</div>
                </td>
                <td class="muted">{{ j.schedule }}</td>
                <td>{{ last ? ago(last.at) : '—' }}</td>
                <td>
                  @if (last) {
                    <ui-status-pill [label]="last.status === 'failed' ? 'Failed' : 'OK'" [tone]="last.status === 'failed' ? 'danger' : 'success'" />
                    <div class="muted">{{ last.detail }}</div>
                  } @else {
                    <span class="muted">No runs in 30 days</span>
                  }
                </td>
                <td class="end">
                  @if (last?.status === 'failed' && canManage()) {
                    <button type="button" class="btn btn-primary btn-sm" [disabled]="busy() === j.id" (click)="retry(j)"><ion-icon name="refresh-outline" aria-hidden="true" /> Retry</button>
                  }
                </td>
              </tr>
              @if (open() === j.id) {
                <tr class="runs">
                  <td colspan="5">
                    <ul>
                      @for (r of j.runs; track r.id) {
                        <li [class.failed]="r.status === 'failed'"><span>{{ formatDate(r.at, true) }} {{ time(r.at) }}</span><span>{{ r.status === 'failed' ? 'Failed' : 'OK' }} · {{ seconds(r.durationMs) }}</span><span class="muted">{{ r.detail }}</span></li>
                      }
                    </ul>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </section>

      <section class="surface panel">
        <h2 class="section-title">Past incidents</h2>
        <ul class="past">
          @for (i of pastIncidents(); track i.id) {
            <li>
              <span class="ref">{{ i.ref }}</span> <strong>{{ i.title }}</strong>
              <span class="muted"> · {{ formatDate(i.startedAt) }} · {{ duration(i) }} · {{ i.updates[0].message }}</span>
            </li>
          } @empty {
            <li class="muted">None in the last 90 days.</li>
          }
        </ul>
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .status { display: flex; gap: var(--s-2); align-items: center; padding: var(--s-3) var(--s-4); }
    .status ion-icon { font-size: 22px; }
    .status.operational ion-icon { color: var(--c-success); }
    .status.degraded { background: var(--c-warning-soft); }
    .status.degraded ion-icon { color: var(--c-warning); }
    .status.outage { background: var(--c-danger-soft); }
    .status.outage ion-icon { color: var(--c-danger); }
    .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--s-3); }
    .tile { padding: var(--s-3) var(--s-4); }
    .big { margin: 4px 0 2px; font-size: var(--fs-xl); font-weight: var(--fw-semibold); }
    .big.warn { color: var(--c-warning); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .panel { padding: var(--s-4) var(--s-5); }
    .section-title { margin: 0 0 var(--s-3); font-size: var(--fs-md); }
    .incident { padding: var(--s-3) 0; border-top: 1px solid var(--c-border); }
    .i-head { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
    .i-head .btn { margin-left: auto; }
    .ref { font-size: var(--fs-xs); color: var(--c-text-muted); font-variant-numeric: tabular-nums; }
    .updates { margin: var(--s-2) 0 0; padding-left: var(--s-4); font-size: var(--fs-sm); }
    .updates li { margin-bottom: 4px; }
    .u-when { color: var(--c-text-muted); font-variant-numeric: tabular-nums; }
    .integrations { margin: 0; padding: 0; list-style: none; }
    .integrations li { display: grid; grid-template-columns: minmax(0, 1fr) 240px 120px; gap: var(--s-3); align-items: center; padding: var(--s-2) 0; border-top: 1px solid var(--c-border); }
    .s-name { font-weight: var(--fw-medium); }
    .bars { display: flex; gap: 2px; height: 22px; }
    .bars span { flex: 1; border-radius: 2px; background: var(--c-success); opacity: 0.8; }
    .bars span.dip { background: var(--c-warning); }
    .bars span.down { background: var(--c-danger); }
    .jobs { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .jobs th, .jobs td { padding: 8px; border-top: 1px solid var(--c-border); text-align: left; vertical-align: top; }
    .jobs th { font-size: var(--fs-xs); color: var(--c-text-muted); text-transform: uppercase; letter-spacing: 0.04em; border-top: 0; }
    .jobs tr.failed td { background: var(--c-danger-soft); }
    .jobs .end { text-align: right; }
    .jobs .runs td { background: var(--c-surface-sunken); }
    .jobs .runs ul { margin: 0; padding: 0; list-style: none; }
    .jobs .runs li { display: grid; grid-template-columns: 140px 140px 1fr; gap: var(--s-3); padding: 2px 0; }
    .jobs .runs li.failed { color: var(--c-danger); }
    .link { padding: 0; font: inherit; font-weight: var(--fw-medium); color: var(--c-primary-text); text-align: left; background: none; border: 0; cursor: pointer; }
    .past { margin: 0; padding: 0; list-style: none; font-size: var(--fs-sm); }
    .past li { padding: var(--s-2) 0; border-top: 1px solid var(--c-border); }
    @media (max-width: 900px) { .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } .integrations li { grid-template-columns: 1fr; } .jobs th:nth-child(2), .jobs td:nth-child(2) { display: none; } }
  `,
})
export class HealthPage {
  private readonly data = inject(OpsDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  private readonly session = inject(SessionService);

  protected readonly result = loadable(() => this.data.health());
  protected readonly open = signal<string | null>(null);
  protected readonly busy = signal<string | null>(null);

  protected readonly openIncidents = computed(() => (this.result.value()?.incidents ?? []).filter((i) => i.status !== 'resolved'));
  protected readonly pastIncidents = computed(() => (this.result.value()?.incidents ?? []).filter((i) => i.status === 'resolved'));
  protected readonly overall = computed<'operational' | 'degraded' | 'outage'>(() => {
    const s = (this.result.value()?.integrations ?? []).map((i) => i.status);
    return s.includes('outage') ? 'outage' : s.includes('degraded') ? 'degraded' : 'operational';
  });
  protected readonly overallText = computed(() => {
    const h = this.result.value();
    if (!h) return '';
    const affected = h.integrations.filter((i) => i.status === 'degraded' || i.status === 'outage').map((i) => i.name);
    const parts = [affected.length ? `Degraded: ${affected.join(', ')}` : 'All systems operational', ...(h.killed.length ? [`Switched off by a kill switch: ${h.killed.join(', ')}`] : [])];
    return parts.join(' · ');
  });

  protected readonly canManage = computed(() => this.session.can('Platform.Operations.Manage') && !this.session.readOnly());
  protected readonly formatDate = formatDate;
  protected readonly ago = (iso: string) => relativeTime(iso);
  protected readonly time = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
  protected readonly seconds = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 1000).toFixed(1)} s`);
  protected readonly statusLabel = (i: Incident) => INCIDENT_STATUS_LABELS[i.status];
  protected readonly incidentStatus = (s: IncidentStatus) => INCIDENT_STATUS_LABELS[s];
  protected readonly incidentTone = (i: Incident) => INCIDENT_TONE[i.status];
  protected readonly serviceLabel = (s: Integration) => SERVICE_STATUS_LABELS[s.status];
  protected readonly serviceTone = (s: Integration) => SERVICE_TONE[s.status];
  protected readonly barClass = (u: number) => (u < 95 ? 'down' : u < 100 ? 'dip' : '');
  protected readonly avg = (s: Integration) => (s.uptime.reduce((n, u) => n + u, 0) / s.uptime.length).toFixed(2);
  protected serviceNames(i: Incident): string {
    const all = this.result.value()?.integrations ?? [];
    return i.services.map((id) => all.find((s) => s.id === id)?.name ?? id).join(', ');
  }
  protected duration(i: Incident): string {
    if (!i.resolvedAt) return 'ongoing';
    const m = Math.round((new Date(i.resolvedAt).getTime() - new Date(i.startedAt).getTime()) / 60_000);
    return m >= 90 ? `${Math.round(m / 60)} hours` : `${m} minutes`;
  }

  protected toggle(id: string): void {
    this.open.set(this.open() === id ? null : id);
  }

  protected retry(j: BackgroundJob): void {
    this.busy.set(j.id);
    this.data.retryJob(j.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.feedback.success(`${j.name}: retried.`);
      },
      error: () => {
        this.busy.set(null);
        this.feedback.error('The retry didn’t start.');
      },
    });
  }

  protected declare(): void {
    const services = (this.result.value()?.integrations ?? []).map((s) => ({ value: s.id, label: s.name }));
    openForm(this.drawer, {
      eyebrow: 'Platform health',
      title: 'Declare an incident',
      intro: 'It shows here for the whole Humo team straight away, and the affected services turn degraded until it’s resolved.',
      fields: [
        { key: 'title', label: 'What customers are seeing', type: 'text', required: true, placeholder: 'e.g. Bank receipts not importing' },
        { key: 'impact', label: 'Impact', type: 'select', required: true, options: [{ value: 'minor', label: 'Minor: slower or delayed' }, { value: 'major', label: 'Major: a feature isn’t working' }, { value: 'critical', label: 'Critical: Humo is down' }] },
        { key: 'services', label: 'Affected services', type: 'checks', required: true, options: services },
        { key: 'message', label: 'First update', type: 'textarea', required: true, placeholder: 'What you know and what you’re doing.' },
      ],
      initial: { impact: 'minor' },
      submitLabel: 'Declare incident',
      submit: (v) => this.data.declareIncident({ title: v['title'], impact: v['impact'] as Incident['impact'], services: v['services'].split(',').filter(Boolean), message: v['message'] }),
      success: () => 'Incident declared.',
      failure: 'The incident wasn’t declared',
    });
  }

  protected post(i: Incident): void {
    openForm(this.drawer, {
      eyebrow: `${i.ref} · ${i.title}`,
      title: 'Post an update',
      fields: [
        { key: 'status', label: 'Status', type: 'select', required: true, options: (Object.keys(INCIDENT_STATUS_LABELS) as IncidentStatus[]).map((s) => ({ value: s, label: INCIDENT_STATUS_LABELS[s] })) },
        { key: 'message', label: 'Update', type: 'textarea', required: true },
      ],
      initial: { status: i.status === 'investigating' ? 'identified' : i.status === 'identified' ? 'monitoring' : 'resolved' },
      submitLabel: 'Post update',
      submit: (v) => this.data.updateIncident(i.id, v['status'] as IncidentStatus, v['message'], i.version),
      success: (_r, v) => (v['status'] === 'resolved' ? `${i.ref} resolved.` : 'Update posted.'),
      failure: 'The update wasn’t posted',
    });
  }
}
