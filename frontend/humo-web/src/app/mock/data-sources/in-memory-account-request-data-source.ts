import { Injectable, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, combineLatest, map, switchMap } from 'rxjs';
import { ACCOUNT_POLICY_LABELS, AccountApprovalPolicy, AccountDecision, AccountPolicySetting, AccountRequestDataSource, AccountRequestView, AccountSubmission, FieldErrors, NewAccountDetails, isSoleSystemAdmin } from '../../domain';
import { AccountRequestStore } from '../db/account-request-store';
import { OrganisationStore } from '../db/organisation-store';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';
import { AccessStore } from '../db/access-store';
import { MockGateway } from '../server/mock-gateway';

/** The permission that lets an Account Manager activate without a separate approval. Granted individually only. */
const DELEGATED = 'Platform.Customers.ActivateWithoutApproval' as const;

/**
 * New customer accounts. The rules live here (the API), not in the screens:
 * - Submitting needs Platform.Customers.Manage. Whether it waits for approval
 *   or is activated is decided here, from the submitter's own grants and the
 *   policy, never from anything the client sends.
 * - Deciding needs Platform.Customers.Approve, and not on your own request.
 * - Only a waiting request can be decided; a rejected one never creates an organisation.
 * - Activation creates the organisation (onboarding) and nothing else: no users,
 *   no invitations. The first administrator is invited as before.
 */
@Injectable()
export class InMemoryAccountRequestDataSource extends AccountRequestDataSource {
  private readonly store = inject(AccountRequestStore);
  private readonly orgs = inject(OrganisationStore);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly access = inject(AccessStore);
  private readonly respond = mockResponder();

  private readonly views = computed<AccountRequestView[]>(() => {
    const status = new Map(this.orgs.all().map((o) => [o.id, o.status]));
    return [...this.store.requests()]
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .map((request) => ({ request, organisationStatus: request.organisationId ? status.get(request.organisationId) : undefined }));
  });
  private readonly views$ = toObservable(this.views);
  private readonly policy$ = toObservable(this.store.policy);

  /** Humo staff who work with customers see the requests; nobody else. */
  list(): Observable<AccountRequestView[]> {
    return combineLatest([this.views$, this.auth.session$]).pipe(switchMap(([all]) => this.respond(this.auth.can('Platform.Customers.View') ? all : [])));
  }

  get(id: string): Observable<AccountRequestView | undefined> {
    return this.list().pipe(map((all) => all.find((v) => v.request.id === id)));
  }

  policy(): Observable<AccountPolicySetting> {
    return this.policy$.pipe(switchMap((p) => this.respond(p)));
  }

  submit(details: NewAccountDetails): Observable<AccountSubmission> {
    const me = this.auth.actor();
    const policy = this.store.policy().policy;
    // The server's decision: the submitter's own grant, and a policy that honours it.
    const delegated = this.auth.can(DELEGATED) && policy === 'delegation-allowed';
    const { id, ref } = this.store.nextRef();
    const name = details.shortName.trim();
    return this.gateway.command(
      {
        action: delegated
          ? `Activated new customer account ${ref} (${name}) under delegated authority — ${DELEGATED}; policy: ${ACCOUNT_POLICY_LABELS[policy]}`
          : `Submitted new customer account ${ref} (${name}) for approval`,
        resource: 'Account request',
        resourceId: id,
        category: 'security',
        permission: 'Platform.Customers.Manage',
        validate: () => this.store.validate(details),
      },
      (): AccountSubmission => {
        const now = new Date().toISOString();
        const manager = this.store.accountManager(details.accountManagerId)!;
        const clean: NewAccountDetails = { ...details, name: details.name.trim(), shortName: name, city: details.city.trim(), notes: details.notes?.trim() || undefined };
        const organisationId = delegated ? this.store.createOrganisation(clean) : undefined;
        this.store.add({
          id, ref, version: 1, details: clean, accountManager: manager.name, policy,
          status: delegated ? 'approved' : 'pending',
          route: delegated ? 'delegated' : 'approval',
          requestedById: me.id, requestedBy: me.name, requestedAt: now,
          ...(delegated ? { decidedById: me.id, decidedBy: me.name, decidedAt: now, organisationId } : {}),
        });
        this.store.notify(
          delegated
            ? { to: { role: 'system-admin' }, actorId: me.id, title: `Activated with delegated authority: ${name}`, detail: `${me.name} activated ${ref} without separate approval. It’s onboarding now.`, link: `/platform/account-requests/${id}` }
            : { to: { role: 'system-admin' }, actorId: me.id, title: `New account waiting for approval: ${name}`, detail: `${me.name} submitted ${ref}.`, link: `/platform/account-requests/${id}` },
        );
        return { requestId: id, ref, outcome: delegated ? 'activated' : 'pending', organisationId };
      },
    );
  }

  decide(id: string, d: AccountDecision, expectedVersion?: number): Observable<void> {
    const r = this.store.get(id);
    const me = this.auth.actor();
    const name = r?.details.shortName ?? id;
    return this.gateway
      .command(
        {
          action: `${d.type === 'approve' ? `Approved new customer account ${r?.ref ?? id} (${name})` : `Rejected new customer account ${r?.ref ?? id} (${name}) — ${d.reason.trim()}`}${r?.requestedById === me.id ? ' — own request, decided by the sole System Administrator' : ''}`,
          resource: 'Account request',
          resourceId: id,
          category: 'security',
          permission: 'Platform.Customers.Approve',
          version: { expected: expectedVersion, current: r?.version },
          validate: (): FieldErrors | null => {
            if (!r) return { id: 'That request no longer exists.' };
            if (r.status !== 'pending') return { status: `It’s already ${r.status}.` };
            // Sole-administrator safeguard: with one System Administrator, nobody else could ever decide.
            if (r.requestedById === me.id && !isSoleSystemAdmin(this.access.identities(), me.id)) return { status: 'Another System Administrator decides on a request you submitted.' };
            if (d.type === 'reject') return d.reason.trim().length < 5 ? { reason: 'Say why, in a few words. The submitter sees it, and it goes in the audit log.' } : null;
            // Approving re-checks: the customer may have been added since, or the account manager may have left.
            return this.store.validate(r.details, r.id);
          },
        },
        () => {
          const now = new Date().toISOString();
          const organisationId = d.type === 'approve' ? this.store.createOrganisation(r!.details) : undefined;
          this.store.change(id, (x) => ({
            ...x,
            status: d.type === 'approve' ? 'approved' : 'rejected',
            decidedById: me.id,
            decidedBy: me.name,
            decidedAt: now,
            ...(d.type === 'reject' ? { reason: d.reason.trim() } : { organisationId }),
          }));
          this.store.notify({
            to: { identityId: r!.requestedById },
            actorId: me.id,
            title: d.type === 'approve' ? `Approved: ${name}` : `Rejected: ${name}`,
            detail: d.type === 'approve' ? `${me.name} approved ${r!.ref}. It’s onboarding: invite their first administrator next.` : `${me.name} rejected ${r!.ref}: ${d.reason.trim()}`,
            link: `/platform/account-requests/${id}`,
          });
          this.store.notify({ to: { role: 'system-admin' }, actorId: me.id, title: `${d.type === 'approve' ? 'Approved' : 'Rejected'}: ${name}`, detail: `${me.name} decided ${r!.ref}.`, link: `/platform/account-requests/${id}` });
        },
      )
      .pipe(map(() => undefined));
  }

  setPolicy(policy: AccountApprovalPolicy, reason: string, expectedVersion?: number): Observable<void> {
    const me = this.auth.actor();
    const current = this.store.policy();
    return this.gateway
      .command(
        {
          action: `Changed the account-creation policy to “${ACCOUNT_POLICY_LABELS[policy]}” — ${reason.trim()}`,
          resource: 'Account policy',
          category: 'security',
          permission: 'Platform.Config.Manage',
          version: { expected: expectedVersion, current: current.version },
          validate: (): FieldErrors | null => {
            if (!(policy in ACCOUNT_POLICY_LABELS)) return { policy: 'Choose a policy.' };
            if (policy === current.policy) return { policy: 'That’s already the policy.' };
            return reason.trim().length < 5 ? { reason: 'Say why, in a few words. It goes in the audit log.' } : null;
          },
        },
        () => {
          // New requests only: anything waiting stays waiting.
          this.store.setPolicy(policy, me.name);
          this.store.notify({ to: { role: 'system-admin' }, actorId: me.id, title: 'Account-creation policy changed', detail: `${me.name}: ${ACCOUNT_POLICY_LABELS[policy]}.`, link: '/platform/account-requests' });
        },
      )
      .pipe(map(() => undefined));
  }
}
