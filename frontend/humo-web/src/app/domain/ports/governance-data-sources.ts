import { Observable } from 'rxjs';
import { Assignee, MeetingAction, MeetingDetail, MeetingSummary, NewMeeting, ResolutionView, WrittenResolutionInput } from '../models/meeting';
import { ListQuery, Page } from './list-query';

/**
 * Meetings:
 *   GET   /meetings?schemeIds=…&filters[view]=upcoming|held|all
 *   GET   /meetings/{id}
 *   POST  /meetings                          schedule (Meetings.Manage)
 *   POST  /meetings/{id}/actions             lifecycle commands (send notice, record attendance, add resolution, …)
 *
 * The API enforces the lifecycle (what can happen at each stage), the notice
 * period, quorum and the Governance entitlement. Commands carry the meeting's
 * version (409 on conflict).
 */
export abstract class MeetingDataSource {
  abstract list(schemeIds: string[], query?: ListQuery): Observable<Page<MeetingSummary>>;
  abstract get(id: string): Observable<MeetingDetail | undefined>;
  /** Returns the new meeting's id. */
  abstract create(input: NewMeeting): Observable<string>;
  abstract act(id: string, action: MeetingAction, expectedVersion?: number): Observable<void>;
}

/**
 * Resolutions register (a view over resolutions) and written resolutions:
 *   GET   /resolutions?schemeIds=…&filters[progress]=…
 *   POST  /resolutions/written               propose; the trustees decide it in Approvals
 */
export abstract class ResolutionDataSource {
  abstract list(schemeIds: string[], query?: ListQuery): Observable<Page<ResolutionView>>;
  /** Returns the new resolution's reference. */
  abstract proposeWritten(input: WrittenResolutionInput): Observable<string>;
  /** Who actions can be given to across these schemes: agency staff, and trustees with a Humo sign-in. */
  abstract assignees(schemeIds: string[]): Observable<Assignee[]>;
}
