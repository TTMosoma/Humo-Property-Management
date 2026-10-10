/** Deterministic pseudo-random numbers, so generated data is identical on every load. */
export function seeded(key: string): () => number {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.floor(r() * items.length)];
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function pad3(n: number | string): string {
  return String(n).padStart(3, '0');
}

/** ISO date for a day in a month offset from the current month (0 = this month, -1 = last month). */
export function dayInMonth(monthOffset: number, day: number, hour = 9): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + monthOffset, day, hour, 0, 0, 0);
  return d.toISOString();
}

export function daysAgo(n: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export { periodLabel, periodOf } from '../../domain/models/period';
