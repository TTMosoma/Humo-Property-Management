import { Injectable, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, defer, map, of, switchMap } from 'rxjs';
import {
  ContractorNetwork,
  ContractorProfile,
  NewQuoteRequest,
  QuoteRequest,
  QuoteRequestView,
  disclosureFor,
} from '../../domain/contractor';
import { FieldErrors, PolicyError } from '../../domain';
import { MockAuthSession } from '../server/mock-auth-session';
import { MaintenanceStore } from '../db/maintenance-store';
import { mockResponder } from '../mock-latency';
import { MockGateway } from '../server/mock-gateway';
import { ContractorStore } from './contractor-store';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class InMemoryContractorNetwork extends ContractorNetwork {
  private readonly store = inject(ContractorStore);
  private readonly gateway = inject(MockGateway);
  private readonly session = inject(MockAuthSession);
  private readonly maintenance = inject(MaintenanceStore);
  private readonly respond = mockResponder();
  private readonly state$ = toObservable(
    computed(() => ({ profiles: this.store.profiles(), requests: this.store.requests(), quotes: this.store.quotes(), events: this.store.events() })),
  );

  profile(partyId: string): Observable<ContractorProfile | undefined> {
    return this.state$.pipe(switchMap((s) => this.respond(this.forCustomer(s.profiles.find((p) => p.party.id === partyId)))));
  }

  profiles(partyIds: string[]): Observable<ContractorProfile[]> {
    return this.state$.pipe(switchMap((s) => this.respond(s.profiles.filter((p) => partyIds.includes(p.party.id)).map((p) => this.forCustomer(p)!))));
  }

  /** Businesses the customer already works with (a supplier record linked to the party). */
  private worksWith(partyId: string): boolean {
    return this.maintenance.suppliers.some((s) => s.partyId === partyId);
  }

  /** A profile as a customer may see it: no direct contact details without a relationship. */
  private forCustomer(p: ContractorProfile | undefined, visible = p ? this.worksWith(p.party.id) : false): ContractorProfile | undefined {
    if (!p || visible) return p;
    const { contact: _hidden, ...party } = p.party;
    return { ...p, party };
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
    const by = this.session.current.identity.name;
    const emails = [...new Set((input.inviteEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const validate = (): FieldErrors | null => {
      const bad = emails.find((e) => !EMAIL.test(e));
      if (bad) return { inviteEmails: `“${bad}” isn’t an email address.` };
      return input.invite.length || emails.length ? null : { invite: 'Choose at least one contractor, or invite one by email.' };
    };
    return this.gateway.command({ action: `Requested quotes through Humo Contractor: ${input.title}`, resource: 'Quote request', permission: 'Maintenance.Manage', validate }, () => {
      const id = this.store.nextId('QR');
      const now = new Date().toISOString();
      const { invite, inviteEmails: _emails, ...rest } = input;
      this.store.addRequest({
        ...rest, id, createdAt: now, createdBy: by, status: 'open',
        invitations: invite.map((i) => ({ partyId: i.partyId, invitedAt: now, via: i.via, status: 'invited' as const })),
        emailInvites: emails.map((email) => ({ email, invitedAt: now })),
      });
      this.store.emit({ type: 'quote-request-created', quoteRequestId: id, customerId: input.customerId, actor: by });
      for (const i of invite) this.store.emit({ type: 'contractor-invited', quoteRequestId: id, customerId: input.customerId, partyId: i.partyId, actor: by });
      // SIMULATED (docs/18 R-4): no email is sent. Production emails a sign-up link for Humo Contractor that opens this request.
      for (const email of emails) this.store.emit({ type: 'contractor-invited-by-email', quoteRequestId: id, customerId: input.customerId, detail: email, actor: by });
      return id;
    });
  }

  /** SIMULATED (docs/18 R-3): kept on the quote request; nobody is notified. */
  message(quoteRequestId: string, partyId: string, body: string): Observable<void> {
    const by = this.session.current.identity.name;
    const request = this.store.requests().find((r) => r.id === quoteRequestId);
    const validate = (): FieldErrors | null => {
      if (!request || !request.invitations.some((i) => i.partyId === partyId)) return { partyId: 'They weren’t invited to this quote request.' };
      return body.trim() ? null : { body: 'Write your message.' };
    };
    return this.gateway
      .command({ action: 'Messaged a contractor about a quote', resource: 'Quote request', resourceId: quoteRequestId, permission: 'Maintenance.Manage', validate }, () => {
        const message = { id: this.store.nextId('QM'), partyId, at: new Date().toISOString(), from: 'customer' as const, author: by, body: body.trim() };
        this.store.updateRequest(quoteRequestId, (r) => ({ ...r, messages: [...(r.messages ?? []), message] }));
        this.store.emit({ type: 'message-sent', quoteRequestId, customerId: request!.customerId, partyId, actor: by });
      })
      .pipe(map(() => undefined));
  }

  /** Recorded on subscribe, like a POST. Impersonation never counts as the customer having looked. */
  markViewed(quoteRequestId: string, quoteIds: string[]): Observable<void> {
    return defer(() => {
      if (!this.session.current.impersonation) {
        const seen = new Set(this.store.events().filter((e) => e.type === 'quote-viewed' && e.quoteRequestId === quoteRequestId).map((e) => e.quoteId));
        const request = this.store.requests().find((r) => r.id === quoteRequestId);
        for (const q of this.store.quotes().filter((x) => quoteIds.includes(x.id) && !seen.has(x.id))) {
          this.store.emit({ type: 'quote-viewed', quoteRequestId, customerId: request?.customerId ?? '', partyId: q.partyId, quoteId: q.id, actor: this.session.current.identity.name });
        }
      }
      return of(undefined);
    });
  }

  setRecommended(quoteRequestId: string, quoteId: string): Observable<void> {
    return this.gateway
      .command({ action: 'Marked a quote as recommended', resource: 'Quote request', resourceId: quoteRequestId, permission: 'Maintenance.Manage' }, () =>
        this.store.updateQuotes((q) => (q.quoteRequestId === quoteRequestId ? { ...q, recommendedByCustomer: q.id === quoteId } : q)),
      )
      .pipe(map(() => undefined));
  }

  accept(quoteRequestId: string, quoteId: string): Observable<void> {
    const by = this.session.current.identity.name;
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
        },
      )
      .pipe(map(() => undefined));
  }

  endorse(partyId: string, customerId: string, customerName: string, note: string, completedJobs: number): Observable<void> {
    const by = this.session.current.identity.name;
    return this.gateway
      .command({ action: 'Endorsed a contractor on Humo Contractor', resource: 'Contractor', resourceId: partyId, permission: 'Suppliers.Manage' }, () => {
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
    const disclosure = Object.fromEntries(
      [...ids].map((id) => [id, disclosureFor(request, quotes.find((q) => q.partyId === id && q.status !== 'withdrawn'), this.worksWith(id))]),
    );
    const profiles = Object.fromEntries(
      this.store.profiles().filter((p) => ids.has(p.party.id)).map((p) => [p.party.id, this.forCustomer(p, disclosure[p.party.id].contactVisible)!]),
    );
    return { request, quotes, profiles, disclosure, events: this.store.events().filter((e) => e.quoteRequestId === request.id) };
  }
}
