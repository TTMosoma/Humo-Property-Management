import { Injectable, inject } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { WorkItem, WorkItemDataSource } from '../../domain';
import { MockDb } from '../db/mock-db';
import { mockResponder } from '../mock-latency';

/** In-memory Attention store, backed by MockDb so other commands (e.g. allocations) can update work. */
@Injectable()
export class InMemoryWorkItemDataSource extends WorkItemDataSource {
  private readonly db = inject(MockDb);
  private readonly respond = mockResponder();

  watch(): Observable<WorkItem[]> {
    return this.db.changes$.pipe(map(() => this.db.workItems));
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
    return this.respond(null).pipe(
      tap(() => this.db.updateWork(ids, change)),
      map(() => undefined),
    );
  }
}
