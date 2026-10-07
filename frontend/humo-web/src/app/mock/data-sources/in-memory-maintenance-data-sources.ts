import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import {
  BatchView,
  Permission,
  InvoiceView,
  JobAction,
  JobDataSource,
  JobDetail,
  JobSummary,
  NewJobInput,
  PayablesDataSource,
  SupplierDataSource,
  SupplierDetail,
  SupplierSummary,
} from '../../domain';
import { SessionService } from '../../core/session/session.service';
import { MaintenanceStore } from '../db/maintenance-store';
import { MockDb } from '../db/mock-db';
import { mockResponder } from '../mock-latency';
import { CommandSpec, MockGateway } from '../server/mock-gateway';

const JOB_VERB: Record<JobAction['type'], string> = {
  triage: 'Triaged job',
  'request-quotes': 'Requested quotes',
  'record-quote': 'Recorded a quote',
  'send-for-approval': 'Sent quote for approval',
  'approve-within-delegation': 'Approved quote within delegated authority',
  'award-network-quote': 'Chose a quote from a Humo quote request',
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
  protected readonly session = inject(SessionService);
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
    return this.session.persona().name;
  }
}

@Injectable()
export class InMemoryJobDataSource extends Live implements JobDataSource {
  list(schemeIds: string[]): Observable<JobSummary[]> {
    return this.live(() => this.store.jobsIn(schemeIds));
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
    const permission: Permission = this.session.isResident() ? 'Resident.Requests' : 'Maintenance.Log';
    return this.command({ action: 'Logged a maintenance request', resource: 'Job', schemeId: input.schemeId, permission }, () => this.store.create(input, this.by));
  }

  act(ref: string, action: JobAction): Observable<void> {
    const job = this.store.detail(ref)?.job;
    // Residents answer "Was it fixed?" on their own requests; everything else runs the job.
    const permission: Permission = action.type === 'verify' && !action.onBehalf ? 'Resident.Requests' : 'Maintenance.Manage';
    const amount = action.type === 'record-quote' || action.type === 'capture-invoice' ? action.amount : undefined;
    return this.command({ action: JOB_VERB[action.type], resource: 'Job', resourceId: ref, schemeId: job?.schemeId, amount, permission }, () => this.store.act(ref, action, this.by));
  }
}

@Injectable()
export class InMemorySupplierDataSource extends Live implements SupplierDataSource {
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
      () => this.store.linkParty(input),
    );
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

  releaseBatch(batchId: string): Observable<void> {
    const b = this.store.batchesIn(this.allSchemes()).find((x) => x.batch.id === batchId);
    const spec: CommandSpec = {
      action: 'Released payment batch',
      resource: 'Payment batch',
      resourceId: batchId,
      amount: b?.batch.total,
      schemeId: b?.scheme.id,
      permission: 'Payables.Release',
      feature: 'payables',
    };
    return this.command(spec, () => this.store.releaseBatch(batchId, this.by));
  }
}
