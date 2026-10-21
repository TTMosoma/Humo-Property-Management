import { Injectable } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import {
  JobAction,
  JobDataSource,
  JobDetail,
  JobSummary,
  ListQuery,
  NewJobInput,
  Page,
  SupplierDataSource,
  SupplierDetail,
  SupplierDetails,
  SupplierStatus,
  SupplierSummary,
} from '../domain';
import { HttpPort } from './http-port';

const orUndefined = <T>(source: Observable<T>): Observable<T | undefined> =>
  source.pipe(catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))));

/**
 * Maintenance jobs over HTTP (slice 3a): report, triage, quotes, approval within delegated authority or by the trustees
 * (My work › Approvals), work order, completion, the resident's confirmation, and the supplier's invoice.
 */
@Injectable()
export class HttpJobDataSource extends HttpPort implements JobDataSource {
  list(schemeIds: string[], query?: ListQuery): Observable<Page<JobSummary>> {
    const params: Record<string, string | string[]> = { schemeIds };
    if (query?.page) params['page'] = String(query.page);
    if (query?.pageSize) params['pageSize'] = String(query.pageSize);
    return this.live<Page<JobSummary>>('/jobs', ['jobs', 'suppliers'], params);
  }

  get(ref: string): Observable<JobDetail | undefined> {
    return orUndefined(this.live<JobDetail>(`/jobs/${ref}`, ['jobs', 'suppliers', 'work-items', 'payables']));
  }

  search(query: string, schemeIds: string[], limit?: number): Observable<JobSummary[]> {
    return this.live<JobSummary[]>('/jobs/search', ['jobs'], { q: query, schemeIds, ...(limit ? { limit: String(limit) } : {}) });
  }

  /** The signed-in resident's own requests (the API works out who and which unit). */
  forResident(): Observable<JobSummary[]> {
    return this.live<JobSummary[]>('/me/jobs', ['jobs', 'session']);
  }

  create(input: NewJobInput): Observable<string> {
    return this.createId('/jobs', input, ['jobs', 'work-items']);
  }

  act(ref: string, action: JobAction, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/jobs/${ref}/actions`, { action, expectedVersion }, ['jobs', 'work-items', 'suppliers', 'payables']);
  }
}

/** The agency's suppliers over HTTP: vetting, contact, status, and bank details (a fresh passkey to change). */
@Injectable()
export class HttpSupplierDataSource extends HttpPort implements SupplierDataSource {
  list(schemeIds: string[]): Observable<SupplierSummary[]> {
    return this.live<SupplierSummary[]>('/suppliers', ['suppliers', 'jobs'], { schemeIds });
  }

  get(id: string): Observable<SupplierDetail | undefined> {
    return orUndefined(this.live<SupplierDetail>(`/suppliers/${id}`, ['suppliers', 'jobs', 'payables']));
  }

  search(query: string, limit?: number): Observable<SupplierSummary[]> {
    return this.live<SupplierSummary[]>('/suppliers/search', ['suppliers'], { q: query, ...(limit ? { limit: String(limit) } : {}) });
  }

  requestDocument(supplierId: string, type: string): Observable<void> {
    return this.command('POST', `/suppliers/${supplierId}/documents/request`, { type }, ['suppliers']);
  }

  create(details: SupplierDetails): Observable<string> {
    return this.createId('/suppliers', details, ['suppliers']);
  }

  update(id: string, details: SupplierDetails, expectedVersion?: number): Observable<void> {
    return this.command('PUT', `/suppliers/${id}`, { ...details, expectedVersion }, ['suppliers', 'jobs']);
  }

  setStatus(id: string, status: SupplierStatus, reason: string, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/suppliers/${id}/status`, { status, reason, expectedVersion }, ['suppliers', 'jobs']);
  }

  changeBankDetails(supplierId: string): Observable<void> {
    return this.command('POST', `/suppliers/${supplierId}/bank-details`, {}, ['suppliers']);
  }

  linkParty(input: Parameters<SupplierDataSource['linkParty']>[0]): Observable<string> {
    return this.createId('/suppliers/link-party', input, ['suppliers']);
  }
}
