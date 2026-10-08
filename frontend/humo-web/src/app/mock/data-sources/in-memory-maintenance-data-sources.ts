import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import {
  BatchView,
  FieldErrors,
  InvoiceView,
  JobAction,
  JobDataSource,
  JobDetail,
  JobSummary,
  ListQuery,
  NewJobInput,
  Page,
  PayablesDataSource,
  Permission,
  SUPPLIER_STATUS_LABELS,
  SupplierDataSource,
  SupplierDetail,
  SupplierDetails,
  SupplierDocType,
  SupplierStatus,
  SupplierSummary,
  Trade,
} from '../../domain';
import { MockAuthSession } from '../server/mock-auth-session';
import { ContractorStore } from '../contractor/contractor-store';
import { MaintenanceStore } from '../db/maintenance-store';
import { MockDb } from '../db/mock-db';
import { mockResponder } from '../mock-latency';
import { toPage } from '../mock-page';
import { CommandSpec, MockGateway } from '../server/mock-gateway';

const JOB_VERB: Record<JobAction['type'], string> = {
  triage: 'Triaged job',
  'request-quotes': 'Requested quotes',
  'record-quote': 'Recorded a quote',
  'send-for-approval': 'Sent quote for approval',
  'approve-within-delegation': 'Approved quote within delegated authority',
  'award-network-quote': 'Chose a quote from a Humo Contractor quote request',
  'issue-work-order': 'Issued work order',
  'start-work': 'Marked supplier on site',
  complete: 'Marked job completed',
  verify: 'Recorded whether the job was fixed',
  'capture-invoice': 'Captured supplier invoice',
  close: 'Closed job',
  comment: 'Commented on job',
  cancel: 'Cancelled job',
};

/** Base: live queries (re-run on every change) and commands that apply only on success. */
abstract class Live {
  protected readonly db = inject(MockDb);
  protected readonly store = inject(MaintenanceStore);
  protected readonly session = inject(MockAuthSession);
  protected readonly respond = mockResponder();
  protected readonly gateway = inject(MockGateway);

  protected live<T>(query: () => T): Observable<T> {
    return this.db.changes$.pipe(switchMap(() => this.respond(query())));
  }

  protected instant<T>(query: () => T): Observable<T> {
    return this.db.changes$.pipe(map(() => query()));
  }

  protected command<T>(spec: CommandSpec, apply: () => T): Observable<T> {
    return this.gateway.command(spec, apply);
  }

  protected get by(): string {
    return this.session.current.identity.name;
  }
}

@Injectable()
export class InMemoryJobDataSource extends Live implements JobDataSource {
  list(schemeIds: string[], query?: ListQuery): Observable<Page<JobSummary>> {
    return this.live(() => toPage(this.store.jobsIn(schemeIds), query));
  }

  get(ref: string): Observable<JobDetail | undefined> {
    return this.live(() => this.store.detail(ref));
  }

  search(query: string, schemeIds: string[], limit?: number): Observable<JobSummary[]> {
    return this.instant(() => this.store.searchJobs(query, schemeIds, limit));
  }

  forResident(personId: string, unitId?: string): Observable<JobSummary[]> {
    return this.live(() => this.store.jobsForResident(personId, unitId));
  }

  create(input: NewJobInput): Observable<string> {
    const permission: Permission = ['owner', 'tenant'].includes(this.session.assignment().role) ? 'Resident.Requests' : 'Maintenance.Log';
    return this.command(
      {
        action: 'Logged a maintenance request',
        resource: 'Job',
        schemeId: input.schemeId,
        permission,
        validate: () => {
          const e: Record<string, string> = {};
          const title = input.title.trim();
          if (title.length < 4) e['title'] = 'Use a few words, e.g. “Geyser leaking”.';
          else if (title.length > 80) e['title'] = 'Keep the title under 80 characters; put the detail in the description.';
          if (!input.unitId && !input.location.trim()) e['location'] = 'Say where on the property it is.';
          if (input.unitId && !this.db.units.some((u) => u.id === input.unitId && u.schemeId === input.schemeId)) e['unit'] = 'That unit isn’t in this scheme.';
          return e;
        },
      },
      () => this.store.create(input, this.by),
    );
  }

  act(ref: string, action: JobAction, expectedVersion?: number): Observable<void> {
    const job = this.store.detail(ref)?.job;
    // Residents answer "Was it fixed?" on their own requests; everything else runs the job.
    const permission: Permission = action.type === 'verify' && !action.onBehalf ? 'Resident.Requests' : 'Maintenance.Manage';
    const amount = action.type === 'record-quote' || action.type === 'capture-invoice' ? action.amount : undefined;
    return this.command(
      { action: JOB_VERB[action.type], resource: 'Job', resourceId: ref, schemeId: job?.schemeId, amount, permission, version: { expected: expectedVersion, current: job?.version } },
      () => this.store.act(ref, action, this.by),
    );
  }
}

const TRADES: Trade[] = [
  'Plumbing', 'Electrical', 'Roofing & waterproofing', 'Painting', 'Security', 'Gate automation', 'Lifts', 'Gardens', 'Pools', 'Pest control', 'Building', 'Fire equipment',
];
const VETTING_DOCS: SupplierDocType[] = ['COIDA letter of good standing', 'Public liability insurance', 'Tax compliance (SARS PIN)', 'B-BBEE certificate', 'Bank confirmation letter'];

@Injectable()
export class InMemorySupplierDataSource extends Live implements SupplierDataSource {
  private readonly contractors = inject(ContractorStore);

  list(schemeIds: string[]): Observable<SupplierSummary[]> {
    return this.live(() => this.store.suppliersFor(schemeIds));
  }

  get(id: string): Observable<SupplierDetail | undefined> {
    return this.live(() => this.store.supplierDetail(id));
  }

  search(query: string, limit?: number): Observable<SupplierSummary[]> {
    return this.instant(() => this.store.searchSuppliers(query, limit));
  }

  requestDocument(supplierId: string, type: string): Observable<void> {
    const name = this.store.supplierDetail(supplierId)?.supplier.name;
    return this.command({ action: `Requested ${type} from ${name}`, resource: 'Supplier', resourceId: supplierId, permission: 'Suppliers.Manage' }, () => undefined);
  }

  linkParty(input: Parameters<SupplierDataSource['linkParty']>[0]): Observable<string> {
    return this.command(
      { action: `Added ${input.name} as a supplier (from Humo Contractor)`, resource: 'Supplier', resourceId: input.partyId, permission: 'Suppliers.Manage' },
      () => {
        // Server-side join: the business's own contact details, from Humo Contractor.
        const contact = this.contractors.profiles().find((p) => p.party.id === input.partyId)?.party.contact;
        return this.store.linkParty(input, contact ?? { name: input.name, phone: '', email: '' });
      },
    );
  }

  create(details: SupplierDetails): Observable<string> {
    return this.command(
      { action: `Added supplier ${details.name}`, resource: 'Supplier', permission: 'Suppliers.Manage', feature: 'suppliers', validate: () => this.check(details, null) },
      () => {
        const base = `sup-${details.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
        let id = base;
        for (let n = 2; this.store.supplier(id); n++) id = `${base}-${n}`;
        this.store.addSupplier({
          id,
          version: 1,
          ...this.clean(details),
          bankAccount: 'To be confirmed',
          bankVerified: false,
          documents: VETTING_DOCS.map((type) => ({ type, onFile: false })),
          performance: { jobsCompleted: 0, onTimeRate: 0, avgVariance: 0, verifiedRate: 0 },
          status: 'active',
        });
        return id;
      },
    );
  }

  update(id: string, details: SupplierDetails, expectedVersion?: number): Observable<void> {
    const s = this.store.supplier(id);
    return this.command(
      {
        action: `Updated supplier details for ${details.name}`,
        resource: 'Supplier',
        resourceId: id,
        permission: 'Suppliers.Manage',
        version: { expected: expectedVersion, current: s?.version },
        validate: () => this.check(details, id),
      },
      () => this.store.changeSupplier(id, (x) => ({ ...x, ...this.clean(details) })),
    );
  }

  setStatus(id: string, status: SupplierStatus, reason: string, expectedVersion?: number): Observable<void> {
    const s = this.store.supplier(id);
    const verb = status === 'on-hold' ? 'Put on hold' : status === 'archived' ? 'Archived' : s?.status === 'archived' ? 'Restored' : 'Released hold on';
    return this.command(
      {
        action: `${verb} ${s?.name ?? id} — ${reason}`,
        resource: 'Supplier',
        resourceId: id,
        permission: 'Suppliers.Manage',
        version: { expected: expectedVersion, current: s?.version },
        validate: (): FieldErrors | null => {
          if (!s) return { status: 'That supplier no longer exists.' };
          if (s.status === status) return { status: `It’s already ${SUPPLIER_STATUS_LABELS[status].toLowerCase()}.` };
          if (status === 'archived' && this.store.jobs.some((j) => j.supplierId === id && !['closed', 'cancelled', 'paid'].includes(j.stage))) {
            return { status: 'They still have open jobs. Finish or reassign them first.' };
          }
          return reason.trim().length < 5 ? { reason: 'Say why, in a few words. It goes in the audit log.' } : null;
        },
      },
      () => this.store.changeSupplier(id, (x) => ({ ...x, status })),
    );
  }

  private clean(d: SupplierDetails): SupplierDetails {
    return {
      name: d.name.trim(), trades: d.trades, contactName: d.contactName.trim(), phone: d.phone.trim(), email: d.email.trim(), schemeIds: d.schemeIds,
      bbbeeLevel: d.bbbeeLevel ? Number(d.bbbeeLevel) : undefined,
    };
  }

  private check(d: SupplierDetails, id: string | null): FieldErrors {
    const e: FieldErrors = {};
    if (d.name.trim().length < 2) e['name'] = 'Enter the business name.';
    else if (this.store.suppliers.some((s) => s.id !== id && s.name.toLowerCase() === d.name.trim().toLowerCase())) e['name'] = 'You already have a supplier with this name.';
    if (!d.trades.length || d.trades.some((t) => !TRADES.includes(t))) e['trades'] = 'Choose what they do.';
    if (d.contactName.trim().length < 2) e['contactName'] = 'Who do you deal with there?';
    if (!/^[+\d][\d\s]{8,}$/.test(d.phone.trim())) e['phone'] = 'Enter a phone number, e.g. 082 555 0142.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) e['email'] = 'Enter an email address for work orders and remittances.';
    if (!d.schemeIds.length) e['schemeIds'] = 'Choose at least one scheme they work at.';
    if (d.bbbeeLevel !== undefined && !(Number(d.bbbeeLevel) >= 1 && Number(d.bbbeeLevel) <= 8)) e['bbbeeLevel'] = 'B-BBEE levels run from 1 to 8.';
    return e;
  }

  changeBankDetails(supplierId: string): Observable<void> {
    const name = this.store.supplierDetail(supplierId)?.supplier.name;
    return this.command(
      { action: `Changed banking details for ${name} (payments held until verified)`, resource: 'Supplier', resourceId: supplierId, permission: 'Suppliers.ChangeBankDetails', category: 'security' },
      () => undefined,
    );
  }
}

@Injectable()
export class InMemoryPayablesDataSource extends Live implements PayablesDataSource {
  private allSchemes(): string[] {
    return [...new Set(this.db.units.map((u) => u.schemeId))];
  }

  invoices(schemeIds: string[]): Observable<InvoiceView[]> {
    return this.live(() => this.store.invoicesIn(schemeIds));
  }

  batches(schemeIds: string[]): Observable<BatchView[]> {
    return this.live(() => this.store.batchesIn(schemeIds));
  }

  createBatch(invoiceIds: string[]): Observable<string> {
    const invoices = this.store.invoicesIn(this.allSchemes()).filter((i) => invoiceIds.includes(i.invoice.id));
    const spec: CommandSpec = {
      action: `Created payment batch of ${invoices.length} invoices`,
      resource: 'Payment batch',
      amount: invoices.reduce((n, i) => n + i.invoice.amount, 0),
      schemeId: invoices[0]?.scheme.id,
      permission: 'Payables.Prepare',
      feature: 'payables',
    };
    return this.command(spec, () => this.store.createBatch(invoiceIds, this.by));
  }

  releaseBatch(batchId: string, expectedVersion?: number): Observable<void> {
    const b = this.store.batchesIn(this.allSchemes()).find((x) => x.batch.id === batchId);
    const spec: CommandSpec = {
      action: 'Released payment batch',
      resource: 'Payment batch',
      resourceId: batchId,
      amount: b?.batch.total,
      schemeId: b?.scheme.id,
      permission: 'Payables.Release',
      feature: 'payables',
      version: { expected: expectedVersion, current: b?.batch.version },
    };
    return this.command(spec, () => this.store.releaseBatch(batchId, this.by));
  }
}
