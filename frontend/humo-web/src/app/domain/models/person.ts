/**
 * A person in the directory (decision D1). Owner, tenant and trustee are not
 * types of person — they are relationships. One person can hold many.
 */
export interface Person {
  id: string;
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
  /** Tenants: lease end. */
  until?: string;
}
