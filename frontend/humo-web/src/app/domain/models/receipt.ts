/** A credit on a scheme's trust bank account, imported from the bank statement. */
export interface Receipt {
  id: string;
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
