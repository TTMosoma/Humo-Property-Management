/**
 * Calendar dates in Humo are South African dates (docs/08 §7, audit F-26).
 * `new Date().toISOString().slice(0, 10)` is the UTC date: between midnight
 * and 02:00 in South Africa it is still yesterday. Use these instead.
 */
export const HUMO_TIME_ZONE = 'Africa/Johannesburg';

const FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: HUMO_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** The South African calendar date (yyyy-mm-dd) of an instant. */
export function saDate(at: Date = new Date()): string {
  return FORMAT.format(at);
}

/** Today in South Africa, yyyy-mm-dd. */
export function todaySA(): string {
  return saDate();
}
