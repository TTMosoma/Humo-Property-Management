import { Injectable } from '@angular/core';
import { Observable, catchError, from, map, switchMap, tap, throwError } from 'rxjs';
import { BatchView, InvoiceView, PayablesDataSource } from '../domain';
import { problemFromBlob } from './http-audit-security';
import { HttpPort, toApiErrorFromHttp } from './http-port';

/**
 * Finance › Payables over HTTP (slice 3b, D27): approved invoices go into payment batches; someone other than the
 * preparer approves them in My work and releases them with a passkey, which downloads the payment file for internet
 * banking. The API marks the invoices paid and emails each supplier a remittance.
 */
@Injectable()
export class HttpPayablesDataSource extends HttpPort implements PayablesDataSource {
  invoices(schemeIds: string[]): Observable<InvoiceView[]> {
    return this.live<InvoiceView[]>('/payables/invoices', ['payables', 'jobs', 'suppliers', 'work-items'], { schemeIds });
  }

  batches(schemeIds: string[]): Observable<BatchView[]> {
    return this.live<BatchView[]>('/payables/batches', ['payables', 'work-items'], { schemeIds });
  }

  createBatch(invoiceIds: string[]): Observable<string> {
    return this.createId('/payables/batches', { invoiceIds }, ['payables', 'jobs', 'work-items']);
  }

  releaseBatch(batchId: string, expectedVersion?: number): Observable<string> {
    return this.download(`/payables/batches/${batchId}/release`, { expectedVersion });
  }

  paymentFile(batchId: string): Observable<string> {
    return this.download(`/payables/batches/${batchId}/payment-file`, {});
  }

  cancelBatch(batchId: string, reason: string, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/payables/batches/${batchId}/cancel`, { reason, expectedVersion }, ['payables', 'jobs', 'work-items']);
  }

  /** Saves the payment file in the browser and returns its name. */
  private download(path: string, body: unknown): Observable<string> {
    return this.http.post(`${this.base}${path}`, body, { withCredentials: true, observe: 'response', responseType: 'blob' }).pipe(
      map((res) => {
        const name = decodeURIComponent(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'payments.csv');
        const url = URL.createObjectURL(res.body!);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return name;
      }),
      tap(() => this.dataChanges.notify('payables', 'jobs', 'suppliers', 'audit')),
      catchError((e: unknown) => from(problemFromBlob(e)).pipe(switchMap((err) => throwError(() => toApiErrorFromHttp(err))))),
    );
  }
}
