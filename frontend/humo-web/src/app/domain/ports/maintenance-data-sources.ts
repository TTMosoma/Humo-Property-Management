import { Observable } from 'rxjs';
import { Invoice, Job, PaymentBatch, Priority } from '../models/job';
import { Scheme } from '../models/scheme';
import { DocStatus, Supplier, Trade } from '../models/supplier';
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
  /** Suppliers who could be asked to quote (same trade, serving this scheme). */
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
  /** A quote chosen in a Humo Contractor quote request, compared against `compared` offers. */
  | { type: 'award-network-quote'; supplierId: string; amount: number; guaranteeMonths: number; quoteRequestId: string; compared: number; completeBy: string }
  | { type: 'approve-within-delegation'; quoteId: string }
  | { type: 'issue-work-order'; scheduledFor: string; accessNotes?: string }
  | { type: 'start-work' }
  | { type: 'complete'; notes: string }
  | { type: 'verify'; outcome: 'fixed' | 'not-fixed'; comment?: string; onBehalf: boolean }
  | { type: 'capture-invoice'; amount: number; invoiceNo: string }
  | { type: 'close' }
  | { type: 'comment'; text: string }
  | { type: 'cancel'; reason: string };

// ---------------------------------------------------------------- Ports

export abstract class JobDataSource {
  abstract list(schemeIds: string[]): Observable<JobSummary[]>;
  abstract get(ref: string): Observable<JobDetail | undefined>;
  abstract search(query: string, schemeIds: string[], limit?: number): Observable<JobSummary[]>;
  /** A resident's own requests (reported by them, or for their unit). */
  abstract forResident(personId: string, unitId?: string): Observable<JobSummary[]>;
  /** Returns the new job's reference. */
  abstract create(input: NewJobInput): Observable<string>;
  abstract act(ref: string, action: JobAction): Observable<void>;
}

export abstract class SupplierDataSource {
  abstract list(schemeIds: string[]): Observable<SupplierSummary[]>;
  abstract get(id: string): Observable<SupplierDetail | undefined>;
  abstract search(query: string, limit?: number): Observable<SupplierSummary[]>;
  abstract requestDocument(supplierId: string, type: string): Observable<void>;
  /** Sensitive: needs step-up; payments to the supplier are held until the new account is verified. */
  abstract changeBankDetails(supplierId: string): Observable<void>;
  /**
   * Start (or find) the agency's supplier relationship with a Humo Contractor
   * business — e.g. when awarding work to a contractor invited by email.
   */
  abstract linkParty(input: { partyId: string; name: string; trades: Supplier['trades']; contactName: string; phone: string; email: string; schemeId: string }): Observable<string>;
}

export abstract class PayablesDataSource {
  abstract invoices(schemeIds: string[]): Observable<InvoiceView[]>;
  abstract batches(schemeIds: string[]): Observable<BatchView[]>;
  /** Groups approved invoices of one scheme into a batch and sends it for (dual) approval. */
  abstract createBatch(invoiceIds: string[]): Observable<string>;
  /** After approval: the EFT batch is released to the bank. */
  abstract releaseBatch(batchId: string): Observable<void>;
}
