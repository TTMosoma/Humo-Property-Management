import { Observable } from 'rxjs';
import { AppNotification } from '../models/notification';
import { PackageId } from '../models/entitlement';
import { Organisation, OrganisationStatus } from '../models/organisation';

export interface OrganisationDetails {
  name: string;
  shortName: string;
  city: string;
  province: string;
}

export interface NewOrganisation extends OrganisationDetails {
  packageId: PackageId;
  /** Humo Account Manager (identity id). */
  accountManagerId: string;
}

/**
 * Customer organisations. Humo staff see every organisation; a customer user
 * sees only their own. Organisations are never deleted: they're suspended
 * (access paused for everyone in them) or archived (closed, kept for records).
 */
export abstract class OrganisationDataSource {
  abstract list(): Observable<Organisation[]>;
  abstract get(id: string): Observable<Organisation | undefined>;
  /** Onboards a customer: the organisation starts `onboarding`, on a 30-day trial of the package. Returns its id. */
  abstract create(input: NewOrganisation): Observable<string>;
  abstract update(id: string, details: OrganisationDetails, expectedVersion?: number): Observable<void>;
  /** active ⇄ suspended, onboarding → active, any → archived, archived → active (restore). */
  abstract setStatus(id: string, status: OrganisationStatus, reason: string, expectedVersion?: number): Observable<void>;
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
