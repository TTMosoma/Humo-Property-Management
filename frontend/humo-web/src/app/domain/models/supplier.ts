export type Trade =
  | 'Plumbing'
  | 'Electrical'
  | 'Roofing & waterproofing'
  | 'Painting'
  | 'Security'
  | 'Gate automation'
  | 'Lifts'
  | 'Gardens'
  | 'Pools'
  | 'Pest control'
  | 'Building'
  | 'Fire equipment';

export type SupplierDocType =
  | 'COIDA letter of good standing'
  | 'Public liability insurance'
  | 'Tax compliance (SARS PIN)'
  | 'B-BBEE certificate'
  | 'Bank confirmation letter';

export interface SupplierDocument {
  type: SupplierDocType;
  /** ISO date; undefined = does not expire. */
  expires?: string;
  /** Missing documents have no file. */
  onFile: boolean;
}

export type DocStatus = 'valid' | 'expiring' | 'expired' | 'missing';

/**
 * The agency's relationship with a contractor or vendor: its vetting, its
 * performance *with this agency*, bank details for payment. The business itself
 * (profile, Humo-wide reputation, verification) is a Humo Contractor party,
 * linked by `partyId` — one business, one party, whatever it does.
 * Vetting documents gate new work orders (review finding F18).
 */
export interface Supplier {
  id: string;
  /** The Humo Contractor business party, when the business is on Humo. */
  partyId?: string;
  name: string;
  trades: Trade[];
  contactName: string;
  phone: string;
  email: string;
  /** Masked; changing bank details requires verification. */
  bankAccount: string;
  bankVerified: boolean;
  bbbeeLevel?: number;
  schemeIds: string[];
  documents: SupplierDocument[];
  performance: {
    jobsCompleted: number;
    /** % of jobs completed by the scheduled date. */
    onTimeRate: number;
    /** Average invoice vs approved quote, %, positive = over. */
    avgVariance: number;
    /** % of jobs residents confirmed as fixed first time. */
    verifiedRate: number;
  };
  status: 'active' | 'on-hold';
}

export function docStatus(doc: SupplierDocument, now = new Date()): DocStatus {
  if (!doc.onFile) return 'missing';
  if (!doc.expires) return 'valid';
  const days = (new Date(doc.expires).getTime() - now.getTime()) / 86_400_000;
  if (days < 0) return 'expired';
  if (days < 30) return 'expiring';
  return 'valid';
}

/** Overall vetting status: the worst of the documents that matter for site work. */
export function supplierCompliance(s: Supplier): DocStatus {
  const order: DocStatus[] = ['missing', 'expired', 'expiring', 'valid'];
  const statuses = s.documents
    .filter((d) => d.type !== 'B-BBEE certificate')
    .map((d) => docStatus(d));
  return order.find((o) => statuses.includes(o)) ?? 'valid';
}
