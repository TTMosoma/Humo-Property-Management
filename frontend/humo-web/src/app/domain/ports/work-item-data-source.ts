import { Observable } from 'rxjs';
import { WorkItem } from '../models/work-item';

/**
 * Port: the Attention model's store.
 * `watch()` is a live stream: it emits again after every change, so badges,
 * queues and the dashboard stay in sync without re-fetching.
 */
export abstract class WorkItemDataSource {
  abstract watch(): Observable<WorkItem[]>;
  abstract complete(ids: string[], by: string): Observable<void>;
  abstract reopen(ids: string[]): Observable<void>;
  abstract assign(ids: string[], assigneeId: string | null): Observable<void>;
  abstract decide(id: string, decision: 'approved' | 'rejected', by: string, comment?: string): Observable<void>;
}
