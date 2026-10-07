import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { WorkItem, WorkItemDataSource } from '../../domain';
import { createWorkItems } from '../fixtures/work-items';
import { mockResponder } from '../mock-latency';

/** In-memory Attention store. Changes are kept for the browser session only. */
@Injectable()
export class InMemoryWorkItemDataSource extends WorkItemDataSource {
  private readonly respond = mockResponder();
  private readonly items$ = new BehaviorSubject<WorkItem[]>(createWorkItems());

  watch(): Observable<WorkItem[]> {
    return this.items$.asObservable();
  }

  complete(ids: string[], by: string): Observable<void> {
    return this.mutate(ids, (w) => ({ ...w, status: 'done', decidedBy: by, decidedAt: new Date().toISOString() }));
  }

  reopen(ids: string[]): Observable<void> {
    return this.mutate(ids, (w) => ({ ...w, status: 'open', decidedBy: undefined, decidedAt: undefined, comment: undefined }));
  }

  assign(ids: string[], assigneeId: string | null): Observable<void> {
    return this.mutate(ids, (w) => ({ ...w, assigneeId }));
  }

  decide(id: string, decision: 'approved' | 'rejected', by: string, comment?: string): Observable<void> {
    return this.mutate([id], (w) => ({ ...w, status: decision, decidedBy: by, decidedAt: new Date().toISOString(), comment }));
  }

  /** Applies a change only after the simulated request succeeds (so error mode leaves data untouched). */
  private mutate(ids: string[], change: (w: WorkItem) => WorkItem): Observable<void> {
    const set = new Set(ids);
    return this.respond(null).pipe(
      tap(() => this.items$.next(this.items$.value.map((w) => (set.has(w.id) ? change(w) : w)))),
      map(() => undefined),
    );
  }
}
