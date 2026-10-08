import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import {
  AccountDataSource,
  AccountDetail,
  ListQuery,
  MatchView,
  Note,
  Page,
  PersonDataSource,
  PersonSummary,
  ReceiptDataSource,
  ReceiptView,
  StatementView,
  TimelineDataSource,
  TimelineEvent,
  UnitDataSource,
  UnitSummary,
} from '../../domain';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockDb } from '../db/mock-db';
import { mockResponder } from '../mock-latency';
import { toPage } from '../mock-page';
import { CommandSpec, MockGateway } from '../server/mock-gateway';

/** Re-runs a query whenever the mock database changes, with simulated latency. */
function live<T>(db: MockDb, respond: <V>(v: V) => Observable<V>, query: () => T): Observable<T> {
  return db.changes$.pipe(switchMap(() => respond(query())));
}

/** Searches answer instantly (they run on every keystroke). */
function instant<T>(db: MockDb, query: () => T): Observable<T> {
  return db.changes$.pipe(map(() => query()));
}

@Injectable()
export class InMemoryUnitDataSource extends UnitDataSource {
  private readonly db = inject(MockDb);
  private readonly respond = mockResponder();

  list(schemeIds: string[], query?: ListQuery): Observable<Page<UnitSummary>> {
    return live(this.db, this.respond, () => toPage(this.db.unitsIn(schemeIds), query));
  }

  get(schemeId: string, unitNumber: string): Observable<UnitSummary | undefined> {
    return live(this.db, this.respond, () => {
      const unit = this.db.findUnit(schemeId, unitNumber);
      return unit ? this.db.unitSummary(unit) : undefined;
    });
  }

  byId(unitId: string): Observable<UnitSummary | undefined> {
    return live(this.db, this.respond, () => {
      const unit = this.db.units.find((u) => u.id === unitId);
      return unit ? this.db.unitSummary(unit) : undefined;
    });
  }

  search(query: string, schemeIds: string[], limit?: number): Observable<UnitSummary[]> {
    return instant(this.db, () => this.db.searchUnits(query, schemeIds, limit));
  }
}

@Injectable()
export class InMemoryPersonDataSource extends PersonDataSource {
  private readonly db = inject(MockDb);
  private readonly respond = mockResponder();

  list(schemeIds: string[], query?: ListQuery): Observable<Page<PersonSummary>> {
    return live(this.db, this.respond, () => toPage(this.db.peopleIn(schemeIds), query));
  }

  get(personId: string): Observable<PersonSummary | undefined> {
    return live(this.db, this.respond, () => {
      const p = this.db.persons.get(personId);
      return p ? this.db.personSummary(p) : undefined;
    });
  }

  search(query: string, schemeIds: string[], limit?: number): Observable<PersonSummary[]> {
    return instant(this.db, () => this.db.searchPeople(query, schemeIds, limit));
  }
}

@Injectable()
export class InMemoryAccountDataSource extends AccountDataSource {
  private readonly db = inject(MockDb);
  private readonly respond = mockResponder();

  get(accountId: string): Observable<AccountDetail | undefined> {
    return live(this.db, this.respond, () => this.db.accountDetail(accountId));
  }

  statement(accountId: string, period: string): Observable<StatementView | undefined> {
    return live(this.db, this.respond, () => this.db.statement(accountId, period));
  }
}

@Injectable()
export class InMemoryReceiptDataSource extends ReceiptDataSource {
  private readonly db = inject(MockDb);
  private readonly session = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  list(schemeIds: string[], query?: ListQuery): Observable<Page<ReceiptView>> {
    return live(this.db, this.respond, () => toPage(this.db.receiptViews(schemeIds), query));
  }

  matches(receiptId: string): Observable<MatchView[]> {
    return instant(this.db, () => this.db.matches(receiptId));
  }

  suggestedFor(accountId: string): Observable<ReceiptView[]> {
    return instant(this.db, () => this.db.suggestedFor(accountId));
  }

  allocate(receiptId: string, allocations: { accountId: string; amount: number }[], rememberPayer: boolean, expectedVersion?: number): Observable<void> {
    const amount = allocations.reduce((n, a) => n + a.amount, 0);
    const to = allocations.map((a) => this.db.accounts.get(a.accountId)?.accountNo ?? a.accountId).join(', ');
    return this.command({ action: `Allocated receipt to ${to}`, amount, ...this.receiptSpec(receiptId, expectedVersion) }, () => this.db.allocate(receiptId, allocations, rememberPayer, this.session.current.identity.name));
  }

  unallocate(receiptId: string, expectedVersion?: number): Observable<void> {
    return this.command({ action: 'Reversed receipt allocation', ...this.receiptSpec(receiptId, expectedVersion) }, () => this.db.unallocate(receiptId));
  }

  moveToSuspense(receiptId: string, expectedVersion?: number): Observable<void> {
    return this.command({ action: 'Moved receipt to suspense', ...this.receiptSpec(receiptId, expectedVersion) }, () => this.db.moveToSuspense(receiptId, this.session.current.identity.name));
  }

  /** Commands apply only after the simulated request succeeds (and the API's policy allows them). */
  private command(spec: CommandSpec, apply: () => void): Observable<void> {
    return this.gateway.command(spec, apply).pipe(map(() => undefined));
  }

  private receiptSpec(receiptId: string, expectedVersion?: number): Omit<CommandSpec, 'action'> {
    const r = this.db.receipts.find((x) => x.id === receiptId);
    return { resource: 'Receipt', resourceId: receiptId, amount: r?.amount, schemeId: r?.schemeId, permission: 'Receipts.Allocate', version: { expected: expectedVersion, current: r?.version } };
  }
}

@Injectable()
export class InMemoryTimelineDataSource extends TimelineDataSource {
  private readonly db = inject(MockDb);
  private readonly session = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  forUnit(unitId: string): Observable<TimelineEvent[]> {
    return live(this.db, this.respond, () => this.db.timelineForUnit(unitId));
  }

  forPerson(personId: string): Observable<TimelineEvent[]> {
    return live(this.db, this.respond, () => this.db.timelineForPerson(personId));
  }

  addNote(note: Omit<Note, 'id' | 'at' | 'author'>): Observable<void> {
    return this.gateway
      .command({ action: 'Logged a note', resource: 'Note', permission: 'Notes.Add' }, () => this.db.addNote(note, this.session.current.identity.name))
      .pipe(map(() => undefined));
  }
}
