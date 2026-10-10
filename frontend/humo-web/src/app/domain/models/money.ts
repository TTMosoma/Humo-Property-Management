/**
 * Money and time on the wire.
 *
 * Money: rands as JSON numbers with at most two decimals (R 1 234.50 → 1234.5).
 * The API stores DECIMAL(18,2) and uses `decimal` in .NET; it never sends more
 * than two decimals, and it computes every total that matters (statements,
 * batches, balances). The browser only adds amounts up for display, through
 * `sumRands`, which works in whole cents so 0.1 + 0.2 doesn't drift.
 *
 * Time: ISO 8601 strings. Instants carry an offset (`2026-10-08T09:30:00+02:00`,
 * or `Z`); calendar dates are plain dates (`2026-10-07`). Screens show local time.
 */
export type Rands = number;
export type IsoDateTime = string;
export type IsoDate = string;

/** Rounds to whole cents. */
export function roundRands(amount: number): Rands {
  return Math.round(amount * 100) / 100;
}

/** Adds amounts in cents, so display totals match the server's to the cent. */
export function sumRands(amounts: readonly number[]): Rands {
  return amounts.reduce((cents, a) => cents + Math.round(a * 100), 0) / 100;
}
