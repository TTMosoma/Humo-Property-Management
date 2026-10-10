import { Injectable, Injector, inject } from '@angular/core';
import { simulationStorage } from '../simulation/simulation-storage';
import {
  BatchView,
  DELEGATED_LIMIT,
  Invoice,
  InvoiceView,
  Job,
  JobAction,
  JobDetail,
  JobEvent,
  JobSummary,
  NewJobInput,
  PaymentBatch,
  Role,
  Supplier,
  SupplierDetail,
  SupplierSummary,
  WorkItem,
  invoiceVariance,
  supplierCompliance,
} from '../../domain';
import { formatRand } from '../../ui/format/money';
import { personName, portfolioManagerOf } from '../fixtures/staff';
import { MockDb } from './mock-db';
import { round2, seeded } from './random';
import { seedMaintenance } from './seed-maintenance';
import { BudgetStore } from './budget-store';

const QUOTE_APPROVERS_TRUSTEE: Role[] = ['agency-admin', 'portfolio-manager', 'trustee'];
const PAYMENT_APPROVERS: Role[] = ['agency-admin', 'finance', 'trustee'];

/**
 * Maintenance & procure-to-pay "backend" for the prototype: jobs, suppliers,
 * invoices and payment batches, with the side effects a real API would apply.
 * Shares MockDb's work items and change stream, so Approvals, Tasks, badges
 * and job pages always agree.
 */
/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface MaintenanceSnapshot {
  suppliers: Supplier[];
  jobs: Job[];
  invoices: Invoice[];
  batches: PaymentBatch[];
}

@Injectable({ providedIn: 'root' })
export class MaintenanceStore {
  private readonly db = inject(MockDb);
  private readonly injector = inject(Injector);

  suppliers: Supplier[];
  jobs: Job[];
  invoices: Invoice[];
  batches: PaymentBatch[];

  constructor() {
    const seed = simulationStorage.load<MaintenanceSnapshot>('maintenance') ?? seedMaintenance(this.db.units);
    this.suppliers = seed.suppliers;
    this.jobs = seed.jobs;
    this.invoices = seed.invoices;
    this.batches = seed.batches;
    this.db.workHooks.push((before, after) => this.onDecision(before, after));
    // Every maintenance change touches the portfolio database; save alongside it (dev only).
    this.db.changes$.subscribe(() =>
      simulationStorage.save('maintenance', (): MaintenanceSnapshot => ({ suppliers: this.suppliers, jobs: this.jobs, invoices: this.invoices, batches: this.batches })),
    );
  }

  // =================================================================== Reads

  supplier(id?: string): Supplier | undefined {
    return id ? this.suppliers.find((s) => s.id === id) : undefined;
  }

  summary(job: Job): JobSummary {
    return {
      job,
      scheme: this.db.scheme(job.schemeId),
      unit: job.unitId ? this.db.unitById.get(job.unitId) : undefined,
      supplier: this.supplier(job.supplierId),
      assigneeName: personName(job.assigneeId),
    };
  }

  jobsIn(schemeIds: string[]): JobSummary[] {
    const ids = new Set(schemeIds);
    return this.jobs.filter((j) => ids.has(j.schemeId)).map((j) => this.summary(j));
  }

  jobsForResident(personId: string, unitId?: string): JobSummary[] {
    return this.jobs
      .filter((j) => j.reportedBy.personId === personId || (unitId && j.unitId === unitId))
      .map((j) => this.summary(j));
  }

  detail(ref: string): JobDetail | undefined {
    const job = this.jobs.find((j) => j.ref === ref);
    if (!job) return undefined;
    const suppliers: Record<string, Supplier> = {};
    for (const q of job.quotes) {
      const s = this.supplier(q.supplierId);
      if (s) suppliers[s.id] = s;
    }
    const invoice = job.invoiceId ? this.invoices.find((i) => i.id === job.invoiceId) : undefined;
    return {
      ...this.summary(job),
      suppliers,
      // Archived suppliers aren't offered for new work.
      candidates: this.suppliers.filter((s) => s.status !== 'archived' && s.trades.includes(job.category) && s.schemeIds.includes(job.schemeId)),
      invoice: invoice ? this.invoiceView(invoice) : undefined,
      batch: invoice?.batchId ? this.batches.find((b) => b.id === invoice.batchId) : undefined,
      approvalItem: job.approval?.workItemId ? this.db.workItems.find((w) => w.id === job.approval!.workItemId) : undefined,
      invoiceApprovalItem: invoice?.approvalWorkItemId ? this.db.workItems.find((w) => w.id === invoice.approvalWorkItemId) : undefined,
    };
  }

  searchJobs(query: string, schemeIds: string[], limit = 5): JobSummary[] {
    const q = query.toLowerCase().trim();
    if (q.length < 2) return [];
    const ids = new Set(schemeIds);
    return this.jobs
      .filter((j) => ids.has(j.schemeId) && `${j.ref} ${j.title} ${j.location}`.toLowerCase().includes(q))
      .slice(0, limit)
      .map((j) => this.summary(j));
  }

  supplierSummary(s: Supplier): SupplierSummary {
    const yearAgo = Date.now() - 365 * 86_400_000;
    return {
      supplier: s,
      schemes: s.schemeIds.map((id) => this.db.scheme(id)),
      compliance: supplierCompliance(s),
      openJobs: this.jobs.filter((j) => j.supplierId === s.id && !['paid', 'closed', 'cancelled'].includes(j.stage)).length,
      spend12m: round2(
        this.invoices.filter((i) => i.supplierId === s.id && i.status === 'paid' && new Date(i.paidAt ?? i.receivedAt).getTime() > yearAgo).reduce((t, i) => t + i.amount, 0),
      ),
    };
  }

  suppliersFor(schemeIds: string[]): SupplierSummary[] {
    const ids = new Set(schemeIds);
    return this.suppliers.filter((s) => s.schemeIds.some((id) => ids.has(id))).map((s) => this.supplierSummary(s));
  }

  supplierDetail(id: string): SupplierDetail | undefined {
    const s = this.supplier(id);
    if (!s) return undefined;
    return {
      ...this.supplierSummary(s),
      jobs: this.jobs.filter((j) => j.supplierId === id || j.quotes.some((q) => q.supplierId === id)).map((j) => this.summary(j)),
      invoices: this.invoices.filter((i) => i.supplierId === id).map((i) => this.invoiceView(i)),
    };
  }

  searchSuppliers(query: string, limit = 5): SupplierSummary[] {
    const q = query.toLowerCase().trim();
    if (q.length < 2) return [];
    return this.suppliers
      .filter((s) => `${s.name} ${s.trades.join(' ')} ${s.contactName}`.toLowerCase().includes(q))
      .slice(0, limit)
      .map((s) => this.supplierSummary(s));
  }

  invoiceView(invoice: Invoice): InvoiceView {
    return {
      invoice,
      supplier: this.supplier(invoice.supplierId)!,
      scheme: this.db.scheme(invoice.schemeId),
      job: invoice.jobId ? this.jobs.find((j) => j.id === invoice.jobId) : undefined,
      variance: invoiceVariance(invoice),
    };
  }

  invoicesIn(schemeIds: string[]): InvoiceView[] {
    const ids = new Set(schemeIds);
    return this.invoices.filter((i) => ids.has(i.schemeId)).map((i) => this.invoiceView(i));
  }

  batchesIn(schemeIds: string[]): BatchView[] {
    const ids = new Set(schemeIds);
    return this.batches
      .filter((b) => ids.has(b.schemeId))
      .map((batch) => ({
        batch,
        scheme: this.db.scheme(batch.schemeId),
        invoices: batch.invoiceIds.map((id) => this.invoiceView(this.invoices.find((i) => i.id === id)!)),
        approvalItem: batch.approvalWorkItemId ? this.db.workItems.find((w) => w.id === batch.approvalWorkItemId) : undefined,
      }));
  }

  // =================================================================== Commands

  create(input: NewJobInput, by: string): string {
    const ref = `MR-${Math.max(...this.jobs.map((j) => Number(j.ref.slice(3)))) + 1}`;
    const now = new Date().toISOString();
    const job: Job = { version: 1,
      id: 'job-' + ref.toLowerCase(),
      ref,
      schemeId: input.schemeId,
      unitId: input.unitId,
      location: input.location,
      title: input.title,
      description: input.description,
      category: input.category,
      priority: input.priority,
      stage: 'reported',
      reportedBy: input.reportedBy,
      reportedAt: now,
      assigneeId: input.reportedBy.role === 'staff' ? (portfolioManagerOf(input.schemeId)?.staffId ?? null) : null,
      photos: input.photoCaptions.map((caption, i) => ({ id: `${ref}-p${i + 1}`, caption, takenAt: now, by: input.reportedBy.name, stage: 'report' })),
      quotes: [],
      budgetCategory: `Maintenance — ${input.category.toLowerCase()}`,
      events: [],
    };
    this.log(job, 'stage', `Reported by ${input.reportedBy.name}${input.reportedBy.role !== 'staff' ? ` (${input.reportedBy.role})` : ''}`, by);
    this.jobs = [job, ...this.jobs];
    const unit = job.unitId ? this.db.unitById.get(job.unitId) : undefined;
    // New requests land in the team's queue for triage.
    this.db.addWork({
      id: `w-${ref}-triage`,
      ref,
      kind: 'task',
      type: 'maintenance-triage',
      title: `New: ${job.title}`,
      detail: job.description,
      schemeId: job.schemeId,
      unitLabel: unit ? `Unit ${unit.number}` : undefined,
      personName: input.reportedBy.role !== 'staff' ? input.reportedBy.name : undefined,
      createdAt: now,
      dueAt: new Date(Date.now() + (job.priority === 'urgent' ? 4 : 24) * 3_600_000).toISOString(),
      assigneeId: null,
      status: 'open',
      route: `/maintenance/${ref}`,
    });
    this.db.touch();
    return ref;
  }

  /** Find or start the agency's supplier relationship with a Humo Contractor party. */
  /** A supplier the agency vets itself: every vetting document still to come. */
  addSupplier(s: Supplier): void {
    this.suppliers = [...this.suppliers, s];
    this.db.touch();
  }

  changeSupplier(id: string, apply: (s: Supplier) => Supplier): void {
    this.suppliers = this.suppliers.map((s) => (s.id === id ? { ...apply(s), version: s.version + 1 } : s));
    this.db.touch();
  }

  linkParty(input: { partyId: string; name: string; trades: Supplier['trades']; schemeId: string }, contact: { name: string; phone: string; email: string }): string {
    const existing = this.suppliers.find((s) => s.partyId === input.partyId);
    if (existing) {
      if (!existing.schemeIds.includes(input.schemeId)) existing.schemeIds.push(input.schemeId);
      return existing.id;
    }
    const soon = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    const supplier: Supplier = {
      version: 1,
      id: `sup-${input.partyId.replace(/^party-/, '')}`,
      partyId: input.partyId,
      name: input.name,
      trades: input.trades,
      contactName: contact.name,
      phone: contact.phone,
      email: contact.email,
      bankAccount: 'To be confirmed',
      bankVerified: false,
      schemeIds: [input.schemeId],
      // Documents Humo verified on the contractor profile; the bank letter still needs the agency's own check.
      documents: [
        { type: 'COIDA letter of good standing', onFile: true, expires: soon(200) },
        { type: 'Public liability insurance', onFile: true, expires: soon(240) },
        { type: 'Tax compliance (SARS PIN)', onFile: true, expires: soon(300) },
        { type: 'B-BBEE certificate', onFile: true, expires: soon(320) },
        { type: 'Bank confirmation letter', onFile: false },
      ],
      performance: { jobsCompleted: 0, onTimeRate: 0, avgVariance: 0, verifiedRate: 0 },
      status: 'active',
    };
    this.suppliers.push(supplier);
    return supplier.id;
  }

  act(ref: string, action: JobAction, by: string): void {
    const job = this.jobs.find((j) => j.ref === ref);
    if (!job) throw new Error(`Unknown job ${ref}`);
    job.version++;

    switch (action.type) {
      case 'triage':
        job.assigneeId = action.assigneeId;
        job.priority = action.priority;
        job.category = action.category;
        this.log(job, 'stage', `Triaged: ${action.priority} priority, ${action.category}, assigned to ${personName(action.assigneeId)}`, by);
        this.db.resolveWork(ref, ['maintenance-triage'], by);
        break;

      case 'request-quotes': {
        for (const supplierId of action.supplierIds) {
          if (job.quotes.some((q) => q.supplierId === supplierId)) continue;
          job.quotes.push({ id: `${ref}-q${job.quotes.length + 1}`, supplierId, amount: 0, status: 'requested' });
          this.log(job, 'quote', `Quote requested from ${this.supplier(supplierId)?.name}`, by);
        }
        job.stage = 'quoting';
        this.db.resolveWork(ref, ['maintenance-triage'], by);
        break;
      }

      case 'record-quote': {
        const q = job.quotes.find((x) => x.id === action.quoteId)!;
        q.amount = action.amount;
        q.status = 'received';
        q.receivedAt = new Date().toISOString();
        q.validUntil = new Date(Date.now() + 30 * 86_400_000).toISOString();
        q.guaranteeMonths = action.guaranteeMonths;
        q.notes = action.notes;
        this.log(job, 'quote', `Quote received from ${this.supplier(q.supplierId)?.name}: ${formatRand(action.amount)}`, by);
        break;
      }

      case 'approve-within-delegation': {
        const q = job.quotes.find((x) => x.id === action.quoteId)!;
        if (q.amount > DELEGATED_LIMIT) throw new Error('Above delegated authority');
        job.quotes.forEach((x) => (x.recommended = x.id === q.id));
        job.supplierId = q.supplierId;
        job.approval = { status: 'approved', decidedBy: by, decidedAt: new Date().toISOString(), withinDelegation: true };
        job.stage = 'approved';
        this.log(job, 'approval', `Approved ${this.supplier(q.supplierId)?.name} at ${formatRand(q.amount)} within delegated authority (up to R ${DELEGATED_LIMIT})`, by);
        break;
      }

      case 'award-network-quote': {
        // The comparison happened in the contractor network; the job records the chosen quote
        // and continues exactly like any other quote (approval → work order → invoice).
        const quoteId = `${ref}-q${job.quotes.length + 1}`;
        job.quotes.push({
          id: quoteId, supplierId: action.supplierId, amount: action.amount, status: 'received', receivedAt: new Date().toISOString(),
          guaranteeMonths: action.guaranteeMonths, notes: `Via Humo Contractor quote request ${action.quoteRequestId} · complete by ${fmtDay(action.completeBy)}`,
        });
        job.networkQuotes = { quoteRequestId: action.quoteRequestId, compared: action.compared };
        this.log(job, 'quote', `Chose ${this.supplier(action.supplierId)?.name} (${formatRand(action.amount)}) from ${action.compared} quotes in Humo Contractor quote request ${action.quoteRequestId}`, by);
        return this.act(ref, action.amount <= DELEGATED_LIMIT ? { type: 'approve-within-delegation', quoteId } : { type: 'send-for-approval', quoteId }, by);
      }

      case 'send-for-approval': {
        const q = job.quotes.find((x) => x.id === action.quoteId)!;
        job.quotes.forEach((x) => (x.recommended = x.id === q.id));
        const received = { length: job.networkQuotes?.compared ?? job.quotes.filter((x) => x.status === 'received').length };
        const supplier = this.supplier(q.supplierId)!;
        const workId = `w-${ref}-approval`;
        const budget = this.budgetFor(job);
        this.db.addWork({
          id: workId,
          ref,
          kind: 'approval',
          type: 'quote-approval',
          title: job.title,
          detail: `${received.length} ${received.length === 1 ? 'quote' : 'quotes'} compared. Recommended: ${supplier.name}${q.guaranteeMonths ? ` (${q.guaranteeMonths}-month guarantee)` : ''}.`,
          schemeId: job.schemeId,
          supplierName: supplier.name,
          amount: q.amount,
          createdAt: new Date().toISOString(),
          dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          assigneeId: null,
          approverRoles: q.amount > DELEGATED_LIMIT ? QUOTE_APPROVERS_TRUSTEE : ['agency-admin', 'portfolio-manager'],
          budget,
          evidence: [`${received.length} quotes compared`, ...(job.photos.length ? [`Photos (${job.photos.length})`] : []), `Recommendation by ${by}`],
          status: 'open',
          route: `/maintenance/${ref}`,
        });
        job.approval = { status: 'pending', workItemId: workId };
        job.stage = 'approval';
        this.log(job, 'approval', `Sent for ${q.amount > DELEGATED_LIMIT ? 'trustee' : 'agency'} approval: ${supplier.name}, ${formatRand(q.amount)}`, by);
        break;
      }

      case 'issue-work-order':
        job.workOrder = { issuedAt: new Date().toISOString(), scheduledFor: action.scheduledFor, accessNotes: action.accessNotes };
        job.stage = 'scheduled';
        job.dueAt = new Date(new Date(action.scheduledFor).getTime() + 8 * 3_600_000).toISOString();
        this.log(job, 'stage', `Work order issued to ${this.supplier(job.supplierId)?.name} for ${fmtDay(action.scheduledFor)}`, by);
        if (job.reportedBy.role !== 'staff') this.log(job, 'message', `${job.reportedBy.name} notified of the booking`, 'Humo PM');
        break;

      case 'start-work':
        job.stage = 'in-progress';
        this.log(job, 'stage', 'Supplier on site — work in progress', by);
        this.db.resolveWork(ref, ['maintenance-overdue'], by);
        break;

      case 'complete':
        job.completion = { completedAt: new Date().toISOString(), notes: action.notes };
        job.photos.push({ id: `${ref}-c${job.photos.length + 1}`, caption: 'Completed work', takenAt: job.completion.completedAt, by: this.supplier(job.supplierId)?.name ?? 'Supplier', stage: 'completion' });
        job.stage = 'completed';
        this.log(job, 'stage', `Completed: ${action.notes}`, by);
        if (job.reportedBy.role !== 'staff') this.log(job, 'message', `Asked ${job.reportedBy.name} to confirm it’s fixed`, 'Humo PM');
        this.db.resolveWork(ref, ['maintenance-overdue'], by);
        break;

      case 'verify':
        job.verification = { at: new Date().toISOString(), by: action.onBehalf ? `${by} (on behalf of resident)` : by, outcome: action.outcome, comment: action.comment };
        if (action.outcome === 'fixed') {
          job.stage = 'verified';
          this.log(job, 'stage', `Verified as fixed by ${job.verification.by}`, by);
        } else {
          job.stage = 'scheduled';
          job.completion = undefined;
          this.log(job, 'stage', `Reported as NOT fixed${action.comment ? `: “${action.comment}”` : ''} — supplier to return`, by);
        }
        break;

      case 'capture-invoice': {
        const approved = job.quotes.find((q) => q.recommended)?.amount;
        const variance = approved === undefined ? null : round2(action.amount - approved);
        const needsApproval = variance === null || variance > 0;
        const invoice: Invoice = { version: 1,
          id: action.invoiceNo,
          supplierId: job.supplierId!,
          schemeId: job.schemeId,
          jobId: job.id,
          description: job.title,
          amount: action.amount,
          approvedAmount: approved,
          receivedAt: new Date().toISOString(),
          dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          status: needsApproval ? 'awaiting-approval' : 'approved',
        };
        if (needsApproval) {
          const workId = `w-${invoice.id}`;
          invoice.approvalWorkItemId = workId;
          this.db.addWork({
            id: workId,
            ref: invoice.id,
            kind: 'approval',
            type: 'invoice-approval',
            title: `${this.supplier(job.supplierId)?.name} — ${job.title}`,
            detail: variance !== null ? `Invoice is ${formatRand(variance)} above the approved quote. Re-approval needed.` : 'No approved quote on file.',
            schemeId: job.schemeId,
            supplierName: this.supplier(job.supplierId)?.name,
            amount: action.amount,
            createdAt: new Date().toISOString(),
            dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
            assigneeId: null,
            approverRoles: QUOTE_APPROVERS_TRUSTEE,
            budget: this.budgetFor(job),
            evidence: [approved !== undefined ? `Approved quote ${formatRand(approved)}` : 'No quote', variance ? `Variance: + ${formatRand(variance)}` : 'Matches quote'],
            status: 'open',
            route: `/maintenance/${ref}`,
          });
        }
        this.invoices = [invoice, ...this.invoices];
        job.invoiceId = invoice.id;
        job.stage = 'invoiced';
        this.log(
          job,
          'invoice',
          needsApproval
            ? `Invoice ${invoice.id} captured: ${formatRand(action.amount)} — ${formatRand((variance ?? 0))} over the approved quote, sent for re-approval`
            : `Invoice ${invoice.id} captured: ${formatRand(action.amount)} — matches the approved quote, ready to pay`,
          by,
        );
        break;
      }

      case 'close':
        job.stage = 'closed';
        this.log(job, 'stage', 'Job closed', by);
        break;

      case 'comment':
        this.log(job, 'comment', action.text, by);
        break;

      case 'cancel':
        job.stage = 'cancelled';
        this.log(job, 'stage', `Cancelled: ${action.reason}`, by);
        this.db.resolveWork(ref, ['maintenance-triage', 'maintenance-overdue'], by);
        break;
    }
    this.jobs = [...this.jobs];
    this.db.touch();
  }

  createBatch(invoiceIds: string[], by: string): string {
    const invoices = this.invoices.filter((i) => invoiceIds.includes(i.id) && i.status === 'approved');
    if (!invoices.length) throw new Error('No approved invoices selected');
    const schemeId = invoices[0].schemeId;
    if (invoices.some((i) => i.schemeId !== schemeId)) throw new Error('A batch pays from one scheme’s trust account');
    const next = Math.max(0, ...this.batches.map((b) => Number(b.id.replace(/\D/g, '')))) + 1;
    const id = `PB-${String(next).padStart(4, '0')}`;
    const total = round2(invoices.reduce((s, i) => s + i.amount, 0));
    const workId = `w-${id}`;
    invoices.forEach((i) => {
      i.status = 'in-batch';
      i.batchId = id;
    });
    this.batches = [{ version: 1, id, schemeId, invoiceIds: invoices.map((i) => i.id), total, createdAt: new Date().toISOString(), createdBy: by, status: 'awaiting-approval', approvalWorkItemId: workId }, ...this.batches];
    this.db.addWork({
      id: workId,
      ref: id,
      kind: 'approval',
      type: 'payment-batch-approval',
      title: `Payment batch ${id} — ${invoices.length} supplier ${invoices.length === 1 ? 'payment' : 'payments'}`,
      detail: 'All invoices approved and matched. Second authoriser required.',
      schemeId,
      amount: total,
      createdAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      assigneeId: null,
      approverRoles: PAYMENT_APPROVERS,
      evidence: [`${invoices.length} approved invoices`, `Created by ${by}`],
      status: 'open',
      route: '/finance/payables',
    });
    for (const i of invoices) {
      const job = this.jobs.find((j) => j.id === i.jobId);
      if (job) this.log(job, 'payment', `Added to payment batch ${id}`, by);
    }
    this.db.touch();
    return id;
  }

  releaseBatch(batchId: string, by: string): void {
    const batch = this.batches.find((b) => b.id === batchId);
    if (!batch || batch.status !== 'approved') throw new Error('Batch is not approved');
    batch.version++;
    batch.status = 'released';
    batch.releasedAt = new Date().toISOString();
    for (const id of batch.invoiceIds) {
      const inv = this.invoices.find((i) => i.id === id)!;
      inv.version++;
      inv.status = 'paid';
      inv.paidAt = batch.releasedAt;
      const job = this.jobs.find((j) => j.id === inv.jobId);
      if (job) {
        job.stage = 'paid';
        this.log(job, 'payment', `Paid ${formatRand(inv.amount)} to ${this.supplier(inv.supplierId)?.name} (batch ${batch.id})`, by);
      }
    }
    this.batches = [...this.batches];
    this.db.touch();
  }

  // =================================================================== Decision side effects

  /** Approvals are decided in one place (My work › Approvals); their consequences land here. */
  private onDecision(before: WorkItem, after: WorkItem): void {
    const by = after.decidedBy ?? 'Approver';
    if (after.type === 'quote-approval') {
      const job = this.jobs.find((j) => j.approval?.workItemId === after.id);
      if (!job) return;
      const q = job.quotes.find((x) => x.recommended);
      if (after.status === 'approved') {
        job.approval = { ...job.approval!, status: 'approved', decidedBy: by, decidedAt: after.decidedAt, comment: after.comment };
        job.supplierId = q?.supplierId;
        job.stage = 'approved';
        this.log(job, 'approval', `Approved by ${by}: ${this.supplier(q?.supplierId)?.name}, ${formatRand(q?.amount)}`, by);
      } else if (after.status === 'rejected') {
        job.approval = { ...job.approval!, status: 'rejected', decidedBy: by, decidedAt: after.decidedAt, comment: after.comment };
        job.stage = 'quoting';
        this.log(job, 'approval', `Rejected by ${by}${after.comment ? `: “${after.comment}”` : ''}`, by);
      } else if (after.status === 'open') {
        job.approval = { status: 'pending', workItemId: after.id };
        job.supplierId = undefined;
        job.stage = 'approval';
        this.log(job, 'approval', 'Decision undone — back to approval', by);
      }
      this.jobs = [...this.jobs];
    }

    if (after.type === 'invoice-approval') {
      const inv = this.invoices.find((i) => i.approvalWorkItemId === after.id);
      if (!inv) return;
      inv.status = after.status === 'approved' ? 'approved' : after.status === 'rejected' ? 'rejected' : 'awaiting-approval';
      const job = this.jobs.find((j) => j.id === inv.jobId);
      if (job && after.status !== 'open') this.log(job, 'invoice', `Invoice ${inv.id} ${after.status} by ${by}${after.comment ? `: “${after.comment}”` : ''}`, by);
    }

    if (after.type === 'payment-batch-approval') {
      const batch = this.batches.find((b) => b.approvalWorkItemId === after.id);
      if (!batch) return;
      if (after.status === 'approved') batch.status = 'approved';
      else if (after.status === 'open') batch.status = 'awaiting-approval';
      else if (after.status === 'rejected') {
        batch.status = 'awaiting-approval';
        for (const id of batch.invoiceIds) {
          const inv = this.invoices.find((i) => i.id === id)!;
          inv.status = 'approved';
          inv.batchId = undefined;
        }
        this.batches = this.batches.filter((b) => b.id !== batch.id);
      }
    }
    void before;
  }

  // =================================================================== Helpers

  private log(job: Job, kind: JobEvent['kind'], text: string, by: string): void {
    job.events = [{ id: `${job.ref}-e${job.events.length + 1}-${Date.now()}`, at: new Date().toISOString(), kind, text, by }, ...job.events];
  }

  /**
   * The approved budget line this job counts against, with what's been spent and committed, for the
   * approval card. Looked up lazily: the budget store reads this store's invoices.
   */
  private budgetFor(job: Job): { category: string; annual: number; spent: number } | undefined {
    return this.injector.get(BudgetStore).lineFor(job.schemeId, job.category);
  }
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
}
