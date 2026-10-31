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

/** reversal: a payment taken off the account again, with the reason; the payment line stays (docs/22 §1). */
export type TransactionType = 'levy' | 'special-levy' | 'utility' | 'interest' | 'payment' | 'adjustment' | 'reversal';

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

/** The scheme's trust account that owners pay into: scheme data, never part of a template. */
export interface TrustAccount {
  bank: string;
  accountName: string;
  accountNumber: string;
  branchCode: string;
}

/** How an account's holder can pay (D25): EFT to the scheme's trust account, and by card when the scheme has a Payfast merchant. */
export interface PaymentOptions {
  /** Null until the agency adds the scheme's trust account. */
  trustAccount: TrustAccount | null;
  /** The EFT reference: the account number. */
  reference: string;
  due: number;
  /** The latest charges' due date, or null when nothing is owed. */
  dueBy: string | null;
  /** Card payment is on for the scheme and this person holds the account. */
  card: boolean;
  /** Payfast's sandbox: a test card is charged, not a real one. */
  sandbox: boolean;
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
