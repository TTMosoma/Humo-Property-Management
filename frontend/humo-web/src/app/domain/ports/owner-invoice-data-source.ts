import { Observable } from 'rxjs';
import { NewOwnerInvoice, OwnerInvoice } from '../models/owner-invoice';

/**
 * Basic invoicing (D17, the Essentials package): owner invoices, payments recorded by hand, and emailing the owner.
 *   GET   /api/owner-invoices?schemeIds=…
 *   GET   /api/owner-invoices/{id}
 *   POST  /api/owner-invoices                    issue (unitId, date, dueOn, lines)
 *   POST  /api/owner-invoices/{id}/payments      record a payment (amount, date, reference)
 *   POST  /api/owner-invoices/{id}/send          email the owner
 */
export abstract class OwnerInvoiceDataSource {
  abstract list(schemeIds: string[]): Observable<OwnerInvoice[]>;
  abstract get(id: string): Observable<OwnerInvoice | undefined>;
  /** Returns the new invoice's id. */
  abstract issue(input: NewOwnerInvoice): Observable<string>;
  abstract recordPayment(id: string, amount: number, date: string, reference?: string): Observable<void>;
  abstract send(id: string): Observable<void>;
}
