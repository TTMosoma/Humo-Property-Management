import { Injectable, computed, signal } from '@angular/core';
import {
  ContractorEndorsement,
  ContractorProfile,
  ContractorQuote,
  NO_CHARGE_POLICY,
  QuoteLifecycleEvent,
  QuoteRequest,
  WorkOrder,
} from '../../domain/contractor';
import { seedProfiles, seedQuoteRequests } from './seed-contractors';

/**
 * The Humo Contractor network's store (prototype). In production this is a
 * separate service with its own database; Humo PM talks to it through the
 * ContractorNetwork port only.
 */
@Injectable({ providedIn: 'root' })
export class ContractorStore {
  private readonly seed = seedProfiles();
  private readonly base = signal<ContractorProfile[]>(this.seed.profiles);
  readonly endorsements = signal<ContractorEndorsement[]>(this.seed.endorsements);
  private readonly qr = seedQuoteRequests();
  readonly requests = signal<QuoteRequest[]>(this.qr.requests);
  readonly quotes = signal<ContractorQuote[]>(this.qr.quotes);
  readonly events = signal<QuoteLifecycleEvent[]>(this.qr.events);
  readonly workOrders = signal<WorkOrder[]>(this.qr.workOrders);

  /** Profiles with their endorsements joined and counted. */
  readonly profiles = computed<ContractorProfile[]>(() => {
    const ends = this.endorsements();
    return this.base().map((p) => {
      const mine = ends.filter((e) => e.partyId === p.party.id).sort((a, b) => b.at.localeCompare(a.at));
      return { ...p, endorsements: mine, reputation: { ...p.reputation, endorsements: mine.length } };
    });
  });

  private seq = 1;

  profile(partyId: string): ContractorProfile | undefined {
    return this.profiles().find((p) => p.party.id === partyId);
  }

  /** Every lifecycle event goes through here: the hook for future commercial rules. */
  emit(e: Omit<QuoteLifecycleEvent, 'id' | 'at'>): void {
    const event: QuoteLifecycleEvent = { ...e, id: `qe-live-${this.seq++}`, at: new Date().toISOString() };
    NO_CHARGE_POLICY.evaluate(event); // Always "not chargeable" today; the call site is what matters.
    this.events.update((all) => [...all, event]);
  }

  updateRequest(id: string, change: (r: QuoteRequest) => QuoteRequest): void {
    this.requests.update((all) => all.map((r) => (r.id === id ? change(r) : r)));
  }

  updateQuotes(change: (q: ContractorQuote) => ContractorQuote): void {
    this.quotes.update((all) => all.map(change));
  }

  addRequest(r: QuoteRequest): void {
    this.requests.update((all) => [r, ...all]);
  }

  addQuote(q: ContractorQuote): void {
    this.quotes.update((all) => [...all, q]);
  }

  addWorkOrder(w: WorkOrder): void {
    this.workOrders.update((all) => [w, ...all]);
  }

  addEndorsement(e: ContractorEndorsement): void {
    this.endorsements.update((all) => [e, ...all]);
  }

  nextId(prefix: string): string {
    return `${prefix}-${9000 + this.seq++}`;
  }
}
