import { Observable } from 'rxjs';
import {
  ContractorEndorsement,
  ContractorProfile,
  ContractorQuote,
  QuoteLifecycleEvent,
  QuoteRequest,
  ServiceCategory,
  WorkOrder,
} from './contractor.models';

/** A quote request with everything a customer needs to compare offers. */
export interface QuoteRequestView {
  request: QuoteRequest;
  quotes: ContractorQuote[];
  profiles: Record<string, ContractorProfile>;
  events: QuoteLifecycleEvent[];
}

export interface NewQuoteRequest {
  customerId: string;
  customerName: string;
  site: QuoteRequest['site'];
  source?: QuoteRequest['source'];
  title: string;
  description: string;
  category: ServiceCategory;
  requirements: string[];
  photos: number;
  deadline: string;
  invite: { partyId: string; via: 'existing-relationship' | 'email-invite' }[];
}

/**
 * What a *customer product* (Humo PM today) needs from the contractor
 * network. Humo PM never reaches into contractor data any other way.
 */
export abstract class ContractorNetwork {
  abstract profile(partyId: string): Observable<ContractorProfile | undefined>;
  abstract profiles(partyIds: string[]): Observable<ContractorProfile[]>;
  abstract quoteRequestFor(source: { product: 'humo-pm'; ref: string }): Observable<QuoteRequestView | undefined>;
  abstract quoteRequest(id: string): Observable<QuoteRequestView | undefined>;
  abstract createQuoteRequest(input: NewQuoteRequest): Observable<string>;
  /** Opening a quote is a lifecycle event (the contractor sees "Viewed"). */
  abstract markViewed(quoteRequestId: string, quoteIds: string[]): void;
  abstract setRecommended(quoteRequestId: string, quoteId: string): Observable<void>;
  /** The customer's choice. Other quotes become "not selected". */
  abstract accept(quoteRequestId: string, quoteId: string): Observable<void>;
  /** Only possible with a genuine relationship (completed work together). */
  abstract endorse(partyId: string, customerId: string, customerName: string, note: string, completedJobs: number): Observable<void>;
}

/** The contractor's own dashboard numbers. */
export interface ContractorDashboard {
  profile: ContractorProfile;
  openRequests: number;
  activeJobs: number;
  completedJobs: number;
  awaitingResponse: QuoteRequest[];
  /** `viewed`: the customer has opened the quote (a lifecycle event the contractor may see). */
  submitted: { request: QuoteRequest; quote: ContractorQuote; viewed: boolean }[];
  workOrders: WorkOrder[];
}

export interface ContractorRequestView {
  request: QuoteRequest;
  invitation: QuoteRequest['invitations'][number];
  myQuote?: ContractorQuote;
  /** How many others were invited — never who, never their prices. */
  competing: number;
}

export interface QuoteSubmission {
  amount: number;
  proposedWork: string[];
  exclusions?: string;
  startBy: string;
  completeBy: string;
  validUntil: string;
  guaranteeMonths: number;
}

/**
 * What the contractor-facing product (the Humo Contractor portal, later a
 * standalone app) needs. Scoped to one business party.
 */
export abstract class ContractorPortal {
  abstract dashboard(partyId: string): Observable<ContractorDashboard | undefined>;
  abstract request(partyId: string, quoteRequestId: string): Observable<ContractorRequestView | undefined>;
  abstract submitQuote(partyId: string, quoteRequestId: string, quote: QuoteSubmission): Observable<void>;
  abstract decline(partyId: string, quoteRequestId: string, reason: string): Observable<void>;
  abstract endorsements(partyId: string): Observable<ContractorEndorsement[]>;
}
