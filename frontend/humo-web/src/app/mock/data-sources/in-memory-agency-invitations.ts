import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { AgencyInvitation, AgencyInvitationsDataSource } from '../../domain';

/** The demo's people each belong to one agency: nobody has an invitation waiting. */
@Injectable()
export class InMemoryAgencyInvitationsDataSource extends AgencyInvitationsDataSource {
  mine(): Observable<AgencyInvitation[]> {
    return of([]);
  }

  accept(): Observable<void> {
    return of(undefined);
  }

  decline(): Observable<void> {
    return of(undefined);
  }
}
