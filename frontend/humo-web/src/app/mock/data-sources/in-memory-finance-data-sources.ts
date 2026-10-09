import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import {
  BillingAction,
  BillingDataSource,
  BillingRun,
  BillingRunSummary,
  CollectionAction,
  CollectionDataSource,
  CollectionView,
  ListQuery,
  NewBillingRun,
  Page,
  SchemeBillingStatus,
  periodLabel,
} from '../../domain';
import { formatRand } from '../../ui/format/money';
import { BillingStore } from '../db/billing-store';
import { CollectionsStore } from '../db/collections-store';
import { MockDb } from '../db/mock-db';
import { mockResponder } from '../mock-latency';
import { toPage } from '../mock-page';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

const BILLING_VERB: Record<BillingAction['type'], string> = {
  decide: 'Decided an exception in',
  'send-for-approval': 'Sent for approval',
  post: 'Posted',
  'send-statements': 'Sent the statements for',
  cancel: 'Cancelled',
  comment: 'Commented on',
};

@Injectable()
export class InMemoryBillingDataSource extends BillingDataSource {
  private readonly store = inject(BillingStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  status(schemeIds: string[]): Observable<SchemeBillingStatus[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond(schemeIds.filter((id) => this.db.schemes.has(id)).map((id) => this.store.status(id)))));
  }

  runs(schemeIds: string[], query?: ListQuery): Observable<Page<BillingRunSummary>> {
    return this.db.changes$.pipe(
      switchMap(() => {
        const items = this.store.runs
          .filter((r) => schemeIds.includes(r.schemeId))
          .sort((a, b) => b.period.localeCompare(a.period) || b.createdAt.localeCompare(a.createdAt))
          .map((r) => this.store.summary(r));
        return this.respond(toPage(items, query));
      }),
    );
  }

  get(id: string): Observable<(BillingRunSummary & { run: BillingRun }) | undefined> {
    return this.db.changes$.pipe(
      switchMap(() => {
        const run = this.store.runs.find((r) => r.id === id || r.ref === id);
        return this.respond(run ? this.store.summary(run) : undefined);
      }),
    );
  }

  create(input: NewBillingRun): Observable<string> {
    return this.gateway.command(
      {
        action: `Prepared ${periodLabel(input.period)} billing`,
        resource: 'BillingRun',
        schemeId: input.schemeId,
        permission: 'Billing.Run',
        feature: 'billing',
        validate: () => this.store.checkCreate(input),
      },
      () => this.store.create(input, this.auth.current.identity.name),
    );
  }

  act(id: string, action: BillingAction, expectedVersion?: number): Observable<void> {
    const run = this.store.runs.find((r) => r.id === id);
    return this.gateway
      .command(
        {
          action: `${BILLING_VERB[action.type]} ${run?.ref ?? id}`,
          resource: 'BillingRun',
          resourceId: run?.ref ?? id,
          schemeId: run?.schemeId,
          amount: action.type === 'post' && run ? run.lines.filter((l) => !l.excluded).reduce((s, l) => s + l.total, 0) : undefined,
          permission: 'Billing.Run',
          feature: 'billing',
          version: { expected: expectedVersion, current: run?.version },
          validate: () => (run ? this.store.check(run, action) : { id: 'This billing run no longer exists.' }),
        },
        () => this.store.act(id, action, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }

  adjust(accountId: string, amount: number, reason: string): Observable<void> {
    const account = this.db.accounts.get(accountId);
    return this.gateway
      .command(
        {
          action: `Posted a journal adjustment of ${formatRand(amount)} to ${account?.accountNo ?? accountId}`,
          resource: 'Account',
          resourceId: account?.accountNo,
          schemeId: account?.schemeId,
          amount: Math.abs(amount),
          permission: 'Billing.Run',
          feature: 'billing',
          validate: () => {
            const e: Record<string, string> = {};
            if (!account) e['account'] = 'No such account.';
            if (!amount || Number.isNaN(amount)) e['amount'] = 'Enter an amount: positive to charge, negative to credit.';
            else if (Math.abs(amount) > 100_000) e['amount'] = 'Adjustments over R 100 000 need a billing correction run, not a journal.';
            if (reason.trim().length < 5) e['reason'] = 'Say why: it appears on the owner’s statement and in the audit log.';
            return Object.keys(e).length ? e : null;
          },
        },
        () => this.db.adjust(accountId, amount, reason.trim(), this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }
}

const COLLECTION_VERB: Record<CollectionAction['type'], string> = {
  'send-letter': 'Sent a collection letter to',
  'request-demand-approval': 'Asked the trustees to approve a letter of demand for',
  'hand-over': 'Handed over',
  arrangement: 'Recorded a payment arrangement for',
  'missed-instalment': 'Recorded a missed instalment for',
  dispute: 'Recorded a dispute on',
  'resolve-dispute': 'Resolved the dispute on',
  note: 'Added a credit control note to',
};

@Injectable()
export class InMemoryCollectionDataSource extends CollectionDataSource {
  private readonly store = inject(CollectionsStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  list(schemeIds: string[], query?: ListQuery): Observable<Page<CollectionView>> {
    return this.db.changes$.pipe(switchMap(() => this.respond(toPage(this.store.list(schemeIds), query))));
  }

  get(accountId: string): Observable<CollectionView | undefined> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.get(accountId))));
  }

  act(accountId: string, action: CollectionAction, expectedVersion?: number): Observable<void> {
    const account = this.db.accounts.get(accountId);
    return this.gateway
      .command(
        {
          action: `${COLLECTION_VERB[action.type]} ${account?.accountNo ?? accountId}`,
          resource: 'Account',
          resourceId: account?.accountNo,
          schemeId: account?.schemeId,
          permission: 'Collections.Manage',
          feature: 'credit-control',
          version: { expected: expectedVersion, current: this.store.caseFor(accountId).version },
          validate: () => this.store.check(accountId, action),
        },
        () => this.store.act(accountId, action, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }

  remind(accountIds: string[], channel: 'email' | 'sms'): Observable<number> {
    return this.gateway.command(
      {
        action: `Sent ${accountIds.length} arrears reminders by ${channel}`,
        resource: 'Collections',
        permission: 'Collections.Manage',
        feature: 'credit-control',
        validate: () => (accountIds.length ? null : { accounts: 'Choose the accounts to remind.' }),
      },
      () => this.store.remind(accountIds, channel, this.auth.current.identity.name),
    );
  }
}
