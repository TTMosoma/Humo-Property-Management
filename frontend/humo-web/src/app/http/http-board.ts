import { Injectable } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import { BoardAction, BoardCandidate, BoardDataSource, BoardSummary, BoardView } from '../domain';
import { HttpPort } from './http-port';

/**
 * The trustee board over HTTP (slice 1, D2). Appointing a trustee with a Humo
 * sign-in grants trustee access; ending the term takes it away, so access lists refresh too.
 * Until the governance slice, an election cites its resolution by reference.
 */
@Injectable()
export class HttpBoardDataSource extends HttpPort implements BoardDataSource {
  list(schemeIds: string[]): Observable<BoardSummary[]> {
    return this.query<BoardSummary[]>('/boards', ['people', 'access', 'schemes', 'session'], { schemeIds });
  }

  get(schemeId: string): Observable<BoardView | undefined> {
    return this.query<BoardView>(`/boards/${schemeId}`, ['people', 'access', 'schemes', 'session']).pipe(
      catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))),
    );
  }

  candidates(schemeId: string): Observable<BoardCandidate[]> {
    return this.query<BoardCandidate[]>(`/boards/${schemeId}/candidates`, ['people']);
  }

  act(schemeId: string, action: BoardAction): Observable<void> {
    return this.command('POST', `/boards/${schemeId}/actions`, action, ['people', 'access', 'session']);
  }
}
