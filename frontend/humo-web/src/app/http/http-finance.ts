import { Injectable } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import {
  AccountDataSource,
  AccountDetail,
  ApiError,
  ListQuery,
  MatchView,
  NewReceipt,
  Page,
  ReceiptDataSource,
  ReceiptView,
  StatementImportBatch,
  StatementImportResult,
  StatementMapping,
  StatementPreview,
  StatementView,
} from '../domain';
import { HttpPort, toApiErrorFromHttp } from './http-port';

const orUndefined = <T>(source: Observable<T>): Observable<T | undefined> =>
  source.pipe(catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))));

/**
 * Levy accounts over HTTP (slice 2a): the ledger with running balances, ageing from the actual
 * transactions, and its status. Statements come with slice 2c (PDF and data snapshot, D7).
 */
@Injectable()
export class HttpAccountDataSource extends HttpPort implements AccountDataSource {
  get(accountId: string): Observable<AccountDetail | undefined> {
    return orUndefined(this.live<AccountDetail>(`/accounts/${accountId}`, ['accounts', 'receipts']));
  }

  statement(): Observable<StatementView | undefined> {
    return throwError(() => new ApiError('server', 'Statements arrive with slice 2c'));
  }

  sendStatement(): Observable<string> {
    return throwError(() => new ApiError('server', 'Statements arrive with slice 2c'));
  }

  /** A journal adjustment (Billing.Run): positive charges, negative credits. Part of BillingDataSource, connected ahead of the billing run. */
  adjust(accountId: string, amount: number, reason: string): Observable<void> {
    return this.command('POST', `/accounts/${accountId}/adjustments`, { amount, reason }, ['accounts']);
  }
}

/** Receipts over HTTP (slice 2a; docs/22 §1): capture, bank-statement import, matching with reasons and allocation. */
@Injectable()
export class HttpReceiptDataSource extends HttpPort implements ReceiptDataSource {
  list(schemeIds: string[], query?: ListQuery): Observable<Page<ReceiptView>> {
    const params: Record<string, string | string[]> = { schemeIds };
    if (query?.page) params['page'] = String(query.page);
    if (query?.pageSize) params['pageSize'] = String(query.pageSize);
    return this.live<Page<ReceiptView>>('/receipts', ['receipts'], params);
  }

  matches(receiptId: string): Observable<MatchView[]> {
    return this.live<MatchView[]>(`/receipts/${receiptId}/matches`, ['receipts', 'accounts']);
  }

  suggestedFor(accountId: string): Observable<ReceiptView[]> {
    return this.live<ReceiptView[]>(`/accounts/${accountId}/suggested-receipts`, ['receipts']);
  }

  allocate(receiptId: string, allocations: { accountId: string; amount: number }[], rememberPayer: boolean, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/receipts/${receiptId}/allocate`, { allocations, rememberPayer, expectedVersion }, ['receipts', 'accounts', 'units', 'people']);
  }

  unallocate(receiptId: string, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/receipts/${receiptId}/unallocate`, { expectedVersion }, ['receipts', 'accounts', 'units', 'people']);
  }

  moveToSuspense(receiptId: string, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/receipts/${receiptId}/suspense`, { expectedVersion }, ['receipts']);
  }

  capture(input: NewReceipt): Observable<string> {
    return this.createId('/receipts', input, ['receipts']);
  }

  statementMapping(schemeId: string): Observable<StatementMapping | undefined> {
    return orUndefined(this.http.get<StatementMapping>(`${this.base}/schemes/${schemeId}/statement-mapping`, { withCredentials: true }).pipe(catchError((e) => throwError(() => toApiErrorFromHttp(e)))));
  }

  /** Changes nothing: what importing this file would do. */
  previewStatement(schemeId: string, fileName: string, csv: string, mapping: StatementMapping): Observable<StatementPreview> {
    return this.http
      .post<StatementPreview>(`${this.base}/schemes/${schemeId}/statements/preview`, { fileName, csv, mapping }, { withCredentials: true })
      .pipe(catchError((e) => throwError(() => toApiErrorFromHttp(e))));
  }

  importStatement(schemeId: string, fileName: string, csv: string, mapping: StatementMapping): Observable<StatementImportResult> {
    return this.command<StatementImportResult>('POST', `/schemes/${schemeId}/statements/import`, { fileName, csv, mapping }, ['receipts']);
  }

  imports(schemeIds: string[]): Observable<StatementImportBatch[]> {
    return this.live<StatementImportBatch[]>('/statement-imports', ['receipts'], { schemeIds });
  }

  remove(receiptId: string, reason: string, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/receipts/${receiptId}/remove`, { reason, expectedVersion }, ['receipts']);
  }
}
