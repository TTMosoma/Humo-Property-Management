import { Observable } from 'rxjs';
import { BillingAction, BillingRun, BillingRunSummary, NewBillingRun, SchemeBillingStatus } from '../models/billing';
import { CollectionAction, CollectionView } from '../models/collections';
import { ListQuery, Page } from './list-query';

/**
 * Billing runs:
 *   GET   /billing/status?schemeIds=…        each scheme's last posted run, current run and next period
 *   GET   /billing/runs?schemeIds=…
 *   GET   /billing/runs/{id}
 *   POST  /billing/runs                      prepare a run: the API calculates charges and detects exceptions
 *   POST  /billing/runs/{id}/actions         decide an exception, send for approval, post, send statements, cancel
 *
 * The API calculates every charge; the client never sends amounts. Posting is
 * only possible after approval (in Approvals) and locks the run.
 */
export abstract class BillingDataSource {
  abstract status(schemeIds: string[]): Observable<SchemeBillingStatus[]>;
  abstract runs(schemeIds: string[], query?: ListQuery): Observable<Page<BillingRunSummary>>;
  abstract get(id: string): Observable<(BillingRunSummary & { run: BillingRun }) | undefined>;
  /** Returns the new run's id. */
  abstract create(input: NewBillingRun): Observable<string>;
  abstract act(id: string, action: BillingAction, expectedVersion?: number): Observable<void>;
  /** A correction after posting: a journal on the account, never an edit to a run. */
  abstract adjust(accountId: string, amount: number, reason: string): Observable<void>;
}

/**
 * Credit control:
 *   GET   /collections?schemeIds=…           every account in arrears with its collection stage
 *   GET   /collections/{accountId}
 *   POST  /collections/{accountId}/actions   send a letter, ask for demand approval, hand over, arrangement, dispute, note
 *   POST  /collections/reminders             bulk reminders (the Compose pattern)
 */
export abstract class CollectionDataSource {
  abstract list(schemeIds: string[], query?: ListQuery): Observable<Page<CollectionView>>;
  abstract get(accountId: string): Observable<CollectionView | undefined>;
  abstract act(accountId: string, action: CollectionAction, expectedVersion?: number): Observable<void>;
  /** Sends a reminder to each account; returns how many were sent. */
  abstract remind(accountIds: string[], channel: 'email' | 'sms'): Observable<number>;
}
