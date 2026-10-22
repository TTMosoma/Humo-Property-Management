import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { NewOwnerInvoice, OwnerInvoice, OwnerInvoiceDataSource } from '../domain';
import { HttpPort } from './http-port';

/** Basic invoicing over HTTP (D17). Writes come with the feature check and the billing permissions on the API. */
@Injectable()
export class HttpOwnerInvoiceDataSource extends HttpPort implements OwnerInvoiceDataSource {
  list(schemeIds: string[]): Observable<OwnerInvoice[]> {
    return this.live<OwnerInvoice[]>('/owner-invoices', ['billing'], { schemeIds });
  }

  get(id: string): Observable<OwnerInvoice | undefined> {
    return this.live<OwnerInvoice>(`/owner-invoices/${encodeURIComponent(id)}`, ['billing']);
  }

  issue(input: NewOwnerInvoice): Observable<string> {
    return this.createId('/owner-invoices', input, ['billing']);
  }

  recordPayment(id: string, amount: number, date: string, reference?: string): Observable<void> {
    return this.command('POST', `/owner-invoices/${encodeURIComponent(id)}/payments`, { amount, date, reference: reference ?? null }, ['billing']);
  }

  send(id: string): Observable<void> {
    return this.command('POST', `/owner-invoices/${encodeURIComponent(id)}/send`, null, ['billing']);
  }
}
