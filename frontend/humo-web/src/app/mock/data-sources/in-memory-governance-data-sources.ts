import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import {
  Assignee,
  ListQuery,
  MEETING_TYPE_LABELS,
  MeetingAction,
  MeetingDataSource,
  MeetingDetail,
  MeetingSummary,
  NewMeeting,
  Page,
  ResolutionDataSource,
  ResolutionView,
  WrittenResolutionInput,
} from '../../domain';
import { GovernanceStore } from '../db/governance-store';
import { MockDb } from '../db/mock-db';
import { mockResponder } from '../mock-latency';
import { toPage } from '../mock-page';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

const VERB: Record<MeetingAction['type'], string> = {
  'add-agenda-item': 'Added an agenda item to',
  'remove-agenda-item': 'Removed an agenda item from',
  reschedule: 'Rescheduled',
  'send-notice': 'Sent notice of',
  'pack-ready': 'Finalised the pack for',
  'record-attendance': 'Recorded attendance at',
  'record-minute': 'Recorded a minute for',
  'add-resolution': 'Recorded a resolution at',
  'send-minutes-for-approval': 'Sent for approval the minutes of',
  cancel: 'Cancelled',
  comment: 'Commented on',
};

/** Live reads over the governance store (MockDb's change stream drives them). */
@Injectable()
export class InMemoryMeetingDataSource extends MeetingDataSource {
  private readonly store = inject(GovernanceStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  list(schemeIds: string[], query?: ListQuery): Observable<Page<MeetingSummary>> {
    return this.db.changes$.pipe(
      switchMap(() => {
        const view = query?.filters?.['view'] ?? 'all';
        const held = ['held', 'minutes-draft', 'minutes-approved'];
        const items = this.store.meetings
          .filter((m) => schemeIds.includes(m.schemeId))
          .filter((m) => (view === 'upcoming' ? !held.includes(m.stage) && m.stage !== 'cancelled' : view === 'held' ? held.includes(m.stage) : true))
          .sort((a, b) => (view === 'upcoming' ? a.scheduledFor.localeCompare(b.scheduledFor) : b.scheduledFor.localeCompare(a.scheduledFor)))
          .map((m) => this.store.summary(m));
        return this.respond(toPage(items, query));
      }),
    );
  }

  get(id: string): Observable<MeetingDetail | undefined> {
    return this.db.changes$.pipe(
      switchMap(() => {
        const m = this.store.meetings.find((x) => x.id === id || x.ref === id);
        return this.respond(m ? this.store.detail(m) : undefined);
      }),
    );
  }

  create(input: NewMeeting): Observable<string> {
    return this.gateway.command(
      {
        action: `Scheduled a ${MEETING_TYPE_LABELS[input.type].toLowerCase()}`,
        resource: 'Meeting',
        schemeId: input.schemeId,
        permission: 'Meetings.Manage',
        feature: 'governance',
        validate: () => {
          const e: Record<string, string> = {};
          if (!input.schemeId) e['schemeId'] = 'Choose the scheme.';
          if (Number.isNaN(Date.parse(input.scheduledFor))) e['date'] = 'Choose a date.';
          else if (new Date(input.scheduledFor).getTime() < Date.now()) e['date'] = 'Choose a date in the future.';
          if (!input.venue.trim()) e['venue'] = 'Where is it held? A room, or “Online”.';
          return Object.keys(e).length ? e : null;
        },
      },
      () => this.store.create(input, this.auth.current.identity.name),
    );
  }

  act(id: string, action: MeetingAction, expectedVersion?: number): Observable<void> {
    const m = this.store.meetings.find((x) => x.id === id);
    return this.gateway
      .command(
        {
          action: `${VERB[action.type]} ${m?.title ?? id}`,
          resource: 'Meeting',
          resourceId: m?.ref ?? id,
          schemeId: m?.schemeId,
          permission: 'Meetings.Manage',
          feature: 'governance',
          version: { expected: expectedVersion, current: m?.version },
          validate: () => (m ? this.store.check(m, action) : { id: 'This meeting no longer exists.' }),
        },
        () => this.store.act(id, action, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }
}

@Injectable()
export class InMemoryResolutionDataSource extends ResolutionDataSource {
  private readonly store = inject(GovernanceStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  list(schemeIds: string[], query?: ListQuery): Observable<Page<ResolutionView>> {
    return this.db.changes$.pipe(
      switchMap(() => {
        const items = this.store.resolutions
          .filter((r) => schemeIds.includes(r.schemeId))
          .sort((a, b) => (b.decidedAt ?? b.proposedAt).localeCompare(a.decidedAt ?? a.proposedAt) || b.number - a.number)
          .map((r) => this.store.view(r));
        return this.respond(toPage(items, query));
      }),
    );
  }

  assignees(schemeIds: string[]): Observable<Assignee[]> {
    const all = schemeIds.flatMap((id) => this.store.assignees(id));
    return this.respond(all.filter((a, i) => all.findIndex((b) => b.id === a.id) === i));
  }

  proposeWritten(input: WrittenResolutionInput): Observable<string> {
    return this.gateway.command(
      {
        action: `Proposed a written resolution: ${input.title.trim()}`,
        resource: 'Resolution',
        schemeId: input.schemeId,
        permission: 'Meetings.Manage',
        feature: 'governance',
        validate: () => this.store.checkWritten(input),
      },
      () => this.store.proposeWritten(input, this.auth.current.identity.name),
    );
  }
}
