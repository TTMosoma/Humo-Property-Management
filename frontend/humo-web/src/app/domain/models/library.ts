import { ComplianceType } from './compliance';
import { SupplierDocType } from './supplier';

/**
 * The document library (review finding F20): documents are born in context.
 * Each is uploaded on a record (scheme, unit, supplier, job, meeting, person)
 * through its Attachments panel (pattern P5) and appears in the library with its
 * links already set. The library is a search over every document, with facets.
 *
 * A document can carry an expiry. Expiring documents feed Compliance: building
 * insurance, fire equipment and lift certificates (`compliance`), and a
 * supplier's vetting documents (`supplierDoc`).
 */

export type LibraryCategory =
  | 'insurance'
  | 'certificate'
  | 'vetting'
  | 'rules'
  | 'minutes'
  | 'financial'
  | 'contract'
  | 'plans'
  | 'correspondence'
  | 'quote'
  | 'photo'
  | 'other';

export const CATEGORY_LABELS: Record<LibraryCategory, string> = {
  insurance: 'Insurance',
  certificate: 'Certificate',
  vetting: 'Supplier vetting',
  rules: 'Rules & conduct',
  minutes: 'Minutes & notices',
  financial: 'Financial',
  contract: 'Contract',
  plans: 'Plans & drawings',
  correspondence: 'Correspondence',
  quote: 'Quote',
  photo: 'Photo',
  other: 'Other',
};

/** Who may open it. Staff always can; the rest widen the circle. */
export type DocumentVisibility = 'staff' | 'trustees' | 'owners' | 'unit';

export const VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  staff: 'Staff only',
  trustees: 'Staff and trustees',
  owners: 'Owners of the scheme',
  unit: 'This unit’s owner and tenant',
};

export type RecordKind = 'scheme' | 'unit' | 'person' | 'supplier' | 'job' | 'meeting';

export const RECORD_KIND_LABELS: Record<RecordKind, string> = {
  scheme: 'Scheme',
  unit: 'Unit',
  person: 'Person',
  supplier: 'Supplier',
  job: 'Job',
  meeting: 'Meeting',
};

/** A record a document belongs to, as the library shows it. */
export interface RecordLink {
  kind: RecordKind;
  id: string;
  label: string;
  route: string;
}

export interface LibraryDocument {
  id: string;
  /** Concurrency token. */
  version: number;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: LibraryCategory;
  /** The schemes it belongs to, worked out by the API from its links (a supplier's documents belong to every scheme it serves). */
  schemeIds: string[];
  /** The first link is the record it was uploaded on. */
  links: RecordLink[];
  visibility: DocumentVisibility;
  uploadedAt: string;
  uploadedBy: string;
  /** ISO date. Documents that lapse (insurance, certificates, vetting). */
  expiresAt?: string;
  /** The compliance obligation this document is evidence for. */
  compliance?: ComplianceType;
  /** The supplier vetting document this is. */
  supplierDoc?: SupplierDocType;
  notes?: string;
  archived?: { at: string; by: string; reason: string };
}

export type ExpiryState = 'none' | 'valid' | 'expiring' | 'expired';

/** Expiring = within 30 days. */
export function expiryState(d: Pick<LibraryDocument, 'expiresAt'>, now = new Date()): ExpiryState {
  if (!d.expiresAt) return 'none';
  const days = (new Date(d.expiresAt).getTime() - now.getTime()) / 86_400_000;
  return days < 0 ? 'expired' : days < 30 ? 'expiring' : 'valid';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface NewDocument {
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: LibraryCategory;
  /** The record it's uploaded on. */
  record: { kind: RecordKind; id: string };
  visibility: DocumentVisibility;
  expiresAt?: string;
  compliance?: ComplianceType;
  supplierDoc?: SupplierDocType;
  notes?: string;
}

export type DocumentAction =
  | { type: 'edit'; title: string; category: LibraryCategory; visibility: DocumentVisibility; expiresAt?: string; notes?: string }
  | { type: 'archive'; reason: string }
  | { type: 'restore' };

/** Which categories can carry which compliance link. */
export const COMPLIANCE_CATEGORIES: Partial<Record<ComplianceType, LibraryCategory>> = {
  'building-insurance': 'insurance',
  'fire-equipment': 'certificate',
  'lift-inspection': 'certificate',
  'financial-statements': 'financial',
};
