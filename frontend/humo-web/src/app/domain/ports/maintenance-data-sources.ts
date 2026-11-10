import { Observable } from 'rxjs';
import { ListQuery, Page } from './list-query';
import { Invoice, Job, PaymentBatch, Photo, Priority } from '../models/job';
import { Scheme } from '../models/scheme';
import { BankDetailsInput, DocStatus, Supplier, SupplierStatus, Trade } from '../models/supplier';
import { Unit } from '../models/unit';
import { WorkItem } from '../models/work-item';

// ---------------------------------------------------------------- Read models

export interface JobSummary {
  job: Job;
  scheme: Scheme;
  unit?: Unit;
  supplier?: Supplier;
  assigneeName: string;
}

export interface InvoiceView {
  invoice: Invoice;
  supplier: Supplier;
  scheme: Scheme;
  job?: Job;
  /** Invoice minus approved quote (null when there is no quote, e.g. contracts). */
  variance: number | null;
}

export interface JobDetail extends JobSummary {
  /** Suppliers referenced by quotes, keyed by id. */
  suppliers: Record<string, Supplier>;
  /** Suppliers serving this scheme, of every trade: screens pick those for the job's trade with `suppliersFor`. */
  candidates: Supplier[];
  invoice?: InvoiceView;
  batch?: PaymentBatch;
  approvalItem?: WorkItem;
  invoiceApprovalItem?: WorkItem;
}

export interface SupplierSummary {
  supplier: Supplier;
  schemes: Scheme[];
  compliance: DocStatus;
  openJobs: number;
  spend12m: number;
}

export interface SupplierDetail extends SupplierSummary {
  jobs: JobSummary[];
  invoices: InvoiceView[];
}

export interface BatchView {
  batch: PaymentBatch;
  scheme: Scheme;
  invoices: InvoiceView[];
  approvalItem?: WorkItem;
}

// ---------------------------------------------------------------- Commands

export interface NewJobInput {
  schemeId: string;
  unitId?: string;
  location: string;
  title: string;
  description: string;
  category: Trade;
  priority: Priority;
  reportedBy: Job['reportedBy'];
  photoCaptions: string[];
}

/** Every change to a job is a named command — the same shape the .NET API will expose. */
export type JobAction =
  | { type: 'triage'; assigneeId: string; priority: Priority; category: Trade }
  | { type: 'request-quotes'; supplierIds: string[] }
  | { type: 'record-quote'; quoteId: string; amount: number; guaranteeMonths?: number; notes?: string }
  | { type: 'send-for-approval'; quoteId: string }
  /** D39: an urgent job goes ahead above the scheme's limit; the board confirms it afterwards. Needs a passkey. */
  | { type: 'emergency-proceed'; quoteId: string; reason: string }
  /** A quote chosen in a Humo Contractor quote request, compared against `compared` offers. */
  | { type: 'award-network-quote'; supplierId: string; amount: number; guaranteeMonths: number; quoteRequestId: string; compared: number; completeBy: string }
  | { type: 'approve-within-delegation'; quoteId: string }
  /** `overrideVetting`: the supplier's site-work documents are missing or expired and you proceed anyway (recorded on the job). */
  | { type: 'issue-work-order'; scheduledFor: string; accessNotes?: string; overrideVetting?: boolean }
  | { type: 'start-work' }
  | { type: 'complete'; notes: string }
  | { type: 'verify'; outcome: 'fixed' | 'not-fixed'; comment?: string; onBehalf: boolean }
  | { type: 'capture-invoice'; amount: number; invoiceNo: string }
  | { type: 'close' }
  | { type: 'comment'; text: string }
  /** Any stage until it's closed or cancelled, with a reason in the job's history. */
  | { type: 'change-priority'; priority: Priority; reason: string }
  | { type: 'cancel'; reason: string };

export type SupplierDetails = Pick<Supplier, 'name' | 'trades' | 'contactName' | 'phone' | 'email' | 'schemeIds'> & { bbbeeLevel?: number };

// ---------------------------------------------------------------- Ports

export abstract class JobDataSource {
  abstract list(schemeIds: string[], query?: ListQuery): Observable<Page<JobSummary>>;
  abstract get(ref: string): Observable<JobDetail | undefined>;
  abstract search(query: string, schemeIds: string[], limit?: number): Observable<JobSummary[]>;
  /** A resident's own requests (reported by them, or for their unit). */
  abstract forResident(personId: string, unitId?: string): Observable<JobSummary[]>;
  /** Returns the new job's reference. */
  abstract create(input: NewJobInput): Observable<string>;
  /** `expectedVersion`: the record's version as shown; the API answers 409 (conflict) if it has changed since. */
  abstract act(ref: string, action: JobAction, expectedVersion?: number): Observable<void>;
  /**
   * A photo of the problem (`report`) or of the finished work (`completion`). Residents add report photos only.
   * PRODUCTION: store the image (JPEG, PNG or WebP, virus-scanned) as an uploaded file that counts against the
   * agency's storage (D20), and refuse it past the limit (docs/18 R-17).
   */
  abstract addPhoto(ref: string, file: File, stage: Photo['stage'], caption?: string): Observable<void>;
  /** A photo added by mistake. PRODUCTION: delete its file too, freeing the storage (docs/18 R-17). */
  abstract removePhoto(ref: string, photoId: string): Observable<void>;
  /** Where a stored photo's image is served from; none in the simulation, which keeps only the name. */
  photoUrl(_ref: string, _photo: Photo): string | undefined {
    return undefined;
  }
}

export abstract class SupplierDataSource {
  abstract list(schemeIds: string[]): Observable<SupplierSummary[]>;
  abstract get(id: string): Observable<SupplierDetail | undefined>;
  abstract search(query: string, limit?: number): Observable<SupplierSummary[]>;
  abstract requestDocument(supplierId: string, type: string): Observable<void>;
  /** A supplier the agency vets itself (not through Humo Contractor). Returns its id. */
  abstract create(details: SupplierDetails): Observable<string>;
  abstract update(id: string, details: SupplierDetails, expectedVersion?: number): Observable<void>;
  /** On hold: no new work orders. Archived: no longer used. Restore by setting active. */
  abstract setStatus(id: string, status: SupplierStatus, reason: string, expectedVersion?: number): Observable<void>;
  /**
   * Sensitive: needs step-up. Payments to the supplier are held until someone other than the person who entered the
   * account verifies it in My work (D27).
   * PRODUCTION: the API stores the account, opens the verification in My work and refuses payments until it's verified.
   */
  abstract changeBankDetails(supplierId: string, details: BankDetailsInput): Observable<void>;
  /**
   * Start (or find) the agency's supplier relationship with a Humo Contractor
   * business — e.g. when awarding work to a contractor invited by email. The
   * server copies the business's contact details across; the client never sends them.
   */
  abstract linkParty(input: { partyId: string; name: string; trades: Supplier['trades']; schemeId: string }): Observable<string>;
}

export abstract class PayablesDataSource {
  abstract invoices(schemeIds: string[]): Observable<InvoiceView[]>;
  abstract batches(schemeIds: string[]): Observable<BatchView[]>;
  /** Groups approved invoices of one scheme into a batch and sends it for approval by someone other than the preparer. */
  abstract createBatch(invoiceIds: string[]): Observable<string>;
  /**
   * After approval, by someone other than the preparer, with a fresh passkey: downloads the payment file for internet
   * banking and returns its name; the invoices are paid and the suppliers emailed remittances (D27).
   * PRODUCTION: the API builds the file from the verified accounts the batch was made with and sends the remittances.
   */
  abstract releaseBatch(batchId: string, expectedVersion?: number): Observable<string>;
  /** A released batch's payment file again (step-up; audited). Returns its name. */
  abstract paymentFile(batchId: string): Observable<string>;
  /** Before release: the batch is withdrawn and its invoices are ready to pay again. */
  abstract cancelBatch(batchId: string, reason: string, expectedVersion?: number): Observable<void>;
}
