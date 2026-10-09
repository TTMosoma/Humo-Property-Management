import { Scheme } from './scheme';

/**
 * A scheme's annual budget (Finance › Budgets): income and expenses by
 * category for one financial year, with actuals from Humo PM's own records
 * (levies billed, supplier invoices paid). The owners approve it at the AGM:
 * proposing it adds an agenda item to the AGM, and the resolution passed on
 * that item approves the budget.
 */

export type BudgetStatus = 'draft' | 'proposed' | 'approved';

export const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  draft: 'Draft',
  proposed: 'On the AGM agenda',
  approved: 'Approved',
};

export interface BudgetLine {
  category: string;
  kind: 'income' | 'expense';
  /** The year's amount. */
  annual: number;
}

export interface Budget {
  id: string;
  version: number;
  schemeId: string;
  /** "2025/26" */
  year: string;
  /** yyyy-mm-dd, the financial year's first and last days. */
  from: string;
  to: string;
  status: BudgetStatus;
  lines: BudgetLine[];
  createdBy: string;
  updatedAt: string;
  /** While proposed: the AGM and its agenda item. */
  agm?: { meetingId: string; meetingRef: string; agendaItemId: string };
  approved?: { at: string; resolutionRef: string; meetingId?: string };
  /**
   * Spending before the scheme moved to Humo PM, imported from the previous
   * system when it was onboarded: by category, up to `to` (yyyy-mm-dd).
   * Humo PM's own invoices count from the day after.
   */
  broughtForward?: { to: string; amounts: Record<string, number> };
}

export interface BudgetLineView {
  line: BudgetLine;
  /** Budget to date: the annual amount × the share of the year gone. */
  toDate: number;
  /** From Humo PM's records; null when Humo PM doesn't track this category yet. */
  actual: number | null;
  /** Approved but not yet paid (expenses). */
  committed: number;
  /** Actual − budget to date (expenses: positive is over). */
  variance: number | null;
}

export interface BudgetView {
  budget: Budget;
  scheme: Scheme;
  /** Share of the financial year gone, 0–1. */
  elapsed: number;
  lines: BudgetLineView[];
  totals: { income: number; expense: number; surplus: number; incomeActual: number; expenseActual: number };
  /** Lines over budget to date by 10% or more. */
  overspent: string[];
}

export type BudgetAction =
  | { type: 'set-line'; category: string; kind: 'income' | 'expense'; annual: number }
  | { type: 'remove-line'; category: string }
  | { type: 'propose'; meetingId: string };

export interface NewBudget {
  schemeId: string;
  /** Start from the current year's budget, increased by this %. */
  increasePct: number;
}
