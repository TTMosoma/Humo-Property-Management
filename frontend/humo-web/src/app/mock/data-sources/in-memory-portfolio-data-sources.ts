import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap, tap } from 'rxjs';
import {
  AccountDataSource,
  AccountDetail,
  MatchView,
  Note,
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
import { SessionService } from '../../core/session/session.service';
import { MockDb } from '../db/mock-db';
import { mockResponder } from '../mock-latency';

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

  list(schemeIds: string[]): Observable<UnitSummary[]> {
    return live(this.db, this.respond, () => this.db.unitsIn(schemeIds));
  }

  get(schemeId: string, unitNumber: string): Observable<UnitSummary | undefined> {
    return live(this.db, this.respond, () => {
      const unit = this.db.findUnit(schemeId, unitNumber);
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

  list(schemeIds: string[]): Observable<PersonSummary[]> {
    return live(this.db, this.respond, () => this.db.peopleIn(schemeIds));
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
  private readonly session = inject(SessionService);
  private readonly respond = mockResponder();

  list(schemeIds: string[]): Observable<ReceiptView[]> {
    return live(this.db, this.respond, () => this.db.receiptViews(schemeIds));
  }

  matches(receiptId: string): Observable<MatchView[]> {
    return instant(this.db, () => this.db.matches(receiptId));
  }

  suggestedFor(accountId: string): Observable<ReceiptView[]> {
    return instant(this.db, () => this.db.suggestedFor(accountId));
  }

  allocate(receiptId: string, allocations: { accountId: string; amount: number }[], rememberPayer: boolean): Observable<void> {
    return this.command(() => this.db.allocate(receiptId, allocations, rememberPayer, this.session.persona().name));
  }

  unallocate(receiptId: string): Observable<void> {
    return this.command(() => this.db.unallocate(receiptId));
  }

  moveToSuspense(receiptId: string): Observable<void> {
    return this.command(() => this.db.moveToSuspense(receiptId, this.session.persona().name));
  }

  /** Commands apply only after the simulated request succeeds. */
  private command(apply: () => void): Observable<void> {
    return this.respond(null).pipe(
      tap(() => apply()),
      map(() => undefined),
    );
  }
}

@Injectable()
export class InMemoryTimelineDataSource extends TimelineDataSource {
  private readonly db = inject(MockDb);
  private readonly session = inject(SessionService);
  private readonly respond = mockResponder();

  forUnit(unitId: string): Observable<TimelineEvent[]> {
    return live(this.db, this.respond, () => this.db.timelineForUnit(unitId));
  }

  forPerson(personId: string): Observable<TimelineEvent[]> {
    return live(this.db, this.respond, () => this.db.timelineForPerson(personId));
  }

  addNote(note: Omit<Note, 'id' | 'at' | 'author'>): Observable<void> {
    return this.respond(null).pipe(
      tap(() => this.db.addNote(note, this.session.persona().name)),
      map(() => undefined),
    );
  }
}
