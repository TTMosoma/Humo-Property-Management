import { LibraryDocument } from './library';
import { Scheme } from './scheme';
import { ComplianceStatus } from './scheme-health';

/**
 * Compliance (review finding F22): items are mostly GENERATED from the records
 * other modules keep, not typed into a list:
 *
 *   AGM held in time                ← the scheme's financial year + Governance meetings
 *   Audited financial statements    ← the financial year + a recorded sign-off or the uploaded statements
 *   CSOS annual return              ← the financial year + a recorded submission
 *   Building insurance              ← the insurance policy in Documents (its expiry)
 *   Fire equipment service          ← the service certificate in Documents
 *   Lift inspection                 ← the inspection certificate in Documents (schemes with lifts)
 *   Supplier documents              ← the scheme's suppliers' vetting documents
 *   Trustee board                   ← Governance › Trustee boards (at least the minimum in office)
 *
 * Manual items stay possible for anything else. The wording is neutral
 * ("Due soon", "Overdue"): Humo tracks deadlines; it makes no claim of legal sufficiency.
 */

export type ComplianceType = 'agm' | 'financial-statements' | 'csos-return' | 'building-insurance' | 'fire-equipment' | 'lift-inspection' | 'supplier-documents' | 'trustee-board';

export type ComplianceSource = 'governance' | 'finance' | 'documents' | 'suppliers';

export interface ComplianceTypeDef {
  id: ComplianceType;
  label: string;
  /** Column header in the matrix. */
  short: string;
  source: ComplianceSource;
  /** What it is and where Humo gets it from. */
  description: string;
}

export const COMPLIANCE_TYPES: ComplianceTypeDef[] = [
  { id: 'agm', label: 'Annual general meeting', short: 'AGM', source: 'governance', description: 'Held within 4 months of the financial year-end. Comes from the scheme’s meetings.' },
  { id: 'financial-statements', label: 'Audited financial statements', short: 'Financials', source: 'finance', description: 'Signed off in time for the AGM. Complete when the statements are uploaded or the sign-off is recorded.' },
  { id: 'csos-return', label: 'CSOS annual return', short: 'CSOS', source: 'finance', description: 'Submitted within 4 months of the financial year-end. Complete when the submission is recorded.' },
  { id: 'building-insurance', label: 'Building insurance', short: 'Insurance', source: 'documents', description: 'A current policy on file. Comes from the policy’s expiry in Documents.' },
  { id: 'fire-equipment', label: 'Fire equipment service', short: 'Fire', source: 'documents', description: 'An annual service certificate. Comes from the certificate’s expiry in Documents.' },
  { id: 'lift-inspection', label: 'Lift inspection', short: 'Lifts', source: 'documents', description: 'A current inspection certificate, for schemes with lifts. Comes from Documents.' },
  { id: 'trustee-board', label: 'Trustee board', short: 'Board', source: 'governance', description: 'At least the minimum number of trustees in office (3 unless the scheme’s rules say otherwise). Comes from Trustee boards.' },
  { id: 'supplier-documents', label: 'Supplier documents', short: 'Suppliers', source: 'suppliers', description: 'Suppliers who worked at the scheme in the last 12 months have a current COIDA letter of good standing and public liability insurance.' },
];

export const COMPLIANCE_TYPE: Record<ComplianceType, ComplianceTypeDef> = Object.fromEntries(COMPLIANCE_TYPES.map((t) => [t.id, t])) as Record<ComplianceType, ComplianceTypeDef>;

export const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, string> = {
  complete: 'Complete',
  upcoming: 'Upcoming',
  'due-soon': 'Due soon',
  overdue: 'Overdue',
  'not-applicable': 'N/A',
};

/** Days before the due date that an item counts as "due soon". */
export const DUE_SOON_DAYS = 30;

/** What the person can do about an item from its page. */
export type ComplianceNext = 'upload' | 'schedule-agm' | 'open-meeting' | 'record' | 'open-suppliers' | 'open-board' | 'complete-manual';

export interface ComplianceItem {
  /** Generated items: `${schemeId}.${type}`; manual items: their own id. */
  id: string;
  /** "CMP-KC-AGM". */
  ref: string;
  schemeId: string;
  type: ComplianceType | 'manual';
  title: string;
  /** Where things stand, in words. */
  detail: string;
  status: ComplianceStatus;
  /** The deadline (or the expiry being tracked). */
  dueAt?: string;
  /** The financial year it's for, e.g. "2025/26", for year-based items. */
  period?: string;
  /** Where the fact comes from, with a link to the source record. */
  source: { label: string; route?: string };
  /** What makes it complete, when it is. */
  evidence?: { label: string; route?: string; at?: string; by?: string };
  next?: { label: string; action: ComplianceNext };
  /** The open compliance Task, if any. */
  workItemId?: string;
  manual?: boolean;
  /** Manual items only: concurrency token. */
  version?: number;
}

/** A scheme's facts that compliance is worked out from. */
export interface ComplianceProfile {
  schemeId: string;
  /** Month the financial year ends (1–12); it ends on that month's last day. */
  financialYearEnd: number;
  hasLifts: boolean;
}

/** A recorded completion for a year-based item (financial statements, CSOS return). */
export interface ComplianceRecord {
  id: string;
  schemeId: string;
  type: ComplianceType;
  /** Financial year, "2025/26". */
  period: string;
  at: string;
  by: string;
  reference: string;
  note?: string;
}

export interface ManualComplianceItem {
  id: string;
  version: number;
  schemeId: string;
  title: string;
  dueAt: string;
  notes?: string;
  createdAt: string;
  createdBy: string;
  completed?: { at: string; by: string; note: string };
}

export interface ComplianceDetail {
  item: ComplianceItem;
  scheme: Scheme;
  profile: ComplianceProfile;
  /** Documents that are (or were) evidence for it, newest first. */
  documents: LibraryDocument[];
  /** Past completions of the same obligation. */
  history: { label: string; at: string; by?: string }[];
}

export type ComplianceAction =
  | { type: 'record'; reference: string; note?: string }
  | { type: 'complete-manual'; note: string };

export interface NewManualCompliance {
  schemeId: string;
  title: string;
  dueAt: string;
  notes?: string;
}

/** The worst status across a scheme's items: what the scheme's health shows. */
export function worstStatus(statuses: ComplianceStatus[]): ComplianceStatus {
  for (const s of ['overdue', 'due-soon'] as const) if (statuses.includes(s)) return s;
  return 'complete';
}

/** "2025/26" for a year ending Feb 2026; "2025" for one ending Dec 2025. */
export function financialYearLabel(endYear: number, endMonth = 2): string {
  return endMonth === 12 ? String(endYear) : `${endYear - 1}/${String(endYear).slice(2)}`;
}
