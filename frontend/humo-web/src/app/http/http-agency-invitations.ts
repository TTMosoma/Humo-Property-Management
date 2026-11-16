import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { AgencyInvitation, AgencyInvitationsDataSource, InvitationCorrections } from '../domain';
import { HttpPort } from './http-port';

/** D46 invitations over HTTP. A new invitation arrives with a bell notice, so it's re-fetched when the bell changes. */
@Injectable()
export class HttpAgencyInvitationsDataSource extends HttpPort implements AgencyInvitationsDataSource {
  mine(): Observable<AgencyInvitation[]> {
    return this.live<AgencyInvitation[]>('/me/invitations', ['notifications', 'session']);
  }

  accept(organisationId: string, corrections: InvitationCorrections): Observable<void> {
    return this.command('POST', `/me/invitations/${organisationId}/accept`, corrections, ['session', 'notifications']);
  }

  decline(organisationId: string): Observable<void> {
    return this.command('POST', `/me/invitations/${organisationId}/decline`, null, ['session', 'notifications']);
  }
}
