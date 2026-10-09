import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import {
  AGEING_LABELS,
  COLLECTION_STAGE_LABELS,
  COMPLIANCE_STATUS_LABELS,
  COMPLIANCE_TYPES,
  JOB_STAGES,
  RESOLUTION_PROGRESS_LABELS,
  ReportCell,
  ReportColumn,
  ReportDataSource,
  ReportDef,
  ReportId,
  ReportParams,
  ReportResult,
  SchemeDataSource,
  overdueOf,
} from '../../domain';
import { BillingStore } from '../db/billing-store';
import { CollectionsStore } from '../db/collections-store';
import { ComplianceStore } from '../db/compliance-store';
import { GovernanceStore } from '../db/governance-store';
import { MaintenanceStore } from '../db/maintenance-store';
import { MockDb } from '../db/mock-db';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';

export const REPORTS: ReportDef[] = [
  { id: 'levy-roll', title: 'Levy roll', category: 'financial', description: 'Each scheme’s units and monthly levies.', permission: 'Finance.View', feature: 'reporting-basic' },
  { id: 'billing-summary', title: 'Billing summary', category: 'financial', description: 'Every billing run: period, accounts, total and where it stands.', permission: 'Billing.View', feature: 'reporting-financial', period: true },
  { id: 'receipts', title: 'Receipts', category: 'financial', description: 'Payments received per scheme: allocated, still to allocate, in suspense.', permission: 'Finance.View', feature: 'reporting-financial', period: true },
  { id: 'supplier-payments', title: 'Supplier payments', category: 'financial', description: 'What each supplier was paid, by scheme.', permission: 'Finance.View', feature: 'reporting-financial', period: true },
  { id: 'age-analysis', title: 'Age analysis', category: 'arrears', description: 'Arrears per scheme: current, 30, 60, 90 and 120+ days.', permission: 'Finance.View', feature: 'reporting-basic' },
  { id: 'debtors', title: 'Debtors list', category: 'arrears', description: 'Every account in arrears with its age and collection stage.', permission: 'Accounts.View', feature: 'reporting-financial' },
  { id: 'collections', title: 'Collection pipeline', category: 'arrears', description: 'How many accounts sit at each collection stage, per scheme.', permission: 'Billing.View', feature: 'credit-control' },
  { id: 'jobs-by-stage', title: 'Jobs by stage', category: 'maintenance', description: 'Open maintenance jobs per scheme, by stage, with what’s overdue.', permission: 'Maintenance.View', feature: 'reporting-basic' },
  { id: 'supplier-performance', title: 'Supplier performance', category: 'maintenance', description: 'Jobs, on-time rate, invoice vs quote and spend per supplier.', permission: 'Suppliers.View', feature: 'reporting-basic' },
  { id: 'resolutions', title: 'Resolutions register', category: 'governance', description: 'Every resolution with its outcome and the progress of its actions.', permission: 'Governance.View', feature: 'governance' },
  { id: 'compliance-status', title: 'Compliance status', category: 'governance', description: 'Each scheme’s compliance obligations and their status.', permission: 'Compliance.View', feature: 'compliance' },
  { id: 'scheme-health', title: 'Scheme health', category: 'portfolio', description: 'Collections, arrears, jobs, compliance and rating for every scheme.', permission: 'Portfolio.View', feature: 'reporting-basic' },
  { id: 'occupancy', title: 'Units & occupancy', category: 'portfolio', description: 'Owner-occupied, tenanted and vacant units per scheme.', permission: 'Portfolio.View', feature: 'reporting-basic' },
];

const DAY = 86_400_000;
const col = (key: string, label: string, kind: ReportColumn['kind'] = 'text', total = false): ReportColumn => ({ key, label, kind, total });

/**
 * The report service for the prototype: every report is worked out from the
 * same live records the screens use, so a report never disagrees with a page.
 */
@Injectable()
export class InMemoryReportDataSource extends ReportDataSource {
  private readonly db = inject(MockDb);
  private readonly maintenance = inject(MaintenanceStore);
  private readonly billing = inject(BillingStore);
  private readonly collections = inject(CollectionsStore);
  private readonly governance = inject(GovernanceStore);
  private readonly compliance = inject(ComplianceStore);
  private readonly schemes = inject(SchemeDataSource);
  private readonly auth = inject(MockAuthSession);
  private readonly respond = mockResponder();

  private allowed(r: ReportDef): boolean {
    return this.auth.can('Reports.View') && this.auth.can(r.permission) && this.auth.hasFeature(r.feature);
  }

  catalogue(): Observable<ReportDef[]> {
    return this.respond(REPORTS.filter((r) => this.allowed(r)));
  }

  run(id: ReportId, params: ReportParams): Observable<ReportResult | undefined> {
    const def = REPORTS.find((r) => r.id === id);
    if (!def || !this.allowed(def)) return this.respond(undefined);
    const ids = new Set(params.schemeIds);
    const months = def.period ? (params.months ?? 3) : undefined;
    const since = months ? new Date(Date.now() - months * 30 * DAY).toISOString() : '';
    const scope = `${ids.size} scheme${ids.size === 1 ? '' : 's'}${months ? ` · last ${months} month${months === 1 ? '' : 's'}` : ''}`;
    const result = (body: Pick<ReportResult, 'columns' | 'rows' | 'notes'> & Partial<ReportResult>): ReportResult => ({
      def,
      generatedAt: new Date().toISOString(),
      scope,
      totals: totalsOf(body.columns, body.rows),
      ...body,
    });
    const schemes = [...this.db.schemes.values()].filter((s) => ids.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));

    if (id === 'scheme-health') {
      return this.db.changes$.pipe(
        switchMap(() => this.schemes.health()),
        map((health) => {
          const byId = new Map(health.map((h) => [h.schemeId, h]));
          const rows = schemes.filter((s) => byId.has(s.id)).map((s) => {
            const h = byId.get(s.id)!;
            return { scheme: s.name, rating: { good: 'Healthy', watch: 'Watch', 'at-risk': 'At risk' }[h.rating], collected: h.collectionRate, arrears: h.arrears, ninety: h.accounts90Plus, open: h.openJobs, overdue: h.overdueJobs, compliance: COMPLIANCE_STATUS_LABELS[h.compliance], meeting: h.nextMeeting?.at ?? null };
          });
          return result({
            columns: [col('scheme', 'Scheme'), col('rating', 'Health'), col('collected', 'Collected', 'percent'), col('arrears', 'Arrears', 'money', true), col('ninety', '90+ days', 'number', true), col('open', 'Open jobs', 'number', true), col('overdue', 'Overdue jobs', 'number', true), col('compliance', 'Compliance'), col('meeting', 'Next meeting', 'date')],
            rows,
            links: schemes.filter((s) => byId.has(s.id)).map((s) => `/schemes/${s.id}/overview`),
            notes: ['Collected ≈ 1 − unpaid from the last 3 months ÷ 3 months’ charges.', 'Ratings: at risk when compliance is overdue or collections are under 85%; watch when anything is slipping.'],
          });
        }),
      );
    }
    return this.db.changes$.pipe(switchMap(() => this.respond(this.build(id, schemes, ids, since, result))));
  }

  private build(id: ReportId, schemes: ReturnType<MockDb['scheme']>[], ids: Set<string>, since: string, result: (b: Pick<ReportResult, 'columns' | 'rows' | 'notes'> & Partial<ReportResult>) => ReportResult): ReportResult | undefined {
    const accounts = [...this.db.accounts.values()].filter((a) => ids.has(a.schemeId));
    switch (id) {
      case 'levy-roll': {
        const rows = schemes.map((s) => {
          const units = this.db.units.filter((u) => u.schemeId === s.id);
          const roll = units.reduce((n, u) => n + u.monthlyLevy, 0);
          return { scheme: s.name, type: s.type, units: units.length, roll, average: units.length ? Math.round(roll / units.length) : 0, annual: roll * 12 };
        });
        return result({ columns: [col('scheme', 'Scheme'), col('type', 'Type'), col('units', 'Units', 'number', true), col('roll', 'Monthly levies', 'money', true), col('average', 'Average per unit', 'money'), col('annual', 'Annual', 'money', true)], rows, links: schemes.map((s) => `/schemes/${s.id}/overview`), notes: ['Ordinary levies only; special levies and utilities are billed separately.'] });
      }
      case 'billing-summary': {
        const runs = this.billing.runs.filter((r) => ids.has(r.schemeId) && (r.createdAt >= since || r.posted?.at && r.posted.at >= since)).sort((a, b) => b.period.localeCompare(a.period));
        const rows = runs.map((r) => {
          const s = this.billing.summary(r);
          return { run: r.ref, scheme: s.scheme.name, period: r.period, stage: { preview: 'Preparing', 'awaiting-approval': 'Awaiting approval', approved: 'Approved', posted: 'Posted', sent: 'Statements sent', cancelled: 'Cancelled' }[r.stage], accounts: s.accounts, total: r.stage === 'cancelled' ? 0 : s.total, posted: r.posted?.at ?? null };
        });
        return result({ columns: [col('run', 'Run'), col('scheme', 'Scheme'), col('period', 'Period'), col('stage', 'Stage'), col('accounts', 'Accounts', 'number'), col('total', 'Total', 'money', true), col('posted', 'Posted', 'date')], rows, links: runs.map((r) => `/finance/billing/${r.id}`), notes: ['Cancelled runs show a total of R 0: nothing was posted.'] });
      }
      case 'receipts': {
        const rows = schemes.map((s) => {
          const rs = this.db.receipts.filter((r) => r.schemeId === s.id && r.date >= since);
          const sum = (st?: string) => rs.filter((r) => !st || r.status === st).reduce((n, r) => n + r.amount, 0);
          return { scheme: s.name, count: rs.length, total: sum(), allocated: sum('allocated'), unallocated: sum('unallocated'), suspense: sum('suspense') };
        }).filter((r) => r.count);
        return result({ columns: [col('scheme', 'Scheme'), col('count', 'Payments', 'number', true), col('total', 'Received', 'money', true), col('allocated', 'Allocated', 'money', true), col('unallocated', 'To allocate', 'money', true), col('suspense', 'Suspense', 'money', true)], rows, notes: ['From the trust accounts’ bank imports.'] });
      }
      case 'supplier-payments': {
        const paid = this.maintenance.invoices.filter((i) => ids.has(i.schemeId) && i.status === 'paid' && (i.paidAt ?? i.receivedAt) >= since);
        const bySupplier = new Map<string, { supplier: string; schemes: Set<string>; count: number; total: number }>();
        for (const i of paid) {
          const s = this.maintenance.supplier(i.supplierId);
          const g = bySupplier.get(i.supplierId) ?? { supplier: s?.name ?? i.supplierId, schemes: new Set<string>(), count: 0, total: 0 };
          g.schemes.add(this.db.scheme(i.schemeId).code);
          g.count++;
          g.total += i.amount;
          bySupplier.set(i.supplierId, g);
        }
        const entries = [...bySupplier.entries()].sort((a, b) => b[1].total - a[1].total);
        return result({
          columns: [col('supplier', 'Supplier'), col('schemes', 'Schemes'), col('count', 'Invoices', 'number', true), col('total', 'Paid', 'money', true)],
          rows: entries.map(([, g]) => ({ supplier: g.supplier, schemes: [...g.schemes].join(', '), count: g.count, total: Math.round(g.total * 100) / 100 })),
          links: entries.map(([id]) => `/suppliers/${id}`),
          notes: ['Released payment batches only.'],
        });
      }
      case 'age-analysis': {
        const rows = schemes.map((s) => {
          const a = accounts.filter((x) => x.schemeId === s.id);
          const sum = (k: 'current' | 'd30' | 'd60' | 'd90' | 'd120') => Math.round(a.reduce((n, x) => n + x.ageing[k], 0) * 100) / 100;
          return { scheme: s.name, current: sum('current'), d30: sum('d30'), d60: sum('d60'), d90: sum('d90'), d120: sum('d120'), total: Math.round(a.reduce((n, x) => n + Math.max(0, x.balance), 0) * 100) / 100 };
        });
        return result({ columns: [col('scheme', 'Scheme'), col('current', 'Current', 'money', true), col('d30', AGEING_LABELS.d30, 'money', true), col('d60', AGEING_LABELS.d60, 'money', true), col('d90', AGEING_LABELS.d90, 'money', true), col('d120', AGEING_LABELS.d120, 'money', true), col('total', 'Owed', 'money', true)], rows, notes: ['Ageing as at today. The prototype ages balances by month; the API ages the actual transactions.'] });
      }
      case 'debtors': {
        const views = this.collections.list([...ids]).sort((a, b) => b.overdueAmount - a.overdueAmount);
        return result({
          columns: [col('account', 'Account'), col('unit', 'Unit'), col('holder', 'Owner'), col('scheme', 'Scheme'), col('overdue', 'Overdue', 'money', true), col('days', 'Days', 'number'), col('stage', 'Stage'), col('phone', 'Phone')],
          rows: views.map((v) => ({ account: v.account.accountNo, unit: v.unit.number, holder: v.holder.displayName, scheme: v.scheme.name, overdue: v.overdueAmount, days: v.daysInArrears, stage: COLLECTION_STAGE_LABELS[v.case.stage], phone: v.holder.phone })),
          links: views.map((v) => `/finance/credit-control/${v.account.id}`),
          notes: ['Contains personal information: export only what you need, and keep it safe.'],
        });
      }
      case 'collections': {
        const views = this.collections.list([...ids]);
        const stages = ['not-started', 'reminder', 'final-demand', 'letter-of-demand', 'handed-over', 'arrangement', 'disputed'] as const;
        const rows = schemes.map((s) => {
          const v = views.filter((x) => x.scheme.id === s.id);
          return { scheme: s.name, ...Object.fromEntries(stages.map((st) => [st, v.filter((x) => x.case.stage === st).length])), overdue: Math.round(v.reduce((n, x) => n + x.overdueAmount, 0) * 100) / 100 };
        }).filter((r) => (r.overdue as number) > 0);
        return result({ columns: [col('scheme', 'Scheme'), ...stages.map((st) => col(st, COLLECTION_STAGE_LABELS[st].replace(' sent', ''), 'number', true)), col('overdue', 'Overdue', 'money', true)], rows, notes: [] });
      }
      case 'jobs-by-stage': {
        const open = this.maintenance.jobs.filter((j) => ids.has(j.schemeId) && !['closed', 'cancelled'].includes(j.stage));
        const stages = JOB_STAGES.filter((s) => !['closed', 'cancelled'].includes(s.id));
        const rows = schemes.map((s) => {
          const js = open.filter((j) => j.schemeId === s.id);
          const overdue = js.filter((j) => !!j.dueAt && new Date(j.dueAt).getTime() < Date.now() && ['quoting', 'scheduled', 'in-progress'].includes(j.stage)).length;
          return { scheme: s.name, ...Object.fromEntries(stages.map((st) => [st.id, js.filter((j) => j.stage === st.id).length])), total: js.length, overdue };
        }).filter((r) => r.total);
        return result({ columns: [col('scheme', 'Scheme'), ...stages.map((st) => col(st.id, st.short, 'number', true)), col('total', 'Open', 'number', true), col('overdue', 'Overdue', 'number', true)], rows, notes: ['Overdue: past the stage’s due date while quoting, scheduled or in progress.'] });
      }
      case 'supplier-performance': {
        const sups = this.maintenance.suppliers.filter((s) => s.schemeIds.some((x) => ids.has(x)) && s.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name));
        return result({
          columns: [col('supplier', 'Supplier'), col('trades', 'Trades'), col('jobs', 'Jobs done', 'number', true), col('onTime', 'On time', 'percent'), col('variance', 'Invoice vs quote', 'percent'), col('verified', 'Fixed first time', 'percent'), col('spend', 'Spend (12 months)', 'money', true)],
          rows: sups.map((s) => ({ supplier: s.name, trades: s.trades.join(', '), jobs: s.performance.jobsCompleted, onTime: s.performance.onTimeRate, variance: s.performance.avgVariance, verified: s.performance.verifiedRate, spend: this.maintenance.supplierSummary(s).spend12m })),
          links: sups.map((s) => `/suppliers/${s.id}`),
          notes: ['With this agency only. Humo-wide reputation is on each supplier’s page.'],
        });
      }
      case 'resolutions': {
        const views = this.governance.resolutions.filter((r) => ids.has(r.schemeId)).map((r) => this.governance.view(r)).sort((a, b) => b.resolution.ref.localeCompare(a.resolution.ref));
        return result({
          columns: [col('ref', 'Ref'), col('title', 'Resolution'), col('scheme', 'Scheme'), col('outcome', 'Outcome'), col('actions', 'Actions done'), col('progress', 'Progress')],
          rows: views.map((v) => ({
            ref: v.resolution.ref,
            title: v.resolution.title,
            scheme: v.scheme.name,
            outcome: ({ passed: 'Passed', 'not-passed': 'Not passed', withdrawn: 'Withdrawn' } as Record<string, string>)[v.resolution.outcome ?? ''] ?? 'Awaiting trustees',
            actions: v.actions.length ? `${v.actions.filter((a) => a.status === 'done').length} of ${v.actions.length}` : '—',
            progress: RESOLUTION_PROGRESS_LABELS[v.progress],
          })),
          links: views.map((v) => (v.meeting ? `/governance/meetings/${v.meeting.id}` : '/governance/resolutions')),
          notes: [],
        });
      }
      case 'compliance-status': {
        const items = this.compliance.items([...ids]);
        const rows = schemes.map((s) => ({
          scheme: s.name,
          ...Object.fromEntries(COMPLIANCE_TYPES.map((t) => [t.id, COMPLIANCE_STATUS_LABELS[items.find((i) => i.schemeId === s.id && i.type === t.id)?.status ?? 'not-applicable']])),
          due: items.filter((i) => i.schemeId === s.id && (i.status === 'overdue' || i.status === 'due-soon')).length,
        }));
        return result({ columns: [col('scheme', 'Scheme'), ...COMPLIANCE_TYPES.map((t) => col(t.id, t.short)), col('due', 'Due or overdue', 'number', true)], rows, links: schemes.map((s) => `/schemes/${s.id}/compliance`), notes: ['Humo tracks deadlines from your records; it makes no claim of legal sufficiency.'] });
      }
      case 'occupancy': {
        const rows = schemes.map((s) => {
          const units = this.db.units.filter((u) => u.schemeId === s.id);
          const count = (o: string) => units.filter((u) => u.occupancy === o).length;
          return { scheme: s.name, units: units.length, owner: count('owner-occupied'), tenanted: count('tenanted'), vacant: count('vacant'), arrears: accounts.filter((a) => a.schemeId === s.id && overdueOf(a.ageing) > 0).length };
        });
        return result({ columns: [col('scheme', 'Scheme'), col('units', 'Units', 'number', true), col('owner', 'Owner-occupied', 'number', true), col('tenanted', 'Tenanted', 'number', true), col('vacant', 'Vacant', 'number', true), col('arrears', 'In arrears', 'number', true)], rows, links: schemes.map((s) => `/schemes/${s.id}/units`), notes: [] });
      }
      default:
        return undefined;
    }
  }
}

function totalsOf(columns: ReportColumn[], rows: Record<string, ReportCell>[]): Record<string, ReportCell> | undefined {
  if (!columns.some((c) => c.total) || !rows.length) return undefined;
  const t: Record<string, ReportCell> = { [columns[0].key]: 'Total' };
  for (const c of columns.filter((x) => x.total)) t[c.key] = Math.round(rows.reduce((n, r) => n + (Number(r[c.key]) || 0), 0) * 100) / 100;
  return t;
}
