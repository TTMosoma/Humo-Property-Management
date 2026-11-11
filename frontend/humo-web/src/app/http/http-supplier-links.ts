import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { ApiError, SupplierLinkDataSource, SupplierLinkView } from '../domain';
import { toApiErrorFromHttp } from './http-port';
import { API_BASE_URL } from './http-session-data-source';

/** D38: the supplier's link over HTTP. No session: the code in the address is the key. */
@Injectable()
export class HttpSupplierLinkDataSource implements SupplierLinkDataSource {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  private url(token: string, rest = ''): string {
    return `${this.base}/supplier-links/${encodeURIComponent(token)}${rest}`;
  }

  view(token: string): Observable<SupplierLinkView | undefined> {
    return this.http.get<SupplierLinkView>(this.url(token)).pipe(
      catchError((e: unknown) => {
        const error = toApiErrorFromHttp(e);
        return error instanceof ApiError && error.kind === 'not-found' ? of(undefined) : throwError(() => error);
      }),
    );
  }

  photoUrl(token: string, photoId: string): string {
    return this.url(token, `/photos/${encodeURIComponent(photoId)}`);
  }

  quote(token: string, input: { amount: number; guaranteeMonths?: number; notes?: string }, file?: File): Observable<void> {
    const form = new FormData();
    form.append('amount', String(input.amount));
    if (input.guaranteeMonths !== undefined) form.append('guaranteeMonths', String(input.guaranteeMonths));
    if (input.notes) form.append('notes', input.notes);
    if (file) form.append('file', file, file.name);
    return this.post(token, '/quote', form);
  }

  decline(token: string, reason: string): Observable<void> {
    return this.post(token, '/decline', { reason });
  }

  confirm(token: string): Observable<void> {
    return this.post(token, '/confirm', {});
  }

  reschedule(token: string, date: string, note: string): Observable<void> {
    return this.post(token, '/reschedule', { date, note });
  }

  private post(token: string, path: string, body: unknown): Observable<void> {
    return this.http.post(this.url(token, path), body).pipe(
      map(() => undefined),
      catchError((e: unknown) => throwError(() => toApiErrorFromHttp(e))),
    );
  }
}
