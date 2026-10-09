/**
 * A person in the directory (decision D1). Owner, tenant and trustee are not
 * types of person — they are relationships. One person can hold many.
 */
export interface Person {
  id: string;
  /** Concurrency token: send it back with commands that change this record. The API answers 409 if someone changed it first. */
  version: number;
  firstName: string;
  lastName: string;
  /** Companies and trusts own units too. */
  kind: 'individual' | 'company' | 'trust';
  displayName: string;
  initials: string;
  email: string;
  phone: string;
  preferredChannel: 'email' | 'sms' | 'whatsapp';
  postalAddress?: string;
  /** Persona id when this person can sign in to the prototype. */
  personaId?: string;
}

export type RelationshipType = 'owner' | 'tenant' | 'trustee';

export interface Relationship {
  id: string;
  personId: string;
  type: RelationshipType;
  schemeId: string;
  /** Owner and tenant relationships point at a unit; trustee relationships at the scheme. */
  unitId?: string;
  /** Trustees: Chairperson, Treasurer, Trustee. */
  portfolio?: string;
  /** ISO date. */
  since: string;
  /** Tenants: lease end. Trustees: the day they left the board. */
  until?: string;
  /** Trustees: how they came onto the board. */
  appointment?: TrusteeAppointment;
  /** Trustees: why they left (resigned, sold their unit, removed at a general meeting…). */
  endReason?: string;
}

/**
 * Trustees are elected by the owners at the AGM; between AGMs the board can
 * fill a vacancy by co-opting an owner until the next AGM.
 */
export interface TrusteeAppointment {
  how: 'elected' | 'co-opted' | 'before-humo';
  /** The resolution, for elections recorded in Humo. */
  resolutionRef?: string;
  meetingId?: string;
}
