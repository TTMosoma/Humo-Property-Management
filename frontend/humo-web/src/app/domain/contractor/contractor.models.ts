/**
 * Humo Contractor — domain models.
 *
 * This folder is a separate bounded context: it imports nothing from Humo PM.
 * Humo PM *consumes* it (through ports in ./contractor.ports.ts); a future
 * standalone Humo Contractor app can own it.
 *
 *   Humo Platform
 *    ├─ Humo Property Management   (managing agents, schemes, jobs)
 *    ├─ Humo Contractor            (businesses, profiles, quotes, reputation)
 *    └─ future products
 */

// ---------------------------------------------------------------- Party (the business)

/**
 * One business on Humo, whatever it does. A contractor performs work
 * (maintenance, repair, installation); a supplier provides goods, services or
 * recurring supplies. Many do both, so it's one entity with capabilities —
 * not two duplicated records.
 */
export type PartyCapability = 'contractor' | 'supplier';

export type ServiceCategory =
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

export interface BusinessParty {
  id: string;
  tradingName: string;
  legalName: string;
  registrationNo?: string;
  vatNo?: string;
  capabilities: PartyCapability[];
  /** Year the business started trading. */
  established: number;
  /** Year it joined Humo. */
  onHumoSince: number;
  /** Shown only once a relationship allows it (see ContactDisclosure). */
  contact: { name: string; phone: string; email: string };
}

/** A service the business offers, with a typical lead time. */
export interface ContractorService {
  category: ServiceCategory;
  description: string;
  /** Typical days from acceptance to start. */
  leadTimeDays: number;
}

export interface ServiceArea {
  /** Metro or region, e.g. "Johannesburg North", "eThekwini". */
  name: string;
  province: string;
}

// ---------------------------------------------------------------- Compliance & verification

export type ContractorDocumentType =
  | 'COIDA letter of good standing'
  | 'Public liability insurance'
  | 'Tax compliance (SARS PIN)'
  | 'B-BBEE certificate'
  | 'Bank confirmation letter'
  | 'Company registration (CIPC)'
  | 'Trade certification';

export interface ContractorDocument {
  type: ContractorDocumentType;
  onFile: boolean;
  expires?: string;
  /** Humo has checked the document (not just that it was uploaded). */
  verifiedByHumo: boolean;
}

export interface InsuranceCover {
  kind: 'Public liability' | 'Professional indemnity' | 'Contract works';
  insurer: string;
  coverAmount: number;
  expires: string;
  verifiedByHumo: boolean;
}

/**
 * Listed: the business created a profile.
 * Verified: Humo checked registration, compliance documents and insurance.
 * Humo Recommended: verified, with a sustained record of good work and customer endorsements.
 */
export type VerificationLevel = 'listed' | 'verified' | 'recommended';

export const VERIFICATION_LABEL: Record<VerificationLevel, string> = {
  listed: 'Listed',
  verified: 'Verified',
  recommended: 'Humo Recommended',
};

export interface ContractorVerification {
  level: VerificationLevel;
  businessVerified: boolean;
  insuranceVerified: boolean;
  complianceVerified: boolean;
  /** When Humo last reviewed the business. */
  reviewedAt?: string;
}

/** The stated bar for "Humo Recommended". Humo staff still confirm it; this is the evidence. */
export function meetsRecommendedBar(v: ContractorVerification, r: ContractorReputation): boolean {
  return v.businessVerified && v.insuranceVerified && r.rating >= 4.6 && r.completedJobs >= 20 && r.endorsements >= 5 && r.onTimeRate >= 90;
}

// ---------------------------------------------------------------- Reputation

/**
 * An endorsement can only come from a Humo customer with a genuine working
 * relationship (completed jobs together). A contractor cannot create one.
 */
export interface ContractorEndorsement {
  id: string;
  partyId: string;
  /** The endorsing Humo customer (an organisation, not an anonymous person). */
  fromCustomerId: string;
  fromCustomerName: string;
  endorsedBy: string;
  /** Evidence of the relationship at the time of endorsing. */
  basedOnCompletedJobs: number;
  note: string;
  at: string;
}

/** A rating left by a customer for one completed job. */
export interface ContractorRating {
  id: string;
  partyId: string;
  customerId: string;
  jobRef?: string;
  stars: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  at: string;
}

/** Reputation is several numbers, never one star average. */
export interface ContractorReputation {
  rating: number;
  ratingsCount: number;
  completedJobs: number;
  /** % of awarded jobs finished (not abandoned or cancelled by the contractor). */
  completionRate: number;
  onTimeRate: number;
  /** % of quote requests answered (quote or decline) before the deadline. */
  quoteResponseRate: number;
  /** Median hours from invitation to quote. */
  medianResponseHours: number;
  endorsements: number;
  /** Distinct Humo customers they've completed work for. */
  humoRelationships: number;
  yearsActive: number;
}

export interface ContractorAvailability {
  /** Earliest date they can start new work. */
  nextAvailable: string;
  status: 'available' | 'limited' | 'fully-booked';
}

/** Everything about one business as a contractor. */
export interface ContractorProfile {
  party: BusinessParty;
  summary: string;
  services: ContractorService[];
  areas: ServiceArea[];
  documents: ContractorDocument[];
  insurance: InsuranceCover[];
  verification: ContractorVerification;
  reputation: ContractorReputation;
  endorsements: ContractorEndorsement[];
  availability: ContractorAvailability;
}

// ---------------------------------------------------------------- Quote requests & quotes

/** One request, many quotes. Humo never chooses for the customer. */
export interface QuoteRequest {
  id: string;
  /** The Humo customer asking (a managing agency today; could be any business later). */
  customerId: string;
  customerName: string;
  /** Where the work is — suburb-level until a quote is accepted. */
  site: { name: string; suburb: string; city: string };
  /** The originating record in the customer's product, e.g. a Humo PM job. */
  source?: { product: 'humo-pm'; ref: string };
  title: string;
  description: string;
  category: ServiceCategory;
  requirements: string[];
  photos: number;
  deadline: string;
  createdAt: string;
  createdBy: string;
  status: 'open' | 'closed' | 'awarded' | 'cancelled';
  invitations: QuoteInvitation[];
}

export interface QuoteInvitation {
  partyId: string;
  invitedAt: string;
  /** Invited from the customer's existing suppliers, or by email to join Humo. */
  via: 'existing-relationship' | 'email-invite';
  status: 'invited' | 'viewed' | 'quoted' | 'declined' | 'expired';
  declineReason?: string;
}

export interface ContractorQuote {
  id: string;
  quoteRequestId: string;
  partyId: string;
  amount: number;
  /** In the contractor's words: what they'll do. */
  proposedWork: string[];
  exclusions?: string;
  startBy: string;
  completeBy: string;
  validUntil: string;
  guaranteeMonths: number;
  submittedAt: string;
  /** Set by the customer when comparing. The recommendation is theirs, not Humo's. */
  recommendedByCustomer?: boolean;
  status: 'submitted' | 'accepted' | 'not-selected' | 'withdrawn';
}

/** A work order: an accepted quote turned into work. Its progress mirrors the customer's job. */
export interface WorkOrder {
  id: string;
  partyId: string;
  customerId: string;
  customerName: string;
  quoteRequestId?: string;
  source?: { product: 'humo-pm'; ref: string };
  title: string;
  site: string;
  amount: number;
  scheduledFor?: string;
  status: 'awarded' | 'scheduled' | 'in-progress' | 'completed' | 'invoiced' | 'paid';
}

// ---------------------------------------------------------------- Contact disclosure

/**
 * Before a quote is accepted, each side sees what it needs to decide — not
 * direct personal contact details. Conversation happens through Humo, which
 * keeps the quote lifecycle visible. After acceptance, contact details open up.
 */
export interface ContactDisclosure {
  contactVisible: boolean;
  reason: string;
}

export function disclosureFor(request: QuoteRequest, quote: ContractorQuote | undefined, existingRelationship: boolean): ContactDisclosure {
  if (quote?.status === 'accepted') return { contactVisible: true, reason: 'Quote accepted — contact details are shared.' };
  if (existingRelationship) return { contactVisible: true, reason: 'You already work with this business.' };
  if (request.status === 'cancelled') return { contactVisible: false, reason: 'Request cancelled.' };
  return { contactVisible: false, reason: 'Contact details are shared once a quote is accepted. Until then, message through Humo.' };
}

// ---------------------------------------------------------------- Lifecycle events & future commercial rules

export type QuoteLifecycleEventType =
  | 'quote-request-created'
  | 'contractor-invited'
  | 'quote-submitted'
  | 'quote-viewed'
  | 'quote-accepted'
  | 'quote-rejected'
  | 'quote-declined'
  | 'work-started'
  | 'work-completed'
  | 'invoice-submitted'
  | 'job-completed';

export const LIFECYCLE_LABEL: Record<QuoteLifecycleEventType, string> = {
  'quote-request-created': 'Quote request created',
  'contractor-invited': 'Contractor invited',
  'quote-submitted': 'Quote submitted',
  'quote-viewed': 'Quote viewed',
  'quote-accepted': 'Quote accepted',
  'quote-rejected': 'Quote not selected',
  'quote-declined': 'Contractor declined',
  'work-started': 'Work started',
  'work-completed': 'Work completed',
  'invoice-submitted': 'Invoice submitted',
  'job-completed': 'Job completed',
};

/**
 * Every step of the quote lifecycle is an event. Future commercial rules
 * (lead fees, transaction fees, contractor subscriptions, enterprise
 * unlimited…) can be applied to this stream without changing the workflow.
 */
export interface QuoteLifecycleEvent {
  id: string;
  at: string;
  type: QuoteLifecycleEventType;
  quoteRequestId: string;
  customerId: string;
  partyId?: string;
  quoteId?: string;
  amount?: number;
  actor: string;
}

/** The revenue models the event stream must not rule out. None is implemented. */
export type CommercialModel =
  | 'customer-subscription-unlimited'
  | 'contractor-subscription'
  | 'lead-fee'
  | 'transaction-fee'
  | 'hybrid-usage'
  | 'enterprise-unlimited';

export interface ChargeDecision {
  chargeable: false;
  /** Explains, for the audit trail, that nothing was charged. */
  note: string;
}

/** A policy turns lifecycle events into (future) charges. Today: never. */
export interface CommercialPolicy {
  model: CommercialModel | 'none';
  evaluate(event: QuoteLifecycleEvent): ChargeDecision;
}

export const NO_CHARGE_POLICY: CommercialPolicy = {
  model: 'none',
  evaluate: () => ({ chargeable: false, note: 'No commercial rules are active.' }),
};

// ---------------------------------------------------------------- Future discovery (not exposed)

/**
 * How contractors could one day be found. Defined so the data model supports
 * it; there is deliberately no directory, search page or marketplace.
 */
export interface ContractorQuery {
  category?: ServiceCategory;
  area?: string;
  availableBy?: string;
  minRating?: number;
  minEndorsements?: number;
  verification?: VerificationLevel;
  complianceValid?: boolean;
}
