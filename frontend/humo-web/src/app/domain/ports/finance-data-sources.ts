import { Observable } from 'rxjs';
import { BillingAction, BillingRun, BillingRunSummary, NewBillingRun, SchemeBillingStatus } from '../models/billing';
import { CollectionAction, CollectionView } from '../models/collections';
import { MeterEntry, MeterSheet } from '../models/meter';
import { LevyMethod, LevyRollProposal, LevySetting } from '../models/levy';
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
 *   GET   /collections/{accountId}/letters/{stepId}/pdf   a letter as sent (D7)
 */
export abstract class CollectionDataSource {
  abstract list(schemeIds: string[], query?: ListQuery): Observable<Page<CollectionView>>;
  abstract get(accountId: string): Observable<CollectionView | undefined>;
  abstract act(accountId: string, action: CollectionAction, expectedVersion?: number): Observable<void>;
  /** Sends a reminder to each account; returns how many were sent. */
  abstract remind(accountIds: string[], channel: 'email' | 'sms'): Observable<number>;
  /** Where a sent letter's stored PDF downloads from; undefined where there's no stored PDF (the simulation). */
  pdfUrl(_accountId: string, _stepId: string): string | undefined {
    return undefined;
  }
}

/**
 * Water meter readings (docs/22 §2, flag `meter-readings`, Billing.Run).
 *   GET   /schemes/{id}/meter-readings/{period}    the capture sheet
 *   PUT   /schemes/{id}/meter-readings/{period}    save readings (grid or CSV)
 *   PUT   /schemes/{id}/water-rate                 the rate per kl
 * Saving readings while that month's run is still Preparing updates the run's water charges.
 */
export abstract class MeterDataSource {
  abstract sheet(schemeId: string, period: string): Observable<MeterSheet>;
  /** Returns how many readings were saved. */
  abstract saveReadings(schemeId: string, period: string, readOn: string, entries: MeterEntry[]): Observable<number>;
  abstract setRate(schemeId: string, ratePerKl: number, reason: string, expectedVersion?: number): Observable<void>;
}

/**
 * How each scheme's levies are set (D13, docs/22 §3, flag `levy-model`, Billing.Run).
 *   GET   /schemes/{id}/levy-setting
 *   PUT   /schemes/{id}/levy-setting                 manual | budget (reason)
 *   GET   /schemes/{id}/levy-roll/proposal           from the approved budget
 *   POST  /schemes/{id}/levy-roll/apply              apply it from the next run (reason)
 */
export abstract class LevyDataSource {
  abstract setting(schemeId: string): Observable<LevySetting>;
  abstract setMethod(schemeId: string, method: LevyMethod, reason: string, expectedVersion?: number): Observable<void>;
  /** undefined when the scheme has no approved budget with a Levies income line. */
  abstract proposal(schemeId: string): Observable<LevyRollProposal | undefined>;
  /** Applies the proposed roll to every unit; returns how many levies changed. */
  abstract apply(schemeId: string, budgetId: string, reason: string, expectedVersion?: number): Observable<number>;
}
