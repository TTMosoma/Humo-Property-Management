import { Injectable, inject } from '@angular/core';
import {
  COMPLIANCE_TYPES,
  ComplianceAction,
  ComplianceDetail,
  ComplianceItem,
  ComplianceProfile,
  ComplianceRecord,
  ComplianceStatus,
  ComplianceType,
  DUE_SOON_DAYS,
  FieldErrors,
  LibraryDocument,
  ManualComplianceItem,
  NewManualCompliance,
  Scheme,
  Supplier,
  SupplierDocType,
  WorkItem,
  docStatus,
  financialYearLabel,
} from '../../domain';
import { formatDate } from '../../ui/format/money';
import { portfolioManagerOf } from '../fixtures/staff';
import { simulationStorage } from '../simulation/simulation-storage';
import { GovernanceStore } from './governance-store';
import { LibraryStore } from './library-store';
import { MaintenanceStore } from './maintenance-store';
import { MockDb } from './mock-db';
import { seeded } from './random';
import { SettingsStore } from './settings-store';
import { LIFT_SCHEMES } from './seed-library';

/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface ComplianceSnapshot {
  profiles: ComplianceProfile[];
  records: ComplianceRecord[];
  manual: ManualComplianceItem[];
  seq: number;
}

const DAY = 86_400_000;
const SUFFIX: Record<ComplianceType, string> = {
  agm: 'AGM',
  'financial-statements': 'AFS',
  'csos-return': 'CSOS',
  'building-insurance': 'INS',
  'fire-equipment': 'FIRE',
  'lift-inspection': 'LIFT',
  'supplier-documents': 'SUP',
};
/** The compliance Tasks the fixtures used to hold keep their ids, so links and history agree. */
const FIXED_WORK_IDS: Record<string, string> = { 'CMP-JH-INS': 'w23', 'CMP-KC-AGM': 'w24', 'CMP-SLM-CSOS': 'w25', 'DOC-RAND-PLUMBING': 'w26', 'CMP-BDE-FIRE': 'w27' };
/** The documents that protect the scheme while a supplier works on site; the rest are the agency's admin. */
const SITE_WORK_DOCS: SupplierDocType[] = ['COIDA letter of good standing', 'Public liability insurance'];
/** Notice for an AGM: 14 days before it's held. */
const AGM_NOTICE_DAYS = 14;

/**
 * Compliance "backend" for the prototype. Items are WORKED OUT on every read
 * from the records other modules keep (meetings, documents, suppliers) plus
 * a few facts of its own: each scheme's financial year-end, whether it has
 * lifts, recorded submissions (CSOS, audited financials) and manual items.
 *
 * Items that are due soon or overdue get a compliance Task for the scheme's
 * portfolio manager; the Task closes when the item is complete.
 */
@Injectable({ providedIn: 'root' })
export class ComplianceStore {
  private readonly db = inject(MockDb);
  private readonly library = inject(LibraryStore);
  private readonly governance = inject(GovernanceStore);
  private readonly maintenance = inject(MaintenanceStore);
  private readonly settings = inject(SettingsStore);

  private profiles: ComplianceProfile[];
  private records: ComplianceRecord[];
  private manual: ManualComplianceItem[];
  private seq: number;
  private syncQueued = false;

  constructor() {
    const saved = simulationStorage.load<ComplianceSnapshot>('compliance');
    if (saved) {
      this.profiles = saved.profiles;
      this.records = saved.records;
      this.manual = saved.manual;
      this.seq = saved.seq;
    } else {
      this.seq = 100;
      this.profiles = this.seedProfiles();
      this.records = this.seedRecords();
      this.manual = this.seedManual();
      this.save();
    }
    // Any change anywhere (a document uploaded, an AGM notice sent) can change what's due.
    this.db.changes$.subscribe(() => this.queueSync());
  }

  // =================================================================== Reads

  profile(schemeId: string): ComplianceProfile {
    return this.profiles.find((p) => p.schemeId === schemeId) ?? { schemeId, financialYearEnd: 2, hasLifts: false };
  }

  items(schemeIds: string[]): ComplianceItem[] {
    const out: ComplianceItem[] = [];
    for (const id of schemeIds) {
      const scheme = this.db.schemes.get(id);
      if (!scheme || scheme.status === 'archived' || scheme.status === 'prospect') continue;
      out.push(...COMPLIANCE_TYPES.map((t) => this.generate(scheme, t.id)), ...this.manual.filter((m) => m.schemeId === id).map((m) => this.manualItem(scheme, m)));
    }
    const work = new Map(this.db.workItems.filter((w) => w.status === 'open' && (w.type === 'compliance-due' || w.type === 'document-expiry')).map((w) => [w.ref, w.id]));
    return out.map((i) => ({ ...i, workItemId: work.get(i.ref) }));
  }

  item(id: string): ComplianceItem | undefined {
    const m = this.manual.find((x) => x.id === id);
    if (m) return this.manualItem(this.db.scheme(m.schemeId), m);
    const [schemeId, type] = id.split('.') as [string, ComplianceType];
    const scheme = this.db.schemes.get(schemeId);
    return scheme && COMPLIANCE_TYPES.some((t) => t.id === type) ? this.items([schemeId]).find((i) => i.id === id) : undefined;
  }

  detail(id: string): ComplianceDetail | undefined {
    const item = this.item(id);
    if (!item) return undefined;
    const scheme = this.db.scheme(item.schemeId);
    let documents: LibraryDocument[] = [];
    if (item.type === 'supplier-documents') {
      const ids = new Set(this.suppliersOf(item.schemeId).map((s) => s.id));
      documents = this.library.documents.filter((d) => d.supplierDoc && d.links.some((l) => l.kind === 'supplier' && ids.has(l.id)));
    } else if (item.type !== 'manual') {
      documents = this.library.documents.filter((d) => d.compliance === item.type && d.schemeIds.includes(item.schemeId));
    }
    documents = [...documents].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    const history = this.records
      .filter((r) => r.schemeId === item.schemeId && r.type === item.type)
      .sort((a, b) => b.at.localeCompare(a.at))
      .map((r) => ({ label: `${financialYearLabel(Number(r.period.slice(0, 4)), Number(r.period.slice(5, 7)))}: ${r.reference}${r.note ? ` — ${r.note}` : ''}`, at: r.at, by: r.by }));
    return { item, scheme, profile: this.profile(item.schemeId), documents, history };
  }

  // =================================================================== Generation

  private generate(scheme: Scheme, type: ComplianceType): ComplianceItem {
    const base = { id: `${scheme.id}.${type}`, ref: `CMP-${scheme.code}-${SUFFIX[type]}`, schemeId: scheme.id, type, title: COMPLIANCE_TYPES.find((t) => t.id === type)!.label };
    switch (type) {
      case 'agm':
      case 'financial-statements':
      case 'csos-return':
        return { ...base, ...this.yearly(scheme, type) };
      case 'building-insurance':
      case 'fire-equipment':
      case 'lift-inspection':
        return { ...base, ...this.fromDocuments(scheme, type) };
      case 'supplier-documents':
        return { ...base, ...this.fromSuppliers(scheme) };
    }
  }

  /** The financial year whose obligations are current: the latest year-end on or before today, and its 4-month deadline. */
  private financialYear(schemeId: string, now = new Date()): { end: Date; deadline: Date; period: string; label: string } {
    const m = this.profile(schemeId).financialYearEnd;
    let end = new Date(now.getFullYear(), m, 0, 23, 59);
    if (end > now) end = new Date(now.getFullYear() - 1, m, 0, 23, 59);
    const months = this.settings.billing(this.db.scheme(schemeId).organisationId).agmMonths;
    const deadline = new Date(end.getFullYear(), end.getMonth() + 1 + months, 0, 23, 59);
    return { end, deadline, period: `${end.getFullYear()}-${String(m).padStart(2, '0')}`, label: financialYearLabel(end.getFullYear(), m) };
  }

  private yearly(scheme: Scheme, type: 'agm' | 'financial-statements' | 'csos-return'): Omit<ComplianceItem, 'id' | 'ref' | 'schemeId' | 'type' | 'title'> {
    const fy = this.financialYear(scheme.id);
    const record = this.records.find((r) => r.schemeId === scheme.id && r.type === type && r.period === fy.period);
    const fyText = `${fy.label} financial year (ended ${formatDate(fy.end.toISOString())})`;
    const source = { label: `Financial year-end ${formatDate(fy.end.toISOString()).replace(/ \d{4}$/, '')}`, route: `/compliance?scheme=${scheme.id}` };
    const common = { dueAt: fy.deadline.toISOString(), period: fy.label };

    if (record) {
      return { ...common, status: 'complete', detail: `Done for the ${fyText}.`, source, evidence: { label: record.reference, at: record.at, by: record.by } };
    }
    if (type === 'agm') {
      const agm = this.governance.meetings
        .filter((m) => m.schemeId === scheme.id && m.type === 'agm' && m.stage !== 'cancelled' && new Date(m.scheduledFor) > fy.end)
        .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))[0];
      const meetingSource = { label: 'Governance › Meetings', route: '/governance/meetings' };
      if (agm && agm.stage !== 'draft') {
        const held = ['held', 'minutes-draft', 'minutes-approved'].includes(agm.stage);
        return {
          ...common,
          status: 'complete',
          detail: held ? `AGM held ${formatDate(agm.scheduledFor)} for the ${fyText}.` : `AGM on ${formatDate(agm.scheduledFor)}; notice sent.`,
          source: meetingSource,
          evidence: { label: `${agm.ref} · ${agm.title}`, route: `/governance/meetings/${agm.id}`, at: agm.notice?.sentAt },
          next: { label: 'Open the AGM', action: 'open-meeting' },
        };
      }
      const noticeBy = new Date(fy.deadline.getTime() - AGM_NOTICE_DAYS * DAY);
      return {
        ...common,
        status: this.byDate(fy.deadline),
        detail: agm
          ? `AGM drafted for ${formatDate(agm.scheduledFor)}; notice not sent yet. Hold it by ${formatDate(fy.deadline.toISOString())}.`
          : `Hold the AGM for the ${fyText} by ${formatDate(fy.deadline.toISOString())}: send notice by ${formatDate(noticeBy.toISOString())}.`,
        source: meetingSource,
        next: agm ? { label: 'Open the AGM', action: 'open-meeting' } : { label: 'Schedule the AGM', action: 'schedule-agm' },
      };
    }
    if (type === 'financial-statements') {
      const doc = this.library.documents.find((d) => !d.archived && d.compliance === 'financial-statements' && d.schemeIds.includes(scheme.id) && new Date(d.uploadedAt) > fy.end);
      if (doc) {
        return { ...common, status: 'complete', detail: `Audited statements for the ${fyText} are on file.`, source, evidence: { label: doc.title, route: `/documents/${doc.id}`, at: doc.uploadedAt, by: doc.uploadedBy } };
      }
      return {
        ...common,
        status: this.byDate(fy.deadline),
        detail: `The auditor signs off the ${fyText} statements in time for the AGM, by ${formatDate(fy.deadline.toISOString())}.`,
        source,
        next: { label: 'Upload the signed statements', action: 'upload' },
      };
    }
    return {
      ...common,
      status: this.byDate(fy.deadline),
      detail: `Submit the CSOS return for the ${fyText} by ${formatDate(fy.deadline.toISOString())}.`,
      source,
      next: { label: 'Record the submission', action: 'record' },
    };
  }

  private fromDocuments(scheme: Scheme, type: 'building-insurance' | 'fire-equipment' | 'lift-inspection'): Omit<ComplianceItem, 'id' | 'ref' | 'schemeId' | 'type' | 'title'> {
    if (type === 'lift-inspection' && !this.profile(scheme.id).hasLifts) {
      return { status: 'not-applicable', detail: 'No lifts at this scheme.', source: { label: 'Scheme profile' } };
    }
    const what = { 'building-insurance': 'policy', 'fire-equipment': 'service certificate', 'lift-inspection': 'inspection certificate' }[type];
    const doc = this.library.documents
      .filter((d) => !d.archived && d.compliance === type && d.schemeIds.includes(scheme.id))
      .sort((a, b) => (b.expiresAt ?? '').localeCompare(a.expiresAt ?? ''))[0];
    const source = { label: 'Documents', route: `/documents?scheme=${scheme.id}&category=${type === 'building-insurance' ? 'insurance' : 'certificate'}` };
    const upload = { label: `Upload the new ${what}`, action: 'upload' as const };
    if (!doc || !doc.expiresAt) return { status: 'overdue', detail: `No current ${what} on file.`, source, next: upload };
    const expires = new Date(doc.expiresAt);
    const status = this.byDate(expires);
    const when = formatDate(doc.expiresAt);
    return {
      status: status === 'upcoming' ? 'complete' : status,
      dueAt: doc.expiresAt,
      detail: status === 'overdue' ? `The ${what} expired on ${when}.` : status === 'due-soon' ? `The ${what} expires on ${when}: renew it.` : `Current until ${when}.`,
      source,
      evidence: { label: doc.title, route: `/documents/${doc.id}`, at: doc.uploadedAt, by: doc.uploadedBy },
      next: status === 'upcoming' ? undefined : upload,
    };
  }

  /** The suppliers that worked at the scheme in the last 12 months, or have work there now. */
  private suppliersOf(schemeId: string) {
    const since = Date.now() - 365 * DAY;
    const ids = new Set(
      this.maintenance.jobs.filter((j) => j.schemeId === schemeId && j.supplierId && (new Date(j.reportedAt).getTime() > since || !['paid', 'closed', 'cancelled'].includes(j.stage))).map((j) => j.supplierId!),
    );
    return this.maintenance.suppliers.filter((s) => ids.has(s.id) && s.status !== 'archived');
  }

  private fromSuppliers(scheme: Scheme): Omit<ComplianceItem, 'id' | 'ref' | 'schemeId' | 'type' | 'title'> {
    const suppliers = this.suppliersOf(scheme.id);
    const problems = suppliers.flatMap((s) =>
      s.documents
        .filter((d) => SITE_WORK_DOCS.includes(d.type))
        .map((d) => ({ s, d, st: docStatus(d) }))
        .filter((x) => x.st === 'expired' || x.st === 'missing' || x.st === 'expiring'),
    );
    const source = { label: 'Suppliers’ vetting documents', route: '/suppliers' };
    if (!suppliers.length) return { status: 'complete', detail: 'No suppliers have worked here in the last 12 months.', source };
    if (!problems.length) return { status: 'complete', detail: `All ${suppliers.length} supplier${suppliers.length === 1 ? '' : 's'} used here have a current COIDA letter and liability insurance.`, source };
    const worst = problems.some((p) => p.st !== 'expiring') ? 'overdue' : 'due-soon';
    const dates = problems.map((p) => p.d.expires).filter((x): x is string => !!x).sort();
    const first = problems.sort((a, b) => (a.st === 'expiring' ? 1 : 0) - (b.st === 'expiring' ? 1 : 0))[0];
    return {
      status: worst,
      dueAt: dates[0],
      detail: problems
        .map((p) => `${p.s.name}: ${p.d.type} ${p.st === 'missing' ? 'missing' : p.st === 'expired' ? `expired ${formatDate(p.d.expires!)}` : `expires ${formatDate(p.d.expires!)}`}`)
        .join('; '),
      source: { label: first.s.name, route: `/suppliers/${first.s.id}` },
      next: { label: `Get ${first.s.name}’s new ${first.d.type}`, action: 'open-suppliers' },
    };
  }

  private manualItem(scheme: Scheme, m: ManualComplianceItem): ComplianceItem {
    return {
      id: m.id,
      ref: `CMP-${scheme.code}-${m.id.split('-').at(-1)}`,
      schemeId: scheme.id,
      type: 'manual',
      title: m.title,
      detail: m.completed ? `Done: ${m.completed.note}` : m.notes ?? `Due ${formatDate(m.dueAt)}.`,
      status: m.completed ? 'complete' : this.byDate(new Date(m.dueAt)),
      dueAt: m.dueAt,
      source: { label: `Added by ${m.createdBy}` },
      evidence: m.completed ? { label: m.completed.note, at: m.completed.at, by: m.completed.by } : undefined,
      next: m.completed ? undefined : { label: 'Mark as done', action: 'complete-manual' },
      manual: true,
      version: m.version,
    };
  }

  private byDate(due: Date): ComplianceStatus {
    const days = (due.getTime() - Date.now()) / DAY;
    return days < 0 ? 'overdue' : days <= DUE_SOON_DAYS ? 'due-soon' : 'upcoming';
  }

  // =================================================================== Commands

  check(id: string, action: ComplianceAction): FieldErrors | null {
    const item = this.item(id);
    if (!item) return { id: 'This compliance item no longer exists.' };
    const e: FieldErrors = {};
    if (item.status === 'complete') e['id'] = 'It’s already complete.';
    if (action.type === 'record') {
      if (!['agm', 'financial-statements', 'csos-return'].includes(item.type)) e['id'] = 'This item completes from its source record, not by recording it.';
      if (action.reference.trim().length < 3) e['reference'] = 'Give the reference: a CSOS submission number, the auditor’s report date, or where the minutes are.';
    } else {
      if (!item.manual) e['id'] = 'Only items you added can be marked as done.';
      if (action.note.trim().length < 3) e['note'] = 'Say how it was done.';
    }
    return Object.keys(e).length ? e : null;
  }

  act(id: string, action: ComplianceAction, by: string): void {
    const item = this.item(id)!;
    const at = new Date().toISOString();
    if (action.type === 'record') {
      const fy = this.financialYear(item.schemeId);
      this.records.push({ id: `cr-${++this.seq}`, schemeId: item.schemeId, type: item.type as ComplianceType, period: fy.period, at, by, reference: action.reference.trim(), note: action.note?.trim() || undefined });
    } else {
      const m = this.manual.find((x) => x.id === id)!;
      m.completed = { at, by, note: action.note.trim() };
      m.version++;
    }
    this.commit();
  }

  checkProfile(p: ComplianceProfile): FieldErrors | null {
    const e: FieldErrors = {};
    if (!this.db.schemes.has(p.schemeId)) e['schemeId'] = 'No such scheme.';
    if (!(Number.isInteger(p.financialYearEnd) && p.financialYearEnd >= 1 && p.financialYearEnd <= 12)) e['financialYearEnd'] = 'Choose the month the financial year ends.';
    return Object.keys(e).length ? e : null;
  }

  /** The financial year-end and lifts: every year-based and lift item is worked out again from these. */
  updateProfile(p: ComplianceProfile): void {
    this.profiles = [...this.profiles.filter((x) => x.schemeId !== p.schemeId), { schemeId: p.schemeId, financialYearEnd: p.financialYearEnd, hasLifts: p.hasLifts }];
    this.commit();
  }

  checkManual(input: NewManualCompliance): FieldErrors | null {
    const e: FieldErrors = {};
    if (!this.db.schemes.has(input.schemeId)) e['schemeId'] = 'Choose a scheme.';
    if (input.title.trim().length < 3) e['title'] = 'What has to be done?';
    if (!input.dueAt || Number.isNaN(new Date(input.dueAt).getTime())) e['dueAt'] = 'When is it due?';
    return Object.keys(e).length ? e : null;
  }

  addManual(input: NewManualCompliance, by: string): string {
    const id = `cm-${++this.seq}`;
    this.manual.push({ id, version: 1, schemeId: input.schemeId, title: input.title.trim(), dueAt: new Date(`${input.dueAt.slice(0, 10)}T17:00:00`).toISOString(), notes: input.notes?.trim() || undefined, createdAt: new Date().toISOString(), createdBy: by });
    this.commit();
    return id;
  }

  // =================================================================== Tasks

  private queueSync(): void {
    if (this.syncQueued) return;
    this.syncQueued = true;
    queueMicrotask(() => {
      this.syncQueued = false;
      if (this.syncWork()) this.db.touch();
    });
  }

  /**
   * One open compliance Task per item that's due soon or overdue, closed when the item completes.
   * Supplier documents are one Task per SUPPLIER (the work is getting their new certificate),
   * whichever schemes it affects. Returns whether anything changed.
   */
  private syncWork(): boolean {
    const schemes = [...this.db.schemes.values()].filter((s) => s.status === 'active' || s.status === 'onboarding').map((s) => s.id);
    const due = (st: ComplianceStatus) => st === 'overdue' || st === 'due-soon';
    const wanted = new Map<string, WorkItem>();
    for (const i of this.items(schemes)) {
      if (i.type !== 'supplier-documents' && due(i.status)) wanted.set(i.ref, this.task(i));
    }
    for (const t of this.supplierTasks(schemes)) wanted.set(t.ref, t);

    const existing = this.db.workItems.filter((w) => w.type === 'compliance-due' || w.type === 'document-expiry');
    const ids = new Set(this.db.workItems.map((w) => w.id));
    let changed = false;
    for (const [ref, task] of wanted) {
      const tasks = existing.filter((w) => w.ref === ref);
      // Open already, or closed by a person in the last 30 days (they decided it's handled): leave it. Otherwise it's due again: a new Task.
      const recent = Date.now() - 30 * DAY;
      if (tasks.some((w) => w.status === 'open' || (w.decidedBy !== 'Humo' && new Date(w.decidedAt ?? 0).getTime() > recent))) continue;
      let id = task.id;
      for (let n = 2; ids.has(id); n++) id = `${task.id}-${n}`;
      ids.add(id);
      this.db.addWork({ ...task, id });
      changed = true;
    }
    for (const w of existing) {
      if (w.status === 'open' && !wanted.has(w.ref)) {
        this.db.resolveWork(w.ref, [w.type], 'Humo');
        changed = true;
      }
    }
    return changed;
  }

  /** A Task per supplier whose site-work documents have lapsed (or soon will), naming the schemes it affects. */
  private supplierTasks(schemeIds: string[]): WorkItem[] {
    const affected = new Map<string, { supplier: Supplier; docs: Set<string>; schemes: string[]; dueAt?: string; expired: boolean }>();
    for (const schemeId of schemeIds) {
      for (const s of this.suppliersOf(schemeId)) {
        for (const d of s.documents.filter((x) => SITE_WORK_DOCS.includes(x.type))) {
          const st = docStatus(d);
          if (st === 'valid') continue;
          const a = affected.get(s.id) ?? { supplier: s, docs: new Set<string>(), schemes: [], expired: false };
          a.docs.add(`${d.type} ${st === 'missing' ? 'missing' : st === 'expired' ? `expired ${formatDate(d.expires!)}` : `expires ${formatDate(d.expires!)}`}`);
          if (!a.schemes.includes(schemeId)) a.schemes.push(schemeId);
          if (d.expires && (!a.dueAt || d.expires < a.dueAt)) a.dueAt = d.expires;
          a.expired ||= st !== 'expiring';
          affected.set(s.id, a);
        }
      }
    }
    return [...affected.values()].map((a) => {
      const ref = `DOC-${a.supplier.id.replace('sup-', '').toUpperCase()}`;
      const names = a.schemes.map((id) => this.db.schemes.get(id)?.name ?? id);
      return {
        id: FIXED_WORK_IDS[ref] ?? `w-${ref.toLowerCase()}`,
        ref,
        kind: 'task',
        type: 'document-expiry',
        title: `${a.supplier.name}: ${a.expired ? 'vetting document lapsed' : 'vetting document expiring'}`,
        detail: `${[...a.docs].join('; ')}. Affects ${names.join(', ')}.`,
        schemeId: a.schemes[0],
        supplierName: a.supplier.name,
        createdAt: new Date().toISOString(),
        dueAt: a.dueAt ?? new Date().toISOString(),
        assigneeId: portfolioManagerOf(a.schemes[0])?.staffId ?? null,
        status: 'open',
        route: `/suppliers/${a.supplier.id}`,
      } satisfies WorkItem;
    });
  }

  private task(i: ComplianceItem): WorkItem {
    const scheme = this.db.scheme(i.schemeId);
    const noticeBy = i.type === 'agm' && i.dueAt ? new Date(new Date(i.dueAt).getTime() - AGM_NOTICE_DAYS * DAY).toISOString() : undefined;
    return {
      id: FIXED_WORK_IDS[i.ref] ?? `w-${i.ref.toLowerCase()}`,
      ref: i.ref,
      kind: 'task',
      type: 'compliance-due',
      title: i.type === 'agm' ? 'Set the AGM date and send notice' : `${i.title}${i.status === 'overdue' ? ' overdue' : ' due'}`,
      detail: i.detail,
      schemeId: i.schemeId,
      createdAt: new Date().toISOString(),
      dueAt: noticeBy ?? i.dueAt ?? new Date().toISOString(),
      assigneeId: portfolioManagerOf(scheme.id)?.staffId ?? null,
      status: 'open',
      route: `/compliance/${i.id}`,
    };
  }

  // =================================================================== Seed

  private seedProfiles(): ComplianceProfile[] {
    const now = new Date();
    const monthAgo = (n: number) => ((now.getMonth() + 1 - n + 24 - 1) % 12) + 1;
    // Year-ends are spread so some deadlines have passed (done), some are coming, and the demo's two are live:
    // Kingfisher Court's AGM is due this month; Silverlakes Manor's CSOS return went overdue last month.
    const FIXED: Record<string, number> = { 'kingfisher-court': 4, 'silverlakes-manor': 5 };
    const SPREAD = [8, 8, 8, 2, 10, 1, 8, 7];
    return [...this.db.schemes.values()].map((s) => {
      const r = seeded(`fye:${s.id}`);
      return { schemeId: s.id, financialYearEnd: monthAgo(FIXED[s.id] ?? SPREAD[Math.floor(r() * SPREAD.length)]), hasLifts: LIFT_SCHEMES.includes(s.id) };
    });
  }

  /** Last financial year's obligations recorded as done wherever the deadline has passed, except the demo's exceptions. */
  private seedRecords(): ComplianceRecord[] {
    const out: ComplianceRecord[] = [];
    const STAFF = ['Johan van der Merwe', 'Naledi Sithole', 'Thandeka Mokoena', 'Priya Naidoo'];
    for (const s of this.db.schemes.values()) {
      const fy = this.financialYear(s.id);
      const r = seeded(`records:${s.id}`);
      const passed = fy.deadline.getTime() < Date.now();
      const doneBefore = (days: number) => new Date(Math.min(fy.deadline.getTime(), Date.now()) - days * DAY).toISOString();
      const by = STAFF[Math.floor(r() * STAFF.length)];
      // The year before, always done: it's the history on each item's page.
      const prev = `${Number(fy.period.slice(0, 4)) - 1}${fy.period.slice(4)}`;
      out.push(
        { id: `cr-${s.id}-agm-p`, schemeId: s.id, type: 'agm', period: prev, at: new Date(fy.deadline.getTime() - 380 * DAY).toISOString(), by, reference: 'AGM held; minutes on file' },
        { id: `cr-${s.id}-afs-p`, schemeId: s.id, type: 'financial-statements', period: prev, at: new Date(fy.deadline.getTime() - 400 * DAY).toISOString(), by, reference: 'Audit report signed' },
        { id: `cr-${s.id}-csos-p`, schemeId: s.id, type: 'csos-return', period: prev, at: new Date(fy.deadline.getTime() - 372 * DAY).toISOString(), by, reference: `CSOS ref CS${Math.floor(100000 + r() * 899999)}` },
      );
      if (passed) {
        out.push({ id: `cr-${s.id}-agm`, schemeId: s.id, type: 'agm', period: fy.period, at: doneBefore(5 + Math.round(r() * 30)), by, reference: 'AGM held; minutes on file' });
        out.push({ id: `cr-${s.id}-afs`, schemeId: s.id, type: 'financial-statements', period: fy.period, at: doneBefore(25 + Math.round(r() * 30)), by, reference: 'Audit report signed' });
        if (s.id !== 'silverlakes-manor') {
          out.push({ id: `cr-${s.id}-csos`, schemeId: s.id, type: 'csos-return', period: fy.period, at: doneBefore(Math.round(r() * 20)), by, reference: `CSOS ref CS${Math.floor(100000 + r() * 899999)}` });
        }
      } else if (r() > 0.5 || s.id === 'kingfisher-court') {
        // Some audits are signed off early.
        out.push({ id: `cr-${s.id}-afs`, schemeId: s.id, type: 'financial-statements', period: fy.period, at: new Date(Date.now() - Math.round(r() * 20) * DAY).toISOString(), by, reference: 'Audit report signed' });
      }
    }
    return out;
  }

  private seedManual(): ManualComplianceItem[] {
    const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();
    return [
      { id: 'cm-001', version: 1, schemeId: 'the-willows', title: 'Pool safety inspection', dueAt: at(24), notes: 'Annual inspection before the summer season. Book with AquaCare Pools.', createdAt: at(-60), createdBy: 'Johan van der Merwe' },
      { id: 'cm-002', version: 1, schemeId: 'lonehill-village', title: 'Electrical certificate for the clubhouse', dueAt: at(75), createdAt: at(-20), createdBy: 'Thandeka Mokoena' },
    ];
  }

  private save(): void {
    simulationStorage.save('compliance', (): ComplianceSnapshot => ({ profiles: this.profiles, records: this.records, manual: this.manual, seq: this.seq }));
  }

  private commit(): void {
    this.save();
    this.db.touch();
  }
}
