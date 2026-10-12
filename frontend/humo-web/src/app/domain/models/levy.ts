/**
 * How a scheme's levies are set (D13, docs/22 §3).
 * - manual (default): each unit's monthly levy is entered on the unit.
 * - budget: levies are derived from the approved budget's annual "Levies"
 *   income × each unit's participation quota (normalised to 100%) ÷ 12, to
 *   the cent. A derived roll is proposed, then applied by a person; it takes
 *   effect from the next billing run.
 */
export type LevyMethod = 'manual' | 'budget';

export const LEVY_METHOD_LABELS: Record<LevyMethod, string> = {
  manual: 'Entered per unit',
  budget: 'Derived from the approved budget',
};

export interface LevySetting {
  schemeId: string;
  method: LevyMethod;
  version: number;
  updatedBy?: string;
  updatedAt?: string;
  /** The last derived roll applied. */
  applied?: { budgetId: string; year: string; at: string; by: string; fromPeriod: string; units: number };
}

export interface LevyRollRow {
  unitId: string;
  unitNumber: string;
  accountNo: string;
  quota: number;
  /** The quota as a share of the scheme's total, 0–1. */
  share: number;
  current: number;
  proposed: number;
  change: number;
}

/** The roll a budget would give, before anyone applies it. */
export interface LevyRollProposal {
  schemeId: string;
  budgetId: string;
  budgetYear: string;
  /** The budget's annual Levies income. */
  annualLevies: number;
  rows: LevyRollRow[];
  currentRoll: number;
  proposedRoll: number;
  /** Annual levies ÷ 12. */
  budgetMonthly: number;
  /** budgetMonthly − proposedRoll, from rounding each unit to the cent. */
  roundingDifference: number;
  /** The month the new levies would apply from: the next billing run. */
  fromPeriod: string;
  /** Why it can't be applied right now, if it can't. */
  blocked?: string;
}

/** D13's formula: annual levies × the unit's normalised quota ÷ 12, to the cent. */
export function derivedLevy(annualLevies: number, quota: number, quotaTotal: number): number {
  if (quotaTotal <= 0) return 0;
  return Math.round(((annualLevies * (quota / quotaTotal)) / 12) * 100) / 100;
}
