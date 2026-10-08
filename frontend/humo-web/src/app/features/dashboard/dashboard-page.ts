import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';
import {
  InvoiceView,
  JobDataSource,
  JobStage,
  JobSummary,
  PayablesDataSource,
  ROLE_LABELS,
  Scheme,
  SchemeDataSource,
  SchemeHealth,
  WORK_TYPE_LABELS,
  WorkItem,
  coversAllSchemes,
  urgencyOf,
} from '../../domain';
import { AttentionService } from '../../core/attention/attention.service';
import { PRODUCT } from '../../core/product/product';
import { loadable } from '../../core/data/loadable';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { dueLabel, formatDate, formatRand } from '../../ui/format/money';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { isOpenJob, isOverdue } from '../maintenance/job-view';

interface Tile {
  id: string;
  label: string;
  value: string;
  sub: string;
  route: string;
  query?: Record<string, string>;
  tone?: 'attention' | 'calm';
  icon: string;
}

interface FlowStep {
  label: string;
  count: number | null;
  note?: string;
  route?: string;
}

const MAINT_FLOW: { label: string; stages: JobStage[] }[] = [
  { label: 'Reported', stages: ['reported'] },
  { label: 'Quotes', stages: ['quoting'] },
  { label: 'Approval', stages: ['approval'] },
  { label: 'Work', stages: ['approved', 'scheduled', 'in-progress'] },
  { label: 'Completion', stages: ['completed', 'verified'] },
  { label: 'Invoice', stages: ['invoiced'] },
];

/**
 * The operational dashboard: "What needs my attention?" — not vanity metrics.
 * Every number is actionable and links to where the work is done. The content
 * follows the role (permissions), the plan (entitlements) and the scope chip.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  private readonly attention = inject(AttentionService);
  private readonly schemesDs = inject(SchemeDataSource);
  private readonly jobsDs = inject(JobDataSource);
  private readonly payablesDs = inject(PayablesDataSource);
  protected readonly session = inject(SessionService);
  protected readonly scope = inject(ScopeService);

  private readonly can = {
    money: computed(() => this.session.can('Accounts.View') || this.session.role() === 'trustee'),
    // Finance works the money; maintenance belongs on the dashboards of the people who run jobs.
    maintenance: computed(() => this.session.hasFeature('maintenance-basic') && (this.session.can('Maintenance.Manage') || this.session.role() === 'trustee')),
    payables: computed(() => this.session.hasFeature('payables') && (this.session.can('Payables.Prepare') || this.session.role() === 'trustee' || this.session.role() === 'portfolio-manager')),
    receipts: computed(() => this.session.hasFeature('payment-allocation') && this.session.can('Receipts.Allocate')),
  };

  /** Only asks for what this role may see and the plan includes; re-asks when the scope chip changes. */
  protected readonly data = loadable(() => {
    const ids = this.scope.effectiveIds();
    return combineLatest([
      this.schemesDs.health(),
      this.can.maintenance() ? this.jobsDs.list(ids).pipe(map((p) => p.items)) : of([] as JobSummary[]),
      this.can.payables() ? this.payablesDs.invoices(ids) : of([] as InvoiceView[]),
    ]).pipe(map(([health, jobs, invoices]) => ({ health: health.filter((h) => ids.includes(h.schemeId)), jobs, invoices })));
  });

  protected readonly loading = this.data.loading;
  protected readonly failed = this.data.failed;
  protected readonly noScope = computed(() => (this.session.isStaff() || this.session.role() === 'trustee') && this.scope.accessible().length === 0);

  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${this.session.identity().name.split(' ')[0]}`;
  });

  protected readonly context = computed(() => {
    const s = this.scope.scheme();
    const n = this.scope.accessible().length;
    const where = s ? s.name : coversAllSchemes(this.session.assignment()) ? 'All schemes' : `${n} ${n === 1 ? 'scheme' : 'schemes'}`;
    return `${ROLE_LABELS[this.session.role()]} · ${this.session.organisation()?.shortName ?? ''} · ${where}`;
  });

  /** The few things that will hurt if not done soon: overdue and due-today, from the Attention model. */
  protected readonly attentionItems = computed(() => {
    const order = { overdue: 0, today: 1, week: 2, later: 3 };
    const mine = new Set([...this.attention.myTasks(), ...this.attention.pendingApprovals(), ...this.attention.inbox()].map((w) => w.id));
    return this.attention
      .open()
      .filter((w) => mine.has(w.id))
      .map((w) => ({ w, urgency: urgencyOf(w) }))
      .sort((a, b) => order[a.urgency] - order[b.urgency] || a.w.dueAt.localeCompare(b.w.dueAt))
      .slice(0, 7);
  });
  protected readonly attentionTotal = computed(() => this.attention.myTasks().length + this.attention.pendingApprovals().length);

  private readonly health = computed(() => this.data.value()?.health ?? []);
  private readonly openJobs = computed(() => (this.data.value()?.jobs ?? []).filter((j) => isOpenJob(j.job)));

  protected readonly tiles = computed<Tile[]>(() => {
    const c = this.attention.counts();
    const h = this.health();
    const tiles: Tile[] = [];
    const role = this.session.role();
    const rand = (n: number) => formatRand(n, { compact: true, cents: false });

    if (this.session.can('Approvals.Decide')) {
      tiles.push({ id: 'approvals', label: 'Waiting for your decision', value: String(c.approvals), sub: c.approvals ? 'quotes, invoices and payments' : 'nothing to approve', route: '/approvals', tone: c.approvals ? 'attention' : 'calm', icon: 'shield-checkmark-outline' });
    }
    if (this.can.money()) {
      const arrears = h.reduce((n, x) => n + x.arrears, 0);
      const ninety = h.reduce((n, x) => n + x.accounts90Plus, 0);
      tiles.push({
        id: 'arrears', label: 'Outstanding balances', value: rand(arrears), sub: `${ninety} accounts over 90 days`,
        route: role === 'trustee' ? `/schemes/${this.session.assignment().scope.schemeIds[0]}/overview` : '/finance/credit-control', tone: ninety ? 'attention' : 'calm', icon: 'wallet-outline',
      });
    }
    if (this.can.receipts()) {
      tiles.push({ id: 'receipts', label: 'Payments to allocate', value: String(c.receipts), sub: 'bank receipts not yet on an account', route: '/finance/receipts', tone: c.receipts ? 'attention' : 'calm', icon: 'cash-outline' });
    }
    if (this.can.maintenance()) {
      const jobs = this.openJobs();
      const overdue = jobs.filter((j) => isOverdue(j.job)).length;
      tiles.push({ id: 'jobs', label: 'Maintenance', value: String(jobs.length), sub: overdue ? `${overdue} overdue` : 'open jobs, none overdue', route: '/maintenance', query: overdue ? { view: 'overdue' } : undefined, tone: overdue ? 'attention' : 'calm', icon: 'construct-outline' });
    }
    if (this.can.payables()) {
      const inv = this.data.value()?.invoices ?? [];
      const waiting = inv.filter((i) => i.invoice.status === 'awaiting-approval').length;
      const ready = inv.filter((i) => i.invoice.status === 'approved').length;
      tiles.push({ id: 'payables', label: 'Supplier invoices', value: String(waiting + ready), sub: `${waiting} awaiting approval · ${ready} ready to pay`, route: '/finance/payables', query: { view: waiting ? 'approval' : 'ready' }, tone: waiting ? 'attention' : 'calm', icon: 'receipt-outline' });
    }
    if (this.session.isStaff()) {
      tiles.push({ id: 'inbox', label: 'Messages', value: String(c.inbox), sub: 'from owners, tenants and trustees', route: '/inbox', tone: c.inbox ? 'attention' : 'calm', icon: 'mail-outline' });
    }
    if (this.session.hasFeature('compliance') && (this.session.isStaff() || role === 'trustee')) {
      tiles.push({ id: 'compliance', label: 'Compliance', value: String(c.compliance), sub: 'items due or overdue', route: '/compliance', tone: c.compliance ? 'attention' : 'calm', icon: 'shield-half-outline' });
    }
    return tiles;
  });

  /** The maintenance workflow as one connected line, with counts at each step. */
  protected readonly maintenanceFlow = computed<FlowStep[]>(() =>
    MAINT_FLOW.map((s) => ({ label: s.label, count: this.openJobs().filter((j) => s.stages.includes(j.job.stage)).length, route: '/maintenance' })),
  );

  /** Finance workflow: billing → payment → allocation → statement → credit control. */
  protected readonly financeFlow = computed<FlowStep[]>(() => {
    const h = this.health();
    return [
      { label: 'Billing', count: null, note: 'Next run 25th', route: '/finance/billing' },
      { label: 'Payments', count: this.attention.counts().receipts, note: 'to allocate', route: '/finance/receipts' },
      { label: 'Allocation', count: null, note: 'matched daily', route: '/finance/receipts' },
      { label: 'Statements', count: null, note: 'sent on the 1st', route: '/finance/billing' },
      { label: 'Credit control', count: h.reduce((n, x) => n + x.accounts90Plus, 0), note: '90+ days', route: '/finance/credit-control' },
    ];
  });

  protected readonly showMaintenanceFlow = computed(() => this.can.maintenance() && ['agency-admin', 'portfolio-manager', 'operations', 'trustee'].includes(this.session.role()));
  protected readonly showFinanceFlow = computed(() => ['finance', 'agency-admin'].includes(this.session.role()) && this.session.hasFeature('billing'));

  /** Schemes that need a person (staff), worst first. */
  protected readonly schemes = computed(() => {
    const byId = new Map(this.scope.accessible().map((s) => [s.id, s]));
    const rank = { 'at-risk': 0, watch: 1, good: 2 };
    return this.health()
      .filter((h) => h.rating !== 'good')
      .sort((a, b) => rank[a.rating] - rank[b.rating] || b.arrears - a.arrears)
      .slice(0, 5)
      .map((h) => ({ h, scheme: byId.get(h.schemeId) as Scheme, reasons: this.reasons(h) }))
      .filter((x) => !!x.scheme);
  });

  /** A trustee sees their one scheme at a glance. */
  protected readonly ownScheme = computed(() => {
    if (this.session.role() !== 'trustee') return null;
    const h = this.health()[0];
    return h ? { h, scheme: this.scope.findScheme(h.schemeId) } : null;
  });

  protected readonly productName = PRODUCT.name;
  protected readonly today = new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
  protected readonly workLabel = WORK_TYPE_LABELS;
  protected readonly dueLabel = dueLabel;
  protected readonly formatDate = formatDate;
  protected readonly rand = (n: number) => formatRand(n, { compact: true, cents: false });

  protected schemeName(id: string): string {
    return this.scope.findScheme(id)?.name ?? '';
  }

  protected link(w: WorkItem): string {
    return w.kind === 'approval' ? '/approvals' : w.route;
  }

  private reasons(h: SchemeHealth): string[] {
    const r: string[] = [];
    if (h.accounts90Plus) r.push(`${h.accounts90Plus} accounts 90+ days`);
    if (h.overdueJobs) r.push(`${h.overdueJobs} overdue jobs`);
    if (h.compliance === 'overdue') r.push('compliance overdue');
    if (h.collectionRate < 92) r.push(`${h.collectionRate}% collected`);
    return r.slice(0, 3);
  }
}
