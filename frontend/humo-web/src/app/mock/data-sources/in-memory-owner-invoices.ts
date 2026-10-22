import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { ApiError, NewOwnerInvoice, OwnerInvoice, OwnerInvoiceDataSource } from '../../domain';

/** SIMULATED (docs/18 R-14): the prototype doesn't issue owner invoices, so the list is empty and changes are refused. */
@Injectable()
export class InMemoryOwnerInvoiceDataSource extends OwnerInvoiceDataSource {
  list(): Observable<OwnerInvoice[]> {
    return of([]);
  }

  get(): Observable<OwnerInvoice | undefined> {
    return of(undefined);
  }

  issue(_input: NewOwnerInvoice): Observable<string> {
    return throwError(() => new ApiError('server', 'The demo doesn’t issue owner invoices.'));
  }

  recordPayment(): Observable<void> {
    return throwError(() => new ApiError('server', 'The demo doesn’t record payments on invoices.'));
  }

  send(): Observable<void> {
    return throwError(() => new ApiError('server', 'The demo doesn’t email invoices.'));
  }
}
