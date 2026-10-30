import { Injectable } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import { ReportDataSource, ReportDef, ReportId, ReportParams, ReportResult } from '../domain';
import { HttpPort } from './http-port';

/**
 * Reports over HTTP: the catalogue the person may run (permission and plan), and each report worked out by the API
 * from live records. The page sorts, prints and exports it as CSV in the browser.
 */
@Injectable()
export class HttpReportDataSource extends HttpPort implements ReportDataSource {
  catalogue(): Observable<ReportDef[]> {
    return this.live<ReportDef[]>('/reports', ['session']);
  }

  run(id: ReportId, params: ReportParams): Observable<ReportResult | undefined> {
    const query: Record<string, string | string[]> = { schemeIds: params.schemeIds };
    if (params.months) query['months'] = String(params.months);
    return this.live<ReportResult>(`/reports/${id}`, ['accounts', 'receipts', 'billing', 'collections', 'jobs', 'suppliers', 'payables', 'units', 'schemes'], query).pipe(
      catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))),
    );
  }
}
