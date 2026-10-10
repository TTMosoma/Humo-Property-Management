import { Pipe, PipeTransform } from '@angular/core';

const NBSP = ' ';

/**
 * South African Rand, formatted the way agents and owners read statements:
 * "R 12 345.67" (space thousands separator, point decimal), "−R 1 200.00" for negatives.
 * `compact` gives "R 2.4m" / "R 186k" for summaries.
 */
export function formatRand(value: number | null | undefined, opts: { compact?: boolean; cents?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);

  if (opts.compact) {
    if (abs >= 1_000_000) return `${sign}R${NBSP}${trim(abs / 1_000_000)}m`;
    if (abs >= 10_000) return `${sign}R${NBSP}${Math.round(abs / 1_000)}k`;
  }

  const cents = opts.cents ?? true;
  const fixed = abs.toFixed(cents ? 2 : 0);
  const [whole, dec] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${sign}R${NBSP}${grouped}${dec ? '.' + dec : ''}`;
}

function trim(n: number): string {
  return n.toFixed(n >= 10 ? 1 : 2).replace(/\.?0+$/, '');
}

@Pipe({ name: 'rand' })
export class RandPipe implements PipeTransform {
  transform(value: number | null | undefined, mode: 'full' | 'compact' | 'whole' = 'full'): string {
    return formatRand(value, { compact: mode === 'compact', cents: mode !== 'whole' });
  }
}

const DATE = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_SHORT = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short' });

/** "6 Oct 2026", or "6 Oct" when `short`. */
export function formatDate(iso: string | undefined, short = false): string {
  if (!iso) return '—';
  return (short ? DATE_SHORT : DATE).format(new Date(iso));
}

/** "Today", "Tomorrow", "In 5 days", "3 days overdue", "Yesterday". */
export function dueLabel(iso: string, now = new Date()): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const d = new Date(iso);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((dayStart - start) / 86_400_000);
  if (diff === 0) return d.getTime() < now.getTime() ? 'Due earlier today' : 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff === -1) return '1 day overdue';
  if (diff < 0) return `${-diff} days overdue`;
  if (diff < 7) return `Due in ${diff} days`;
  return `Due ${formatDate(iso, true)}`;
}
