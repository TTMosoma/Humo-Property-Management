import { Injectable } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import {
  AccountApprovalPolicy,
  AccountDecision,
  AccountPolicySetting,
  AccountRequestDataSource,
  AccountRequestView,
  AccountSubmission,
  AppNotification,
  NewAccountDetails,
  NotificationDataSource,
} from '../domain';
import { HttpPort } from './http-port';

/**
 * New customer accounts over HTTP (doc 21). The API decides whether a submission
 * waits for a System Administrator or is activated under delegated authority.
 */
@Injectable()
export class HttpAccountRequestDataSource extends HttpPort implements AccountRequestDataSource {
  list(): Observable<AccountRequestView[]> {
    return this.query<AccountRequestView[]>('/platform/account-requests', ['organisations', 'session']);
  }

  get(id: string): Observable<AccountRequestView | undefined> {
    return this.query<AccountRequestView>(`/platform/account-requests/${id}`, ['organisations', 'session']).pipe(
      catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))),
    );
  }

  submit(details: NewAccountDetails): Observable<AccountSubmission> {
    return this.command<AccountSubmission>('POST', '/platform/account-requests', details, ['organisations', 'notifications']);
  }

  decide(id: string, decision: AccountDecision, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/platform/account-requests/${id}/decision`, { ...decision, expectedVersion }, ['organisations', 'notifications']);
  }

  policy(): Observable<AccountPolicySetting> {
    return this.query<AccountPolicySetting>('/platform/account-policy', ['organisations']);
  }

  setPolicy(policy: AccountApprovalPolicy, reason: string, expectedVersion?: number): Observable<void> {
    return this.command('PUT', '/platform/account-policy', { policy, reason, expectedVersion }, ['organisations', 'notifications']);
  }
}

/** The bell over HTTP. Others' events arrive when the person acts or navigates (push comes later; docs/08 §5). */
@Injectable()
export class HttpNotificationDataSource extends HttpPort implements NotificationDataSource {
  list(): Observable<AppNotification[]> {
    return this.query<AppNotification[]>('/notifications', ['notifications', 'session', 'organisations']);
  }

  markRead(ids: string[]): Observable<void> {
    return this.command('POST', '/notifications/read', { ids }, ['notifications']);
  }
}
