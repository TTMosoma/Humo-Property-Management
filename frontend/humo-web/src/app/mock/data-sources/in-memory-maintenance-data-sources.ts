import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap, tap } from 'rxjs';
import {
  BatchView,
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

/** Base: live queries (re-run on every change) and commands that apply only on success. */
abstract class Live {
  protected readonly db = inject(MockDb);
  protected readonly store = inject(MaintenanceStore);
  protected readonly session = inject(SessionService);
  protected readonly respond = mockResponder();

  protected live<T>(query: () => T): Observable<T> {
    return this.db.changes$.pipe(switchMap(() => this.respond(query())));
  }

  protected instant<T>(query: () => T): Observable<T> {
    return this.db.changes$.pipe(map(() => query()));
  }

  protected command<T>(apply: () => T): Observable<T> {
    return this.respond(null).pipe(map(() => apply()));
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
    return this.command(() => this.store.create(input, this.by));
  }

  act(ref: string, action: JobAction): Observable<void> {
    return this.command(() => this.store.act(ref, action, this.by));
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
    return this.respond(null).pipe(
      tap(() => void [supplierId, type]),
      map(() => undefined),
    );
  }
}

@Injectable()
export class InMemoryPayablesDataSource extends Live implements PayablesDataSource {
  invoices(schemeIds: string[]): Observable<InvoiceView[]> {
    return this.live(() => this.store.invoicesIn(schemeIds));
  }

  batches(schemeIds: string[]): Observable<BatchView[]> {
    return this.live(() => this.store.batchesIn(schemeIds));
  }

  createBatch(invoiceIds: string[]): Observable<string> {
    return this.command(() => this.store.createBatch(invoiceIds, this.by));
  }

  releaseBatch(batchId: string): Observable<void> {
    return this.command(() => this.store.releaseBatch(batchId, this.by));
  }
}
