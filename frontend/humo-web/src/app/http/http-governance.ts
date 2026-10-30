import { Injectable } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import {
  Assignee,
  ListQuery,
  MeetingAction,
  MeetingDataSource,
  MeetingDetail,
  MeetingSummary,
  NewMeeting,
  Page,
  ResolutionDataSource,
  ResolutionView,
  WrittenResolutionInput,
} from '../domain';
import { HttpPort } from './http-port';

const TOPICS = ['meetings', 'work-items', 'budgets'] as const;

/**
 * Governance › Meetings over HTTP: the API runs the lifecycle (what each stage allows), the notice period and quorum,
 * emails the notice to the trustees or owners, and turns each resolution's actions into tasks in My work.
 */
@Injectable()
export class HttpMeetingDataSource extends HttpPort implements MeetingDataSource {
  list(schemeIds: string[], query?: ListQuery): Observable<Page<MeetingSummary>> {
    const params: Record<string, string | string[]> = { schemeIds };
    if (query?.page) params['page'] = String(query.page);
    if (query?.pageSize) params['pageSize'] = String(query.pageSize);
    if (query?.filters?.['view']) params['view'] = String(query.filters['view']);
    return this.live<Page<MeetingSummary>>('/meetings', [...TOPICS], params);
  }

  get(id: string): Observable<MeetingDetail | undefined> {
    return this.live<MeetingDetail>(`/meetings/${id}`, [...TOPICS]).pipe(catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))));
  }

  create(input: NewMeeting): Observable<string> {
    return this.createId('/meetings', input, ['meetings']);
  }

  act(id: string, action: MeetingAction, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/meetings/${id}/actions`, { action, expectedVersion }, [...TOPICS]);
  }
}

/** The resolutions register and written resolutions over HTTP: the trustees decide a written one in My work. */
@Injectable()
export class HttpResolutionDataSource extends HttpPort implements ResolutionDataSource {
  list(schemeIds: string[], query?: ListQuery): Observable<Page<ResolutionView>> {
    const params: Record<string, string | string[]> = { schemeIds };
    if (query?.page) params['page'] = String(query.page);
    if (query?.pageSize) params['pageSize'] = String(query.pageSize);
    return this.live<Page<ResolutionView>>('/resolutions', [...TOPICS], params);
  }

  proposeWritten(input: WrittenResolutionInput): Observable<string> {
    return this.createId('/resolutions/written', input, ['meetings', 'work-items']);
  }

  assignees(schemeIds: string[]): Observable<Assignee[]> {
    return this.live<Assignee[]>('/resolutions/assignees', ['access', 'meetings'], { schemeIds });
  }
}
