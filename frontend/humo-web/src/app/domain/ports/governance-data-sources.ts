import { Observable } from 'rxjs';
import { Assignee, MeetingAction, MeetingDetail, MeetingSummary, NewMeeting, ResolutionView, WrittenResolutionInput } from '../models/meeting';
import { BoardAction, BoardCandidate, BoardSummary, BoardView } from '../models/board';
import { BreachAction, BreachView, NewBreach, RuleAction, RulesView } from '../models/rules';
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

/**
 * Trustee boards:
 *   GET   /boards?schemeIds=…                 a summary per scheme
 *   GET   /boards/{schemeId}                  the board, former trustees and candidates
 *   POST  /boards/{schemeId}/actions          appoint, end a term, change a portfolio (Meetings.Manage)
 *
 * The API checks the person owns a unit in the scheme, and that an election
 * cites a passed resolution of that scheme.
 */
export abstract class BoardDataSource {
  abstract list(schemeIds: string[]): Observable<BoardSummary[]>;
  abstract get(schemeId: string): Observable<BoardView | undefined>;
  abstract candidates(schemeId: string): Observable<BoardCandidate[]>;
  abstract act(schemeId: string, action: BoardAction): Observable<void>;
}

/**
 * Scheme rules and the breach log:
 *   GET   /rules/{schemeId}                   the register, and when owners last got a copy
 *   POST  /rules/{schemeId}/actions           add, amend, repeal (each cites a resolution); share (Meetings.Manage)
 *   GET   /breaches?schemeIds=…
 *   GET   /breaches/{id}
 *   POST  /breaches                           log (Rules.Enforce)
 *   POST  /breaches/{id}/actions              warn, note, refer to the trustees, resolve (Rules.Enforce)
 */
export abstract class RulesDataSource {
  abstract rules(schemeId: string): Observable<RulesView | undefined>;
  abstract actRules(schemeId: string, action: RuleAction): Observable<string | void>;
  abstract breaches(schemeIds: string[]): Observable<BreachView[]>;
  abstract breach(id: string): Observable<BreachView | undefined>;
  abstract logBreach(input: NewBreach): Observable<string>;
  abstract actBreach(id: string, action: BreachAction, expectedVersion?: number): Observable<void>;
}
