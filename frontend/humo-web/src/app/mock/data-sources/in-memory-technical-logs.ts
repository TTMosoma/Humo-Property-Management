import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { ApiError, TechnicalLogDataSource, TechnicalLogResult } from '../../domain';

/** The prototype has no server, so it has no logs to show. Nothing is made up. */
@Injectable()
export class InMemoryTechnicalLogDataSource implements TechnicalLogDataSource {
  query(): Observable<TechnicalLogResult> {
    return of({ entries: [], matched: 0 });
  }

  download(): Observable<string> {
    return throwError(() => new ApiError('validation', 'There’s no log for that day.', { date: 'There’s no log for that day.' }));
  }
}
