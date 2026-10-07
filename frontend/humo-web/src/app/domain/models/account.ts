/**
 * Levy account (decision D2): belongs to the unit; the current owner is the holder.
 * When a unit is sold the history stays with the unit's account.
 */
export type AccountStatus = 'up-to-date' | 'in-credit' | 'arrears' | 'arrangement' | 'handed-over';

export interface Ageing {
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d120: number;
}

export interface Account {
  id: string;
  /** Same as Unit.accountNo, e.g. "KC-042". */
  accountNo: string;
  unitId: string;
  schemeId: string;
  holderPersonId: string;
  /** Positive = owing; negative = in credit. */
  balance: number;
  ageing: Ageing;
  status: AccountStatus;
  debitOrder: boolean;
  /** Statement delivery. */
  statementBy: 'email' | 'post' | 'portal';
}

export type TransactionType = 'levy' | 'special-levy' | 'utility' | 'interest' | 'payment' | 'adjustment';

export interface Transaction {
  id: string;
  accountId: string;
  /** ISO date. */
  date: string;
  type: TransactionType;
  description: string;
  reference?: string;
  /** Charges increase the balance (positive); payments and credits decrease it (negative). */
  amount: number;
  /** Balance after this transaction (computed by the ledger). */
  balance: number;
  /** For payments: the bank receipt it came from. */
  receiptId?: string;
}

export interface Statement {
  accountId: string;
  /** "2026-10". */
  period: string;
  periodLabel: string;
  issuedOn: string;
  dueOn: string;
  opening: number;
  charges: number;
  payments: number;
  adjustments: number;
  interest: number;
  closing: number;
  lines: Transaction[];
}

/** Accounting status → label/tone, shared by all account views. */
export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  'up-to-date': 'Up to date',
  'in-credit': 'In credit',
  arrears: 'In arrears',
  arrangement: 'Payment arrangement',
  'handed-over': 'Handed over',
};
