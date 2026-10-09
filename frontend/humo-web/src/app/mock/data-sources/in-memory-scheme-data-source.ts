import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { ChangeEvent, FieldErrors, SCHEME_STATUS_LABELS, Scheme, SchemeDataSource, SchemeDetails, SchemeHealth, SchemeStatus, overdueOf, rateHealth, worstStatus } from '../../domain';
import { AccessStore } from '../db/access-store';
import { MockDb } from '../db/mock-db';
import { BillingStore } from '../db/billing-store';
import { CollectionsStore } from '../db/collections-store';
import { ComplianceStore } from '../db/compliance-store';
import { LibraryStore } from '../db/library-store';
import { formatRand } from '../../ui/format/money';
import { MaintenanceStore } from '../db/maintenance-store';
import { GovernanceStore } from '../db/governance-store';
import { portfolioManagerOf } from '../fixtures/staff';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

const TYPES: Scheme['type'][] = ['Sectional Title', 'Home Owners Association', 'Share Block'];
const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];

/** The lifecycle moves the API allows. */
const ALLOWED: Record<SchemeStatus, SchemeStatus[]> = {
  prospect: ['onboarding', 'archived'],
  onboarding: ['active', 'archived'],
  active: ['closed'],
  closed: ['active', 'archived'],
  archived: ['closed'],
};

@Injectable()
export class InMemorySchemeDataSource extends SchemeDataSource {
  private readonly respond = mockResponder();
  private readonly access = inject(AccessStore);
  private readonly db = inject(MockDb);
  private readonly governance = inject(GovernanceStore);
  private readonly maintenance = inject(MaintenanceStore);
  private readonly compliance = inject(ComplianceStore);
  private readonly library = inject(LibraryStore);
  private readonly billing = inject(BillingStore);
  private readonly collections = inject(CollectionsStore);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);

  /** The server joins the manager in from role assignments. */
  private withManager(s: Scheme): Scheme {
    return { ...s, portfolioManager: portfolioManagerOf(s.id, this.access.identities()) };
  }

  /** Live: new, edited and archived schemes show up everywhere straight away. */
  list(): Observable<Scheme[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond([...this.db.schemes.values()].map((s) => this.withManager(s)))));
  }

  get(id: string): Observable<Scheme | undefined> {
    const s = this.db.schemes.get(id);
    return this.respond(s ? this.withManager(s) : undefined);
  }

  private nextMeeting(schemeId: string): SchemeHealth['nextMeeting'] {
    const next = this.governance.meetings
      .filter((m) => m.schemeId === schemeId)
      .filter((m) => ['draft', 'notice-sent', 'pack-ready'].includes(m.stage) && new Date(m.scheduledFor).getTime() > Date.now())
      .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))[0];
    return next ? { type: next.type === 'trustee' ? 'Trustee meeting' : next.type === 'agm' ? 'AGM' : 'SGM', at: next.scheduledFor } : undefined;
  }

  /**
   * Each scheme's vital signs, worked out from the live records the API holds:
   * - arrears and 90+ day accounts from the levy accounts' ageing;
   * - collections ≈ 1 − (unpaid from the last 3 months ÷ 3 months' charges) — the API will use actual billed vs received;
   * - open and overdue jobs from Maintenance; compliance from the generated items (supplier documents at most "due soon"); the next meeting from Governance.
   */
  health(): Observable<SchemeHealth[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond([...this.db.schemes.values()].map((s) => this.healthOf(s.id)))));
  }

  changes(schemeIds: string[], since: string): Observable<ChangeEvent[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.changesSince(new Set(schemeIds), since))));
  }

  /** Everything with a timestamp after `since`, from every module. The API will serve this from its event log. */
  private changesSince(ids: Set<string>, since: string): ChangeEvent[] {
    const now = new Date().toISOString();
    const inWindow = (at?: string) => !!at && at >= since && at <= now;
    const out: ChangeEvent[] = [];

    for (const w of this.db.workItems) {
      if (ids.has(w.schemeId) && w.kind === 'approval' && w.status === 'open' && inWindow(w.createdAt)) {
        out.push({ id: `a-${w.id}`, at: w.createdAt, kind: 'approval', title: `New approval: ${w.title}`, detail: w.amount ? formatRand(w.amount) : w.detail, schemeId: w.schemeId, route: '/approvals', tone: 'attention' });
      }
    }
    for (const j of this.maintenance.jobs.filter((x) => ids.has(x.schemeId))) {
      if (inWindow(j.reportedAt)) {
        out.push({ id: `r-${j.id}`, at: j.reportedAt, kind: 'request', title: `New request: ${j.title}`, detail: `${j.location} · reported by ${j.reportedBy.name}`, schemeId: j.schemeId, route: `/maintenance/${j.ref}`, tone: j.priority === 'urgent' ? 'attention' : 'info' });
      }
      for (const q of j.quotes.filter((x) => inWindow(x.receivedAt))) {
        out.push({ id: `q-${q.id}`, at: q.receivedAt!, kind: 'quote', title: `Quote received: ${this.maintenance.supplier(q.supplierId)?.name ?? 'supplier'}`, detail: `${formatRand(q.amount)} for ${j.ref} · ${j.title}`, schemeId: j.schemeId, route: `/maintenance/${j.ref}`, tone: 'info' });
      }
    }
    const receipts = new Map<string, { n: number; total: number; unallocated: number; at: string }>();
    for (const r of this.db.receipts.filter((x) => ids.has(x.schemeId) && inWindow(x.date))) {
      const g = receipts.get(r.schemeId) ?? { n: 0, total: 0, unallocated: 0, at: r.date };
      g.n++;
      g.total += r.amount;
      if (r.status === 'unallocated') g.unallocated++;
      if (r.date > g.at) g.at = r.date;
      receipts.set(r.schemeId, g);
    }
    for (const [schemeId, g] of receipts) {
      out.push({ id: `p-${schemeId}`, at: g.at, kind: 'payments', title: `${g.n} payment${g.n === 1 ? '' : 's'} received`, detail: `${formatRand(g.total)}${g.unallocated ? ` · ${g.unallocated} to allocate` : ' · all allocated'}`, schemeId, route: '/finance/receipts', tone: g.unallocated ? 'attention' : 'info' });
    }
    for (const i of this.compliance.items([...ids])) {
      if (i.status === 'overdue' && inWindow(i.dueAt)) {
        out.push({ id: `c-${i.id}`, at: i.dueAt!, kind: 'compliance', title: `Now overdue: ${i.title}`, detail: i.detail, schemeId: i.schemeId, route: `/compliance/${i.id}`, tone: 'attention' });
      } else if (i.status === 'due-soon' && i.dueAt) {
        const turned = new Date(new Date(i.dueAt).getTime() - 30 * 86_400_000).toISOString();
        if (inWindow(turned)) out.push({ id: `c-${i.id}`, at: turned, kind: 'compliance', title: `Due within 30 days: ${i.title}`, detail: i.detail, schemeId: i.schemeId, route: `/compliance/${i.id}`, tone: 'info' });
      }
    }
    for (const d of this.library.documents.filter((x) => !x.archived && x.schemeIds.some((s) => ids.has(s)) && inWindow(x.uploadedAt))) {
      out.push({ id: `d-${d.id}`, at: d.uploadedAt, kind: 'document', title: `Uploaded: ${d.title}`, detail: `${d.links[0]?.label ?? ''} · ${d.uploadedBy}`, schemeId: d.schemeIds.find((s) => ids.has(s))!, route: `/documents/${d.id}`, tone: 'info' });
    }
    for (const m of this.governance.meetings.filter((x) => ids.has(x.schemeId))) {
      if (inWindow(m.notice?.sentAt)) out.push({ id: `n-${m.id}`, at: m.notice!.sentAt, kind: 'meeting', title: `Notice sent: ${m.title}`, detail: `${m.notice!.recipients} recipients`, schemeId: m.schemeId, route: `/governance/meetings/${m.id}`, tone: 'info' });
      if (inWindow(m.minutes?.approvedAt)) out.push({ id: `mn-${m.id}`, at: m.minutes!.approvedAt!, kind: 'meeting', title: `Minutes approved: ${m.title}`, detail: m.minutes!.approvedBy ?? '', schemeId: m.schemeId, route: `/governance/meetings/${m.id}`, tone: 'info' });
    }
    for (const r of this.billing.runs.filter((x) => ids.has(x.schemeId))) {
      if (inWindow(r.posted?.at)) out.push({ id: `bp-${r.id}`, at: r.posted!.at, kind: 'billing', title: `Billing posted: ${r.ref}`, detail: `${formatRand(r.posted!.total)} to ${r.posted!.accounts} accounts`, schemeId: r.schemeId, route: `/finance/billing/${r.id}`, tone: 'info' });
    }
    for (const v of this.collections.list([...ids])) {
      const n = v.next;
      if (n?.overdue && inWindow(n.dueAt) && v.case.stage !== 'not-started') {
        out.push({ id: `cc-${v.account.id}`, at: n.dueAt, kind: 'collection', title: `Collection step due: ${v.account.accountNo}`, detail: `${n.label} · ${formatRand(v.overdueAmount)} overdue`, schemeId: v.scheme.id, route: `/finance/credit-control/${v.account.id}`, tone: 'attention' });
      }
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }

  private healthOf(schemeId: string): SchemeHealth {
    const accounts = [...this.db.accounts.values()].filter((a) => a.schemeId === schemeId);
    const units = this.db.units.filter((u) => u.schemeId === schemeId);
    const monthlyLevyRoll = units.reduce((n, u) => n + u.monthlyLevy, 0);
    const recentUnpaid = accounts.reduce((n, a) => n + a.ageing.d30 + a.ageing.d60 + a.ageing.d90, 0);
    const billed3m = 3 * accounts.reduce((n, a) => n + Math.max(a.ageing.current, this.db.unitById.get(a.unitId)?.monthlyLevy ?? 0), 0);
    const collectionRate = billed3m ? Math.max(0, Math.round((1 - recentUnpaid / billed3m) * 1000) / 10) : 100;
    const jobs = this.maintenance.jobs.filter((j) => j.schemeId === schemeId && !['closed', 'cancelled'].includes(j.stage));
    const overdueJobs = jobs.filter((j) => !!j.dueAt && new Date(j.dueAt).getTime() < Date.now() && ['quoting', 'scheduled', 'in-progress'].includes(j.stage)).length;
    const items = this.compliance.items([schemeId]);
    const open = items.filter((i) => i.status === 'overdue' || i.status === 'due-soon');
    const h: Omit<SchemeHealth, 'rating'> = {
      schemeId,
      collectionRate,
      arrears: Math.round(accounts.reduce((n, a) => n + overdueOf(a.ageing), 0) * 100) / 100,
      accounts90Plus: accounts.filter((a) => a.ageing.d90 + a.ageing.d120 > 0).length,
      monthlyLevyRoll,
      openJobs: jobs.length,
      overdueJobs,
      // A supplier's lapsed certificate is the supplier's to fix (it has its own Task): it makes a scheme "watch", not "at risk".
      compliance: items.length ? worstStatus(items.map((i) => (i.type === 'supplier-documents' && i.status === 'overdue' ? 'due-soon' : i.status))) : 'not-applicable',
      complianceOpenItems: open.length,
      nextMeeting: this.nextMeeting(schemeId),
    };
    return { ...h, rating: rateHealth(h) };
  }

  create(details: SchemeDetails): Observable<string> {
    const organisationId = this.auth.current.organisation?.id ?? '';
    return this.gateway.command(
      {
        action: `Added scheme ${details.name}`,
        resource: 'Scheme',
        permission: 'Schemes.Manage',
        feature: 'schemes',
        validate: () => this.check(details, null),
      },
      () => {
        const base = details.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        let id = base;
        for (let n = 2; this.db.schemes.has(id); n++) id = `${base}-${n}`;
        this.db.addScheme({ id, version: 1, organisationId, status: 'onboarding', unitCount: 0, portfolioManager: null, ...this.clean(details) });
        return id;
      },
    );
  }

  update(id: string, details: SchemeDetails, expectedVersion?: number): Observable<void> {
    const s = this.db.schemes.get(id);
    return this.gateway
      .command(
        {
          action: `Updated scheme details for ${details.name}`,
          resource: 'Scheme',
          resourceId: id,
          schemeId: id,
          permission: 'Schemes.Manage',
          version: { expected: expectedVersion, current: s?.version },
          validate: () => this.check(details, id),
        },
        () => this.db.changeScheme(id, (x) => ({ ...x, ...this.clean(details) })),
      )
      .pipe(map(() => undefined));
  }

  setStatus(id: string, status: SchemeStatus, reason: string, expectedVersion?: number): Observable<void> {
    const s = this.db.schemes.get(id);
    return this.gateway
      .command(
        {
          action: `${s?.name ?? id}: ${SCHEME_STATUS_LABELS[s?.status ?? 'active']} → ${SCHEME_STATUS_LABELS[status]} — ${reason}`,
          resource: 'Scheme',
          resourceId: id,
          schemeId: id,
          permission: 'Schemes.Manage',
          version: { expected: expectedVersion, current: s?.version },
          validate: (): FieldErrors | null => {
            if (!s) return { status: 'That scheme no longer exists.' };
            if (!ALLOWED[s.status].includes(status)) return { status: `A ${s.status} scheme can’t be moved to ${status}.` };
            if (status === 'archived' && s.status !== 'archived' && this.db.unitsIn([id]).some((u) => u.account.balance > 0)) {
              return { status: 'Some accounts still owe money. Settle or hand them over before archiving.' };
            }
            return reason.trim().length < 5 ? { reason: 'Say why, in a few words. It goes in the audit log.' } : null;
          },
        },
        () => this.db.changeScheme(id, (x) => ({ ...x, status })),
      )
      .pipe(map(() => undefined));
  }

  private clean(d: SchemeDetails): SchemeDetails {
    return { name: d.name.trim(), code: d.code.trim().toUpperCase(), type: d.type, suburb: d.suburb.trim(), city: d.city.trim(), province: d.province };
  }

  private check(d: SchemeDetails, id: string | null): FieldErrors {
    const e: FieldErrors = {};
    const code = d.code.trim().toUpperCase();
    const orgId = id ? this.db.schemes.get(id)?.organisationId : this.auth.current.organisation?.id;
    if (d.name.trim().length < 3) e['name'] = 'Enter the scheme’s name.';
    if (!/^[A-Z]{2,4}$/.test(code)) e['code'] = 'Use 2–4 letters, e.g. KC. It starts every account number.';
    else if ([...this.db.schemes.values()].some((s) => s.id !== id && s.organisationId === orgId && s.code === code)) e['code'] = 'Another scheme already uses this code.';
    if (!TYPES.includes(d.type)) e['type'] = 'Choose the type of scheme.';
    if (d.suburb.trim().length < 2) e['suburb'] = 'Enter the suburb.';
    if (d.city.trim().length < 2) e['city'] = 'Enter the city.';
    if (!PROVINCES.includes(d.province)) e['province'] = 'Choose the province.';
    return e;
  }
}
