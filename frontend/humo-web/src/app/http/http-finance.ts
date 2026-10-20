import { Injectable, inject } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import {
  AccountDataSource,
  BillingAction,
  BillingDataSource,
  BillingRun,
  BillingRunSummary,
  LevyDataSource,
  LevyMethod,
  LevyRollProposal,
  LevySetting,
  MeterDataSource,
  MeterEntry,
  MeterSheet,
  NewBillingRun,
  SchemeBillingStatus,
  WorkItem,
  WorkItemDataSource,
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

/** Levy billing runs over HTTP (slice 2b; docs/11 §1). The API calculates every charge; approval happens in My work. */
@Injectable()
export class HttpBillingDataSource extends HttpPort implements BillingDataSource {
  private readonly accounts = inject(AccountDataSource) as HttpAccountDataSource;

  status(schemeIds: string[]): Observable<SchemeBillingStatus[]> {
    return this.live<SchemeBillingStatus[]>('/billing/status', ['billing', 'schemes', 'units'], { schemeIds });
  }

  runs(schemeIds: string[], query?: ListQuery): Observable<Page<BillingRunSummary>> {
    const params: Record<string, string | string[]> = { schemeIds };
    if (query?.page) params['page'] = String(query.page);
    if (query?.pageSize) params['pageSize'] = String(query.pageSize);
    return this.live<Page<BillingRunSummary>>('/billing/runs', ['billing'], params);
  }

  get(id: string): Observable<(BillingRunSummary & { run: BillingRun }) | undefined> {
    return orUndefined(this.live<BillingRunSummary & { run: BillingRun }>(`/billing/runs/${id}`, ['billing', 'work-items']));
  }

  create(input: NewBillingRun): Observable<string> {
    return this.createId('/billing/runs', input, ['billing']);
  }

  act(id: string, action: BillingAction, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/billing/runs/${id}/actions`, { action, expectedVersion }, ['billing', 'work-items', 'accounts']);
  }

  adjust(accountId: string, amount: number, reason: string): Observable<void> {
    return this.accounts.adjust(accountId, amount, reason);
  }
}

/** Water meter readings over HTTP (docs/22 §2). Setting a scheme's rate switches water recovery on. */
@Injectable()
export class HttpMeterDataSource extends HttpPort implements MeterDataSource {
  sheet(schemeId: string, period: string): Observable<MeterSheet> {
    return this.live<MeterSheet>(`/schemes/${schemeId}/meter-readings/${period}`, ['billing']);
  }

  saveReadings(schemeId: string, period: string, readOn: string, entries: MeterEntry[]): Observable<number> {
    return this.command<number>('PUT', `/schemes/${schemeId}/meter-readings/${period}`, { readOn, entries }, ['billing']);
  }

  setRate(schemeId: string, ratePerKl: number, reason: string, expectedVersion?: number): Observable<void> {
    return this.command('PUT', `/schemes/${schemeId}/water-rate`, { ratePerKl, reason, expectedVersion }, ['billing']);
  }
}

/** How levies are set (D13). Deriving them from the budget waits for budgets on the API. */
@Injectable()
export class HttpLevyDataSource extends HttpPort implements LevyDataSource {
  setting(schemeId: string): Observable<LevySetting> {
    return this.live<LevySetting>(`/schemes/${schemeId}/levy-setting`, ['billing']);
  }

  setMethod(schemeId: string, method: LevyMethod, reason: string, expectedVersion?: number): Observable<void> {
    return this.command('PUT', `/schemes/${schemeId}/levy-setting`, { method, reason, expectedVersion }, ['billing']);
  }

  proposal(schemeId: string): Observable<LevyRollProposal | undefined> {
    return orUndefined(this.live<LevyRollProposal>(`/schemes/${schemeId}/levy-roll/proposal`, ['billing']));
  }

  apply(schemeId: string, budgetId: string, reason: string, expectedVersion?: number): Observable<number> {
    return this.command<number>('POST', `/schemes/${schemeId}/levy-roll/apply`, { budgetId, reason, expectedVersion }, ['billing', 'units']);
  }
}

/** My work over HTTP: approvals and tasks in the person's schemes, re-fetched whenever work changes. */
@Injectable()
export class HttpWorkItemDataSource extends HttpPort implements WorkItemDataSource {
  watch(): Observable<WorkItem[]> {
    return this.live<WorkItem[]>('/work-items', ['work-items', 'billing', 'receipts', 'session']);
  }

  complete(ids: string[]): Observable<void> {
    return this.command('POST', '/work-items/complete', { ids }, ['work-items']);
  }

  reopen(ids: string[]): Observable<void> {
    return this.command('POST', '/work-items/reopen', { ids }, ['work-items']);
  }

  assign(ids: string[], assigneeId: string | null): Observable<void> {
    return this.command('POST', '/work-items/assign', { ids, assigneeId }, ['work-items']);
  }

  /** Approving a large amount needs a fresh passkey (the agency's threshold); the API checks who may decide. */
  decide(id: string, decision: 'approved' | 'rejected', _by: string, comment?: string): Observable<void> {
    return this.command('POST', `/work-items/${id}/decision`, { decision, comment }, ['work-items', 'billing']);
  }
}
