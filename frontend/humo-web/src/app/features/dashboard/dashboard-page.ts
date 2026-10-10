import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';
import {
  ChangeEvent,
  InvoiceView,
  JobDataSource,
  JobStage,
  JobSummary,
  PayablesDataSource,
  ROLE_LABELS,
  Scheme,
  SchemeDataSource,
  SchemeHealth,
  SettingsDataSource,
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
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { organisationTeam } from '../../core/session/team';
import { COMPLIANCE, RATING } from '../schemes/scheme-view';
import { isOpenJob, isOverdue } from '../maintenance/job-view';
import { FeatureFlags } from '../../core/flags/feature-flags';

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

interface HealthRow {
  h: SchemeHealth;
  scheme: Scheme;
  reasons: string[];
}

const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

const URGENCY_GROUPS: { id: 'overdue' | 'today' | 'week'; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Due today' },
  { id: 'week', label: 'This week' },
];

const CHANGE_ICON: Record<ChangeEvent['kind'], string> = {
  approval: 'shield-checkmark-outline',
  request: 'construct-outline',
  quote: 'pricetag-outline',
  payments: 'cash-outline',
  compliance: 'shield-half-outline',
  document: 'document-text-outline',
  meeting: 'people-outline',
  billing: 'receipt-outline',
  collection: 'wallet-outline',
};

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
  imports: [EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, DataTable, CellDef, StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  private readonly attention = inject(AttentionService);
  private readonly router = inject(Router);
  protected readonly flags = inject(FeatureFlags);
  private readonly settings = toSignal(inject(SettingsDataSource).agency().pipe(catchError(() => of(null))), { initialValue: null });
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
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
    return combineLatest([
      this.schemesDs.health(),
      this.schemesDs.changes(ids, since),
      this.can.maintenance() ? this.jobsDs.list(ids).pipe(map((p) => p.items)) : of([] as JobSummary[]),
      this.can.payables() ? this.payablesDs.invoices(ids) : of([] as InvoiceView[]),
    ]).pipe(map(([health, changes, jobs, invoices]) => ({ health: health.filter((h) => ids.includes(h.schemeId)), changes, jobs, invoices })));
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
      .filter((x) => x.urgency !== 'later')
      .slice(0, 9);
  });
  /** Today, grouped by urgency rather than module (F9). */
  protected readonly todayGroups = computed(() =>
    URGENCY_GROUPS.map((g) => ({ ...g, items: this.attentionItems().filter((a) => a.urgency === g.id) })).filter((g) => g.items.length),
  );
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
      const open = h.reduce((n, x) => n + x.complianceOpenItems, 0);
      const overdue = h.filter((x) => x.compliance === 'overdue').length;
      tiles.push({ id: 'compliance', label: 'Compliance', value: String(open), sub: overdue ? `items due · ${overdue} scheme${overdue === 1 ? '' : 's'} overdue` : 'items due within 30 days or overdue', route: '/compliance', query: open ? { view: 'due' } : undefined, tone: open ? 'attention' : 'calm', icon: 'shield-half-outline' });
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
      { label: 'Billing', count: null, note: `Runs on the ${ord(this.settings()?.billing.billingDay ?? 25)}`, route: '/finance/billing' },
      { label: 'Payments', count: this.attention.counts().receipts, note: 'to allocate', route: '/finance/receipts' },
      { label: 'Allocation', count: null, note: 'matched daily', route: '/finance/receipts' },
      { label: 'Statements', count: null, note: `due by the ${ord(this.settings()?.billing.dueDay ?? 7)}`, route: '/finance/billing' },
      { label: 'Credit control', count: h.reduce((n, x) => n + x.accounts90Plus, 0), note: '90+ days', route: '/finance/credit-control' },
    ];
  });

  protected readonly showMaintenanceFlow = computed(() => this.can.maintenance() && ['agency-admin', 'portfolio-manager', 'operations', 'trustee'].includes(this.session.role()));
  protected readonly showFinanceFlow = computed(() => ['finance', 'agency-admin'].includes(this.session.role()) && this.session.hasFeature('billing'));

  /** What changed since yesterday that may need someone: newest first. */
  protected readonly changes = computed(() => this.data.value()?.changes ?? []);
  protected readonly changeIcon = CHANGE_ICON;
  protected readonly showAllChanges = signal(false);
  protected readonly shownChanges = computed(() => (this.showAllChanges() ? this.changes() : this.changes().slice(0, 6)));

  /** One row per scheme in scope, worst first: which scheme needs me (F9 "Portfolio health"). */
  protected readonly healthRows = computed<HealthRow[]>(() => {
    const byId = new Map(this.scope.accessible().map((s) => [s.id, s]));
    const rank = { 'at-risk': 0, watch: 1, good: 2 };
    return this.health()
      .filter((h) => byId.has(h.schemeId))
      .sort((a, b) => rank[a.rating] - rank[b.rating] || b.arrears - a.arrears)
      .map((h) => ({ h, scheme: byId.get(h.schemeId)!, reasons: this.reasons(h) }));
  });
  protected readonly healthColumns: ColumnDef<HealthRow>[] = [
    { key: 'scheme', header: 'Scheme', mobile: 'title', sort: (r) => r.scheme.name },
    { key: 'rating', header: 'Health', width: '110px', sort: (r) => ({ 'at-risk': 0, watch: 1, good: 2 })[r.h.rating] },
    { key: 'collected', header: 'Collected', align: 'end', width: '100px', sort: (r) => r.h.collectionRate },
    { key: 'arrears', header: 'Arrears', align: 'end', width: '120px', sort: (r) => r.h.arrears },
    { key: 'jobs', header: 'Jobs', width: '120px', sort: (r) => r.h.overdueJobs * 1000 + r.h.openJobs },
    { key: 'compliance', header: 'Compliance', width: '130px', sort: (r) => ({ overdue: 0, 'due-soon': 1, upcoming: 2, complete: 3, 'not-applicable': 4 })[r.h.compliance] },
    { key: 'meeting', header: 'Next meeting', width: '150px', mobile: 'hidden', sort: (r) => r.h.nextMeeting?.at ?? '9999' },
  ];
  protected readonly healthRowId = (r: HealthRow) => r.h.schemeId;
  protected readonly ratingOf = (r: HealthRow) => RATING[r.h.rating];
  protected readonly complianceOf = (r: HealthRow) => COMPLIANCE[r.h.compliance];
  protected readonly showComplianceColumn = computed(() => this.session.hasFeature('compliance'));

  /** The portfolio in one line: totals belong in a small strip, not the headline (F9). */
  protected readonly strip = computed(() => {
    const h = this.health();
    const roll = h.reduce((n, x) => n + x.monthlyLevyRoll, 0);
    const weighted = roll ? h.reduce((n, x) => n + x.collectionRate * x.monthlyLevyRoll, 0) / roll : 100;
    return [
      { label: 'Schemes', value: String(h.length) },
      { label: 'Units', value: this.scope.accessible().filter((s) => h.some((x) => x.schemeId === s.id)).reduce((n, s) => n + s.unitCount, 0).toLocaleString('en-ZA') },
      { label: 'Monthly levy roll', value: this.rand(roll) },
      { label: 'Collected (3 months)', value: `${weighted.toFixed(1)}%` },
      { label: 'Arrears', value: this.rand(h.reduce((n, x) => n + x.arrears, 0)) },
    ];
  });

  /** Agency administrators see who carries the open work (F9 role variant). */
  private readonly team = organisationTeam();
  protected readonly workload = computed(() => {
    if (this.session.role() !== 'agency-admin') return [];
    const tasks = this.attention.open().filter((w) => w.kind === 'task');
    const by = new Map<string, { id: string | null; open: number; overdue: number }>();
    for (const w of tasks) {
      const key = w.assigneeId ?? 'none';
      const x = by.get(key) ?? { id: w.assigneeId, open: 0, overdue: 0 };
      x.open++;
      if (urgencyOf(w) === 'overdue') x.overdue++;
      by.set(key, x);
    }
    const max = Math.max(1, ...[...by.values()].map((x) => x.open));
    return [...by.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open).map((x) => ({ ...x, name: this.team.nameOf(x.id), pct: (x.open / max) * 100 }));
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

  protected openScheme(r: HealthRow): void {
    void this.router.navigate(['/schemes', r.h.schemeId, 'overview']);
  }

  protected link(w: WorkItem): string {
    return w.kind === 'approval' ? '/approvals' : w.route;
  }

  private reasons(h: SchemeHealth): string[] {
    const r: string[] = [];
    const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    if (h.compliance === 'overdue') r.push(`compliance overdue (${h.complianceOpenItems})`);
    if (h.overdueJobs) r.push(`${n(h.overdueJobs, 'job')} overdue`);
    if (h.collectionRate < 91) r.push(`${h.collectionRate}% collected`);
    if (h.compliance === 'due-soon') r.push(`${n(h.complianceOpenItems, 'compliance item')} due`);
    if (h.accounts90Plus) r.push(`${n(h.accounts90Plus, 'account')} 90+ days`);
    return r.slice(0, 3);
  }
}
