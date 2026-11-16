import { Observable } from 'rxjs';

/**
 * D46: an invitation from another agency to someone who already signs in to Humo. What the inviting agency recorded about
 * them is theirs to check; nothing applies until they accept.
 */
export interface AgencyInvitation {
  organisationId: string;
  organisation: string;
  invitedAt: string;
  /** What the inviting agency recorded, for them to check. */
  name: string;
  email: string;
  phone: string;
  /** The roles waiting for them, e.g. "Owner · Unit 100, Adante". */
  roles: string[];
}

/** Corrections to the inviting agency's record, given as they accept. Empty means it's right. */
export interface InvitationCorrections {
  name?: string;
  phone?: string;
}

/** The signed-in person's own invitations (`/api/me/invitations`). */
export abstract class AgencyInvitationsDataSource {
  /** Live: waiting invitations, oldest first. */
  abstract mine(): Observable<AgencyInvitation[]>;
  abstract accept(organisationId: string, corrections: InvitationCorrections): Observable<void>;
  abstract decline(organisationId: string): Observable<void>;
}
