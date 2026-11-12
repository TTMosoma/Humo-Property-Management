import { Observable } from 'rxjs';

/** D38: a quote request or work order, as the supplier sees it through their emailed link. */
export interface SupplierLinkView {
  kind: 'quote' | 'work-order';
  /** The supplier can still act; otherwise `closedReason` says why. */
  open: boolean;
  closedReason?: string;
  supplier: string;
  agency: string;
  scheme: string;
  /** Suburb and city: all a quote request shows of where. */
  area: string;
  /** The address, on a work order only. */
  where?: string;
  jobRef: string;
  title: string;
  description: string;
  category: string;
  photos: { id: string; caption: string }[];
  quote?: { status: string; amount?: number; guaranteeMonths?: number; notes?: string; rejectedReason?: string; hasFile: boolean };
  workOrder?: { scheduledFor: string; accessNotes?: string; confirmedAt?: string; askedFor?: string };
}

/**
 * D38: the supplier's side of a quote request or work order. No sign-in: the link's code is the key.
 *   GET  /supplier-links/{token}, /photos/{id}
 *   POST /supplier-links/{token}/quote (multipart), /decline, /confirm, /reschedule
 */
export abstract class SupplierLinkDataSource {
  abstract view(token: string): Observable<SupplierLinkView | undefined>;
  abstract photoUrl(token: string, photoId: string): string | undefined;
  abstract quote(token: string, input: { amount: number; guaranteeMonths?: number; notes?: string }, file?: File): Observable<void>;
  abstract decline(token: string, reason: string): Observable<void>;
  abstract confirm(token: string): Observable<void>;
  abstract reschedule(token: string, date: string, note: string): Observable<void>;
}
