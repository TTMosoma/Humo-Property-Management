import { Account, Statement, Transaction, TrustAccount } from './account';
import { DocumentTemplateRef } from './document';
import { Person, Relationship } from './person';
import { Receipt, ReceiptMatch } from './receipt';
import { Scheme } from './scheme';
import { Unit } from './unit';

/**
 * Read models: the shapes screens need, already joined. They map to query
 * endpoints on the future .NET API (CQRS-style reads), so the UI never has to
 * stitch Unit + Person + Account together itself.
 */
export interface UnitSummary {
  unit: Unit;
  scheme: Scheme;
  owners: Person[];
  tenant?: Person;
  account: Account;
}

export interface RelationshipView {
  relationship: Relationship;
  scheme: Scheme;
  unit?: Unit;
  account?: Account;
}

export interface PersonSummary {
  person: Person;
  relationships: RelationshipView[];
  /** Sum of balances on accounts this person holds. */
  balance: number;
}

export interface AccountDetail {
  account: Account;
  unit: Unit;
  scheme: Scheme;
  holder: Person;
  /** Newest first, with running balances. */
  transactions: Transaction[];
  /** Periods with a statement, newest first ("2026-10"). */
  statementPeriods: string[];
  lastPayment?: Transaction;
}

export interface StatementView {
  statement: Statement;
  account: Account;
  unit: Unit;
  scheme: Scheme;
  holder: Person;
  /** Where owners pay: the scheme's trust account. */
  payTo: TrustAccount;
  /** The template and version the statement was issued with. It keeps rendering that way after the template changes. */
  issuedWith: DocumentTemplateRef;
}

export interface ReceiptView {
  receipt: Receipt;
  scheme: Scheme;
  /** Allocated accounts, for display. */
  allocatedTo: { account: Account; unit: Unit; amount: number }[];
}

export interface MatchView extends ReceiptMatch {
  summary: UnitSummary;
}
