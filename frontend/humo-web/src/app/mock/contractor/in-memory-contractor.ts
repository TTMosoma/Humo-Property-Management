import { Injectable, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, map, switchMap } from 'rxjs';
import {
  ContractorDashboard,
  ContractorEndorsement,
  ContractorNetwork,
  ContractorPortal,
  ContractorProfile,
  ContractorRequestView,
  NewQuoteRequest,
  QuoteRequest,
  QuoteRequestView,
  QuoteSubmission,
  WorkOrder,
} from '../../domain/contractor';
import { JobStage, PolicyError } from '../../domain';
import { SessionService } from '../../core/session/session.service';
import { MaintenanceStore } from '../db/maintenance-store';
import { MockDb } from '../db/mock-db';
import { mockResponder } from '../mock-latency';
import { MockGateway } from '../server/mock-gateway';
import { ContractorStore } from './contractor-store';

/** Simulated integration feed: a PM job's stage drives the contractor's work order status. */
const FROM_JOB: Partial<Record<JobStage, WorkOrder['status']>> = {
  approval: 'awarded',
  approved: 'awarded',
  scheduled: 'scheduled',
  'in-progress': 'in-progress',
  completed: 'completed',
  verified: 'completed',
  invoiced: 'invoiced',
  paid: 'paid',
  closed: 'paid',
};

@Injectable()
export class InMemoryContractorNetwork extends ContractorNetwork {
  private readonly store = inject(ContractorStore);
  private readonly gateway = inject(MockGateway);
  private readonly session = inject(SessionService);
  private readonly respond = mockResponder();
  private readonly state$ = toObservable(
    computed(() => ({ profiles: this.store.profiles(), requests: this.store.requests(), quotes: this.store.quotes(), events: this.store.events() })),
  );

  profile(partyId: string): Observable<ContractorProfile | undefined> {
    return this.state$.pipe(switchMap((s) => this.respond(s.profiles.find((p) => p.party.id === partyId))));
  }

  profiles(partyIds: string[]): Observable<ContractorProfile[]> {
    return this.state$.pipe(switchMap((s) => this.respond(s.profiles.filter((p) => partyIds.includes(p.party.id)))));
  }

  quoteRequestFor(source: { product: 'humo-pm'; ref: string }): Observable<QuoteRequestView | undefined> {
    return this.state$.pipe(
      switchMap((s) => {
        const r = s.requests.find((x) => x.source?.product === source.product && x.source.ref === source.ref && x.status !== 'cancelled');
        return this.respond(r ? this.view(r) : undefined);
      }),
    );
  }

  quoteRequest(id: string): Observable<QuoteRequestView | undefined> {
    return this.state$.pipe(switchMap((s) => this.respond(s.requests.find((x) => x.id === id)).pipe(map((r) => (r ? this.view(r) : undefined)))));
  }

  createQuoteRequest(input: NewQuoteRequest): Observable<string> {
    const by = this.session.persona().name;
    return this.gateway.command({ action: `Requested quotes through Humo: ${input.title}`, resource: 'Quote request', permission: 'Maintenance.Manage' }, () => {
      const id = this.store.nextId('QR');
      const now = new Date().toISOString();
      const { invite, ...rest } = input;
      this.store.addRequest({
        ...rest, id, createdAt: now, createdBy: by, status: 'open',
        invitations: invite.map((i) => ({ partyId: i.partyId, invitedAt: now, via: i.via, status: 'invited' as const })),
      });
      this.store.emit({ type: 'quote-request-created', quoteRequestId: id, customerId: input.customerId, actor: by });
      for (const i of invite) this.store.emit({ type: 'contractor-invited', quoteRequestId: id, customerId: input.customerId, partyId: i.partyId, actor: by });
      return id;
    });
  }

  markViewed(quoteRequestId: string, quoteIds: string[]): void {
    if (this.session.isImpersonating()) return;
    const seen = new Set(this.store.events().filter((e) => e.type === 'quote-viewed' && e.quoteRequestId === quoteRequestId).map((e) => e.quoteId));
    const request = this.store.requests().find((r) => r.id === quoteRequestId);
    for (const q of this.store.quotes().filter((x) => quoteIds.includes(x.id) && !seen.has(x.id))) {
      this.store.emit({ type: 'quote-viewed', quoteRequestId, customerId: request?.customerId ?? '', partyId: q.partyId, quoteId: q.id, actor: this.session.persona().name });
    }
  }

  setRecommended(quoteRequestId: string, quoteId: string): Observable<void> {
    return this.gateway
      .command({ action: 'Marked a quote as recommended', resource: 'Quote request', resourceId: quoteRequestId, permission: 'Maintenance.Manage' }, () =>
        this.store.updateQuotes((q) => (q.quoteRequestId === quoteRequestId ? { ...q, recommendedByCustomer: q.id === quoteId } : q)),
      )
      .pipe(map(() => undefined));
  }

  accept(quoteRequestId: string, quoteId: string): Observable<void> {
    const by = this.session.persona().name;
    const quote = this.store.quotes().find((q) => q.id === quoteId);
    const request = this.store.requests().find((r) => r.id === quoteRequestId);
    return this.gateway
      .command(
        { action: `Accepted quote ${quoteId}`, resource: 'Quote request', resourceId: quoteRequestId, amount: quote?.amount, permission: 'Maintenance.Manage' },
        () => {
          if (!quote || !request || request.status !== 'open') throw new PolicyError('forbidden', 'This quote request is no longer open');
          this.store.updateQuotes((q) => (q.quoteRequestId !== quoteRequestId ? q : { ...q, status: q.id === quoteId ? 'accepted' : 'not-selected' }));
          this.store.updateRequest(quoteRequestId, (r) => ({ ...r, status: 'awarded' }));
          this.store.emit({ type: 'quote-accepted', quoteRequestId, customerId: request.customerId, partyId: quote.partyId, quoteId, amount: quote.amount, actor: by });
          for (const other of this.store.quotes().filter((q) => q.quoteRequestId === quoteRequestId && q.id !== quoteId)) {
            this.store.emit({ type: 'quote-rejected', quoteRequestId, customerId: request.customerId, partyId: other.partyId, quoteId: other.id, actor: by });
          }
          this.store.addWorkOrder({
            id: this.store.nextId('WO'), partyId: quote.partyId, customerId: request.customerId, customerName: request.customerName, quoteRequestId,
            source: request.source, title: request.title, site: `${request.site.name}, ${request.site.suburb}`, amount: quote.amount, status: 'awarded',
          });
        },
      )
      .pipe(map(() => undefined));
  }

  endorse(partyId: string, customerId: string, customerName: string, note: string, completedJobs: number): Observable<void> {
    const by = this.session.persona().name;
    return this.gateway
      .command({ action: 'Endorsed a contractor on Humo', resource: 'Contractor', resourceId: partyId, permission: 'Suppliers.Manage' }, () => {
        // The rule that makes endorsements meaningful: a real relationship, once per customer.
        if (completedJobs < 1) throw new PolicyError('forbidden', 'Only customers who have completed work with a contractor can endorse them');
        if (this.store.endorsements().some((e) => e.partyId === partyId && e.fromCustomerId === customerId)) throw new PolicyError('forbidden', 'Already endorsed');
        this.store.addEndorsement({ id: this.store.nextId('END'), partyId, fromCustomerId: customerId, fromCustomerName: customerName, endorsedBy: by, basedOnCompletedJobs: completedJobs, note, at: new Date().toISOString() });
      })
      .pipe(map(() => undefined));
  }

  private view(request: QuoteRequest): QuoteRequestView {
    const quotes = this.store.quotes().filter((q) => q.quoteRequestId === request.id);
    const ids = new Set([...request.invitations.map((i) => i.partyId), ...quotes.map((q) => q.partyId)]);
    const profiles = Object.fromEntries(this.store.profiles().filter((p) => ids.has(p.party.id)).map((p) => [p.party.id, p]));
    return { request, quotes, profiles, events: this.store.events().filter((e) => e.quoteRequestId === request.id) };
  }
}

@Injectable()
export class InMemoryContractorPortal extends ContractorPortal {
  private readonly store = inject(ContractorStore);
  private readonly maintenance = inject(MaintenanceStore);
  private readonly db = inject(MockDb);
  private readonly gateway = inject(MockGateway);
  private readonly session = inject(SessionService);
  private readonly respond = mockResponder();
  private readonly state$ = toObservable(
    computed(() => ({ profiles: this.store.profiles(), requests: this.store.requests(), quotes: this.store.quotes(), workOrders: this.store.workOrders(), events: this.store.events() })),
  );

  dashboard(partyId: string): Observable<ContractorDashboard | undefined> {
    // Re-read when PM jobs change, so linked work orders follow the customer's job.
    return this.db.changes$.pipe(
      switchMap(() => this.state$),
      switchMap((s) => {
        const profile = s.profiles.find((p) => p.party.id === partyId);
        if (!profile) return this.respond(undefined);
        const mine = s.requests.filter((r) => r.invitations.some((i) => i.partyId === partyId));
        const open = mine.filter((r) => r.status === 'open' && ['invited', 'viewed'].includes(r.invitations.find((i) => i.partyId === partyId)!.status));
        const submitted = s.quotes
          .filter((q) => q.partyId === partyId)
          .map((quote) => ({
            quote,
            request: s.requests.find((r) => r.id === quote.quoteRequestId)!,
            viewed: s.events.some((e) => e.type === 'quote-viewed' && e.quoteId === quote.id),
          }))
          .filter((x) => !!x.request);
        const workOrders = s.workOrders
          .filter((w) => w.partyId === partyId)
          .map((w) => {
            const job = w.source ? this.maintenance.detail(w.source.ref)?.job : undefined;
            return job ? { ...w, status: FROM_JOB[job.stage] ?? w.status, scheduledFor: job.workOrder?.scheduledFor ?? w.scheduledFor } : w;
          });
        const active = workOrders.filter((w) => !['invoiced', 'paid'].includes(w.status));
        return this.respond<ContractorDashboard>({
          profile,
          openRequests: open.length,
          activeJobs: active.length,
          completedJobs: profile.reputation.completedJobs,
          awaitingResponse: open.sort((a, b) => a.deadline.localeCompare(b.deadline)),
          submitted,
          workOrders,
        });
      }),
    );
  }

  request(partyId: string, quoteRequestId: string): Observable<ContractorRequestView | undefined> {
    return this.state$.pipe(
      switchMap((s) => {
        const request = s.requests.find((r) => r.id === quoteRequestId);
        const invitation = request?.invitations.find((i) => i.partyId === partyId);
        if (!request || !invitation) return this.respond(undefined);
        if (invitation.status === 'invited') queueMicrotask(() => this.setInvitation(partyId, quoteRequestId, 'viewed'));
        return this.respond<ContractorRequestView>({
          request,
          invitation,
          myQuote: s.quotes.find((q) => q.quoteRequestId === quoteRequestId && q.partyId === partyId),
          competing: request.invitations.length - 1,
        });
      }),
    );
  }

  submitQuote(partyId: string, quoteRequestId: string, sub: QuoteSubmission): Observable<void> {
    const request = this.store.requests().find((r) => r.id === quoteRequestId);
    return this.gateway
      .command({ action: `Submitted a quote for ${request?.title}`, resource: 'Quote', resourceId: quoteRequestId, amount: sub.amount, permission: 'Contractor.Respond' }, () => {
        if (!request || request.status !== 'open') throw new PolicyError('forbidden', 'This request is closed');
        const id = this.store.nextId('CQ');
        this.store.addQuote({ ...sub, id, quoteRequestId, partyId, submittedAt: new Date().toISOString(), status: 'submitted' });
        this.setInvitation(partyId, quoteRequestId, 'quoted');
        this.store.emit({ type: 'quote-submitted', quoteRequestId, customerId: request.customerId, partyId, quoteId: id, amount: sub.amount, actor: this.session.persona().name });
      })
      .pipe(map(() => undefined));
  }

  decline(partyId: string, quoteRequestId: string, reason: string): Observable<void> {
    const request = this.store.requests().find((r) => r.id === quoteRequestId);
    return this.gateway
      .command({ action: `Declined to quote: ${request?.title}`, resource: 'Quote', resourceId: quoteRequestId, permission: 'Contractor.Respond' }, () => {
        this.setInvitation(partyId, quoteRequestId, 'declined', reason);
        this.store.emit({ type: 'quote-declined', quoteRequestId, customerId: request?.customerId ?? '', partyId, actor: this.session.persona().name });
      })
      .pipe(map(() => undefined));
  }

  endorsements(partyId: string): Observable<ContractorEndorsement[]> {
    return this.state$.pipe(switchMap((s) => this.respond(s.profiles.find((p) => p.party.id === partyId)?.endorsements ?? [])));
  }

  private setInvitation(partyId: string, quoteRequestId: string, status: 'viewed' | 'quoted' | 'declined', declineReason?: string): void {
    this.store.updateRequest(quoteRequestId, (r) => ({
      ...r,
      invitations: r.invitations.map((i) => (i.partyId === partyId ? { ...i, status, declineReason } : i)),
    }));
  }
}
