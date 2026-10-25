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
  /** `alone`: approve alone under the trustees' permission (D24), held for the 24-hour cooling-off. */
  abstract decide(id: string, decision: 'approved' | 'rejected', by: string, comment?: string, alone?: boolean): Observable<void>;
  /** Stops an approval in its cooling-off: it waits for a decision again. */
  abstract cancelHold(id: string): Observable<void>;
}
