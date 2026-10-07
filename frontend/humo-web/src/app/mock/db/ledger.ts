import { Account, Statement, Transaction, Unit } from '../../domain';
import { dayInMonth, periodLabel, periodOf, round2, seeded } from './random';
import { SCHEME_CHARGES, monthlyCharges, specialLevyAmount } from './seed-portfolio';

export type RawTransaction = Omit<Transaction, 'balance'>;

export interface Ledger {
  opening: number;
  /** Oldest first. */
  transactions: RawTransaction[];
}

/** Interest rate on arrears as configured in Settings › Billing (prototype value). */
export const ARREARS_INTEREST_RATE = 0.02;

const UTILITY_OVERRIDE: Record<string, number> = { 'KC-042': 412.5 };
const MONTHS = 6;

/**
 * Generates six months of history that closes exactly on the account's seeded
 * balance: charges on the 1st, payments in the first week, missed payments and
 * interest for accounts in arrears. The opening balance is solved for, not invented.
 */
export function generateLedger(account: Account, unit: Unit, payer: string): Ledger {
  const r = seeded('ledger-' + account.id);
  const cfg = SCHEME_CHARGES[unit.schemeId] ?? {};
  const monthly = monthlyCharges(unit);
  const missed = account.balance > 0 ? Math.min(MONTHS, Math.max(1, Math.floor(account.balance / monthly))) : 0;
  const today = new Date().getDate();
  const tx: RawTransaction[] = [];
  let seq = 0;
  const add = (t: Omit<RawTransaction, 'id' | 'accountId'>) => tx.push({ ...t, id: `${account.id}-t${++seq}`, accountId: account.id });

  for (let i = 0; i < MONTHS; i++) {
    const offset = i - (MONTHS - 1);
    const period = periodOf(dayInMonth(offset, 1));
    const month = periodLabel(period, false);
    let charged = 0;

    add({ date: dayInMonth(offset, 1, 6), type: 'levy', description: `Levy — ${month}`, amount: unit.monthlyLevy });
    charged += unit.monthlyLevy;

    if (cfg.specialLevy && offset >= cfg.specialLevy.startMonthOffset) {
      const n = offset - cfg.specialLevy.startMonthOffset + 1;
      const amount = specialLevyAmount(unit, cfg);
      add({ date: dayInMonth(offset, 1, 6), type: 'special-levy', description: `${cfg.specialLevy.label} (${n} of ${cfg.specialLevy.instalments})`, amount });
      charged += amount;
    }

    if (cfg.waterRecovery) {
      const amount = offset === 0 && UTILITY_OVERRIDE[account.accountNo] !== undefined
        ? UTILITY_OVERRIDE[account.accountNo]
        : Math.round((280 + r() * 280) * 2) / 2;
      add({ date: dayInMonth(offset, 1, 6), type: 'utility', description: `Water recovery — ${month} (metered)`, amount });
      charged += amount;
    }

    // Months already in arrears attract interest on the overdue amount.
    const overdueMonths = i - (MONTHS - missed);
    if (overdueMonths > 0) {
      const amount = round2(monthly * overdueMonths * ARREARS_INTEREST_RATE);
      add({ date: dayInMonth(offset, 1, 6), type: 'interest', description: `Interest on arrears (${ARREARS_INTEREST_RATE * 100}% per month)`, amount });
    }

    const paysThisMonth = i < MONTHS - missed;
    if (paysThisMonth) {
      const debit = account.debitOrder;
      const day = debit ? 1 : 1 + Math.floor(r() * 6);
      add({
        date: dayInMonth(offset, offset === 0 ? Math.min(day, today) : day, debit ? 7 : 11),
        type: 'payment',
        description: debit ? 'Debit order — thank you' : 'Payment received — thank you',
        reference: debit ? `DO ${account.accountNo}` : r() < 0.7 ? account.accountNo : payer.toUpperCase().slice(0, 18),
        amount: -round2(charged),
      });
    }
  }

  const net = tx.reduce((s, t) => s + t.amount, 0);
  return { opening: round2(account.balance - net), transactions: tx };
}

/** Adds running balances. Input oldest first; output newest first (how people read a ledger). */
export function withBalances(opening: number, raw: RawTransaction[]): Transaction[] {
  let bal = opening;
  const sorted = [...raw].sort((a, b) => a.date.localeCompare(b.date));
  const out = sorted.map((t) => {
    bal = round2(bal + t.amount);
    return { ...t, balance: bal };
  });
  return out.reverse();
}

export function buildStatement(accountId: string, opening: number, raw: RawTransaction[], period: string): Statement | undefined {
  const sorted = [...raw].sort((a, b) => a.date.localeCompare(b.date));
  const before = sorted.filter((t) => periodOf(t.date) < period).reduce((s, t) => s + t.amount, 0);
  const lines = withBalances(round2(opening + before), sorted.filter((t) => periodOf(t.date) === period)).reverse();
  if (!lines.length) return undefined;
  const sum = (types: string[]) => round2(lines.filter((l) => types.includes(l.type)).reduce((s, l) => s + l.amount, 0));
  const [y, m] = period.split('-').map(Number);
  const open = round2(opening + before);
  const charges = sum(['levy', 'special-levy', 'utility']);
  const payments = sum(['payment']);
  const adjustments = sum(['adjustment']);
  const interest = sum(['interest']);
  return {
    accountId,
    period,
    periodLabel: periodLabel(period),
    issuedOn: new Date(y, m - 1, 1).toISOString(),
    dueOn: new Date(y, m - 1, 7).toISOString(),
    opening: open,
    charges,
    payments,
    adjustments,
    interest,
    closing: round2(open + charges + payments + adjustments + interest),
    lines,
  };
}
