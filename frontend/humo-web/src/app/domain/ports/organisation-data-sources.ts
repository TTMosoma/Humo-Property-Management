import { Observable } from 'rxjs';
import { AppNotification } from '../models/notification';
import { Organisation } from '../models/organisation';

/**
 * Customer organisations. Humo staff see every organisation; a customer user
 * sees only their own. (Create, edit and lifecycle changes come later.)
 */
export abstract class OrganisationDataSource {
  abstract list(): Observable<Organisation[]>;
  abstract get(id: string): Observable<Organisation | undefined>;
}

/**
 * The signed-in person's notifications for their active role and scope,
 * newest first. The server decides the audience; the client doesn't filter.
 * Live: emits again when one is read or a new one arrives (HTTP: push).
 */
export abstract class NotificationDataSource {
  abstract list(): Observable<AppNotification[]>;
  abstract markRead(ids: string[]): Observable<void>;
}
