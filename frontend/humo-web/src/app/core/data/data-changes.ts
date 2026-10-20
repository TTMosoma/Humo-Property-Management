import { Injectable } from '@angular/core';
import { Observable, Subject, filter, map, startWith, switchMap } from 'rxjs';

/**
 * How queries stay current once the data comes over HTTP.
 *
 * Every query port promises a *live* stream: it emits again when the data
 * behind it changes, so an allocation updates every open account view. The
 * in-memory adapters get that for free. The HTTP adapters keep the promise this way:
 *
 *   1. A command that succeeds announces what it changed:
 *        this.changes.notify('receipts', 'accounts');
 *   2. Queries re-fetch when a topic they depend on changes:
 *        list(ids) { return liveQuery(this.changes, ['receipts'], () => this.http.get(…)); }
 *   3. Changes made by *other people* arrive by push (SignalR) for the few
 *      places that need it — work items and notifications — and are fed into
 *      the same `notify`. Everything else refreshes on the person's own commands
 *      and on navigation.
 *
 * Commands return void or the new id; screens never patch their own copies.
 */
export type DataTopic =
  | 'session'
  | 'access'
  | 'audit'
  | 'organisations'
  | 'schemes'
  | 'units'
  | 'people'
  | 'accounts'
  | 'receipts'
  | 'jobs'
  | 'suppliers'
  | 'payables'
  | 'work-items'
  | 'billing'
  | 'notifications'
  | 'subscriptions'
  | 'quote-requests'
  | 'settings'
  | 'documents'
  | 'collections'
  | 'communications'
  | 'notices'
  | 'inbox';

@Injectable({ providedIn: 'root' })
export class DataChanges {
  private readonly changed = new Subject<Set<DataTopic>>();

  /** Called by HTTP adapters after a successful command (and by the push connection). */
  notify(...topics: DataTopic[]): void {
    this.changed.next(new Set(topics));
  }

  /** Emits whenever any of the topics changes. */
  on(topics: DataTopic[]): Observable<void> {
    return this.changed.pipe(
      filter((t) => topics.some((x) => t.has(x))),
      map(() => undefined),
    );
  }
}

/** A query that fetches now and again whenever one of its topics changes (latest request wins). */
export function liveQuery<T>(changes: DataChanges, topics: DataTopic[], fetch: () => Observable<T>): Observable<T> {
  return changes.on(topics).pipe(startWith(undefined), switchMap(fetch));
}
