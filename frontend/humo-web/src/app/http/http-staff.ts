import { Injectable } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import { NewCover, StaffDataSource, StaffDetail, StaffSummary } from '../domain';
import { HttpPort } from './http-port';

/**
 * Staff over HTTP: the agency's team with each person's workload from My work, and away cover. While someone is away
 * the API moves their open tasks and messages (and new work assigned to them) to the colleague covering, and back after.
 */
@Injectable()
export class HttpStaffDataSource extends HttpPort implements StaffDataSource {
  list(): Observable<StaffSummary[]> {
    return this.live<StaffSummary[]>('/staff', ['staff', 'work-items', 'access']);
  }

  get(staffId: string): Observable<StaffDetail | undefined> {
    return this.live<StaffDetail>(`/staff/${staffId}`, ['staff', 'work-items', 'access']).pipe(
      catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))),
    );
  }

  setCover(staffId: string, cover: NewCover): Observable<void> {
    return this.command('PUT', `/staff/${staffId}/cover`, cover, ['staff', 'work-items']);
  }

  endCover(staffId: string): Observable<void> {
    return this.command('DELETE', `/staff/${staffId}/cover`, undefined, ['staff', 'work-items']);
  }
}
