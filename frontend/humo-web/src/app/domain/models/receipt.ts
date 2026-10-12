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
  source?: 'bank-feed' | 'statement-import' | 'captured';
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
