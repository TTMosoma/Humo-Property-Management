import { Observable } from 'rxjs';
import { ListQuery, Page } from './list-query';
import { Person, RelationshipType } from '../models/person';
import { Note, TimelineEvent } from '../models/timeline';
import { Unit } from '../models/unit';
import { NewReceipt, StatementImportBatch, StatementImportResult, StatementMapping, StatementPreview } from '../models/bank-statement';
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
export type UnitDetails = Pick<Unit, 'number' | 'description' | 'sizeM2' | 'participationQuota' | 'monthlyLevy' | 'occupancy'> & { block?: string };

export type PersonDetails = Pick<Person, 'firstName' | 'lastName' | 'kind' | 'email' | 'phone' | 'preferredChannel'> & { postalAddress?: string };

export interface NewRelationship {
  type: RelationshipType;
  schemeId: string;
  /** Owners and tenants. */
  unitId?: string;
  /** Trustees: Chairperson, Treasurer, Trustee. */
  portfolio?: string;
  since: string;
  /** Tenants: lease end. */
  until?: string;
}

export abstract class UnitDataSource {
  abstract list(schemeIds: string[], query?: ListQuery): Observable<Page<UnitSummary>>;
  abstract get(schemeId: string, unitNumber: string): Observable<UnitSummary | undefined>;
  abstract byId(unitId: string): Observable<UnitSummary | undefined>;
  /** Adds a unit (and its levy account) to a scheme. Returns the unit id. */
  abstract create(schemeId: string, details: UnitDetails): Observable<string>;
  abstract update(unitId: string, details: UnitDetails, expectedVersion?: number): Observable<void>;
  /** "KC 42", "kingfisher 42", "KC-042", "unit 42" … */
  abstract search(query: string, schemeIds: string[], limit?: number): Observable<UnitSummary[]>;
}

export abstract class PersonDataSource {
  abstract list(schemeIds: string[], query?: ListQuery): Observable<Page<PersonSummary>>;
  /** Adds someone to the directory, optionally linked straight to a unit or board. Returns the person id. */
  abstract create(details: PersonDetails, link?: NewRelationship): Observable<string>;
  abstract update(personId: string, details: PersonDetails, expectedVersion?: number): Observable<void>;
  /** Owner or tenant of a unit, or trustee of a scheme. */
  abstract addRelationship(personId: string, link: NewRelationship): Observable<void>;
  /** Ends it on a date (sold, moved out, stepped down). The history stays. */
  abstract endRelationship(relationshipId: string, until: string): Observable<void>;
  abstract get(personId: string): Observable<PersonSummary | undefined>;
  abstract search(query: string, schemeIds: string[], limit?: number): Observable<PersonSummary[]>;
}

export abstract class AccountDataSource {
  abstract get(accountId: string): Observable<AccountDetail | undefined>;
  abstract statement(accountId: string, period: string): Observable<StatementView | undefined>;
  /**
   * Emails the period's statement to the account holder and records it in
   * Communications › Sent (D9). Returns the Sent message id.
   * PRODUCTION: real delivery of the stored PDF (D7) — see docs/18 R-1.
   */
  abstract sendStatement(accountId: string, period: string): Observable<string>;
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
  // ---- docs/22 §1: receipt capture and bank-statement import (flag `receipt-capture`, Receipts.Allocate)
  /** A receipt captured by hand. Exact duplicates (scheme, date, amount, reference) are refused. Returns its id. */
  abstract capture(input: NewReceipt): Observable<string>;
  /** The column mapping remembered for the scheme's trust account, if any. */
  abstract statementMapping(schemeId: string): Observable<StatementMapping | undefined>;
  /** What importing this file would do: receipts, duplicates skipped, debits ignored, rows that can't be read. Changes nothing. */
  abstract previewStatement(schemeId: string, fileName: string, csv: string, mapping: StatementMapping): Observable<StatementPreview>;
  /** Imports the file's new credits as unallocated receipts and remembers the mapping. */
  abstract importStatement(schemeId: string, fileName: string, csv: string, mapping: StatementMapping): Observable<StatementImportResult>;
  abstract imports(schemeIds: string[]): Observable<StatementImportBatch[]>;
  /** Removes a mistaken receipt, only while unallocated, with a reason. */
  abstract remove(receiptId: string, reason: string, expectedVersion?: number): Observable<void>;
}

export abstract class TimelineDataSource {
  abstract forUnit(unitId: string): Observable<TimelineEvent[]>;
  abstract forPerson(personId: string): Observable<TimelineEvent[]>;
  abstract addNote(note: Omit<Note, 'id' | 'at' | 'author'>): Observable<void>;
}
