import { Observable } from 'rxjs';
import {
  ContactDisclosure,
  ContractorProfile,
  ContractorQuote,
  QuoteLifecycleEvent,
  QuoteRequest,
  ServiceCategory,
} from './contractor.models';

/** A quote request with everything a customer needs to compare offers. */
export interface QuoteRequestView {
  request: QuoteRequest;
  quotes: ContractorQuote[];
  /** By party id. `party.contact` is present only where `disclosure` allows it. */
  profiles: Record<string, ContractorProfile>;
  /** By party id: whether the customer may see direct contact details yet, and why. Decided by the server. */
  disclosure: Record<string, ContactDisclosure>;
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
  /** Businesses not on Humo Contractor yet: each gets an email inviting them to join and quote. */
  inviteEmails?: string[];
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
  abstract markViewed(quoteRequestId: string, quoteIds: string[]): Observable<void>;
  abstract setRecommended(quoteRequestId: string, quoteId: string): Observable<void>;
  /** The customer's choice. Other quotes become "not selected". */
  abstract accept(quoteRequestId: string, quoteId: string): Observable<void>;
  /**
   * A message to an invited contractor, kept on the quote request so the history stays in one place.
   * PRODUCTION: notify the contractor (email / Humo Contractor) — see docs/18 R-3.
   */
  abstract message(quoteRequestId: string, partyId: string, body: string): Observable<void>;
  /** Only possible with a genuine relationship (completed work together). */
  abstract endorse(partyId: string, customerId: string, customerName: string, note: string, completedJobs: number): Observable<void>;
}
