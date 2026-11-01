/** A credit on a scheme's trust bank account, imported from the bank statement. */
export interface Receipt {
  id: string;
  /** Concurrency token: send it back with commands that change this record. The API answers 409 if someone changed it first. */
  version: number;
  schemeId: string;
  bankAccount: string;
  /** ISO date. */
  date: string;
  amount: number;
  /** Reference exactly as it appears on the bank statement. */
  reference: string;
  /** Depositor name from the bank, if any. */
  payer: string;
  status: 'unallocated' | 'allocated' | 'suspense';
  allocations: { accountId: string; amount: number }[];
  allocatedBy?: string;
  /** True when a remembered payer rule matched it on import. */
  autoMatched?: boolean;
  /** How it got here (docs/22 §1). Seeded receipts stand for the bank feed. */
  /** payfast: an owner's card payment, confirmed by Payfast (D25). */
  source?: 'bank-feed' | 'statement-import' | 'captured' | 'payfast';
  /** The statement import it came from. */
  importBatchId?: string;
  /** Who captured or imported it. */
  capturedBy?: string;
}

/** A suggested account for an unallocated receipt, with the reasons — so the agent can trust it. */
export interface ReceiptMatch {
  accountId: string;
  confidence: number;
  reasons: string[];
}

export interface PayerRule {
  id: string;
  schemeId: string;
  /** Matched case-insensitively against reference or payer. */
  pattern: string;
  accountId: string;
  createdBy: string;
}

/** Why an allocated payment is reversed (docs/22 §1). It's on the account's reversal line and in the audit log. */
export type ReversalReason = 'wrong-account' | 'wrong-amount' | 'returned' | 'other';

export const REVERSAL_REASON_LABELS: Record<ReversalReason, string> = {
  'wrong-account': 'Allocated to the wrong account',
  'wrong-amount': 'Allocated with the wrong amount',
  returned: 'Returned unpaid by the bank',
  other: 'Something else (say what)',
};

export interface ReverseInput {
  reason: ReversalReason;
  note?: string;
  /** Wrong account: the account it pays instead, allocated in the same step. */
  moveToAccountId?: string;
}
