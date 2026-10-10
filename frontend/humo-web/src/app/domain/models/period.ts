/** Accounting periods are "YYYY-MM" strings (one statement per period). */
export function periodOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MONTH = new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' });
const MONTH_ONLY = new Intl.DateTimeFormat('en-ZA', { month: 'long' });

/** "October 2026", or "October" without the year. */
export function periodLabel(period: string, withYear = true): string {
  const [y, m] = period.split('-').map(Number);
  return (withYear ? MONTH : MONTH_ONLY).format(new Date(y, m - 1, 1));
}
