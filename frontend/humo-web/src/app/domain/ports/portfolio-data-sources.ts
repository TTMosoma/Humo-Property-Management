import { Observable } from 'rxjs';
import { ListQuery, Page } from './list-query';
import { Note, TimelineEvent } from '../models/timeline';
import {
  AccountDetail,
  MatchView,
  PersonSummary,
  ReceiptView,
  StatementView,
  UnitSummary,
} from '../models/read-models';

/**
 * Ports for Slice A. Each is a thin, task-shaped contract; the in-memory
 * versions live in mock/, HTTP versions will call the .NET API.
 * Queries are live: they emit again when the underlying data changes
 * (e.g. an allocation updates every open account view). Over HTTP that is
 * re-fetch on change — see core/data/data-changes.ts.
 */
export abstract class UnitDataSource {
  abstract list(schemeIds: string[], query?: ListQuery): Observable<Page<UnitSummary>>;
  abstract get(schemeId: string, unitNumber: string): Observable<UnitSummary | undefined>;
  abstract byId(unitId: string): Observable<UnitSummary | undefined>;
  /** "KC 42", "kingfisher 42", "KC-042", "unit 42" … */
  abstract search(query: string, schemeIds: string[], limit?: number): Observable<UnitSummary[]>;
}

export abstract class PersonDataSource {
  abstract list(schemeIds: string[], query?: ListQuery): Observable<Page<PersonSummary>>;
  abstract get(personId: string): Observable<PersonSummary | undefined>;
  abstract search(query: string, schemeIds: string[], limit?: number): Observable<PersonSummary[]>;
}

export abstract class AccountDataSource {
  abstract get(accountId: string): Observable<AccountDetail | undefined>;
  abstract statement(accountId: string, period: string): Observable<StatementView | undefined>;
}

export abstract class ReceiptDataSource {
  abstract list(schemeIds: string[], query?: ListQuery): Observable<Page<ReceiptView>>;
  abstract matches(receiptId: string): Observable<MatchView[]>;
  /** Unallocated receipts whose best match is this account ("did they pay and we missed it?"). */
  abstract suggestedFor(accountId: string): Observable<ReceiptView[]>;
  /** `expectedVersion`: the record's version as shown; the API answers 409 (conflict) if it has changed since. */
  abstract allocate(receiptId: string, allocations: { accountId: string; amount: number }[], rememberPayer: boolean, expectedVersion?: number): Observable<void>;
  abstract unallocate(receiptId: string, expectedVersion?: number): Observable<void>;
  abstract moveToSuspense(receiptId: string, expectedVersion?: number): Observable<void>;
}

export abstract class TimelineDataSource {
  abstract forUnit(unitId: string): Observable<TimelineEvent[]>;
  abstract forPerson(personId: string): Observable<TimelineEvent[]>;
  abstract addNote(note: Omit<Note, 'id' | 'at' | 'author'>): Observable<void>;
}
