import { parseCsv } from './bank-statement';
import { BillingStage } from './billing';

/**
 * Water meter readings (docs/22 §2). A reading is the meter's running total in
 * kilolitres (kl) on a date; consumption is this month's reading minus the last.
 * One flat rate per kl per scheme. No tariffs, rollovers or self-readings in v1.
 */
export interface MeterReading {
  unitId: string;
  schemeId: string;
  /** The billing month it's for, "2026-11". */
  period: string;
  /** Running total on the meter, kl. */
  reading: number;
  /** yyyy-mm-dd, when it was read. */
  readOn: string;
  capturedBy: string;
  capturedAt: string;
}

/** A consumption above this many times the unit's usual is flagged on the billing run. */
export const UNUSUAL_FACTOR = 3;

export interface WaterSetting {
  schemeId: string;
  /** Rand per kilolitre. */
  ratePerKl: number;
  version: number;
  updatedBy?: string;
  updatedAt?: string;
}

export interface MeterSheetRow {
  unitId: string;
  unitNumber: string;
  accountNo: string;
  /** The latest reading before this month. */
  previous?: { period: string; reading: number };
  /** This month's reading, if captured. */
  reading?: number;
  consumption?: number;
  /** Average consumption over the last three months, kl. */
  usual?: number;
  unusual: boolean;
}

/** One scheme's readings for one month, as the capture grid shows them. */
export interface MeterSheet {
  schemeId: string;
  schemeName: string;
  period: string;
  setting: WaterSetting;
  rows: MeterSheetRow[];
  captured: number;
  /** The billing run for this month, if one exists: readings can change only before it leaves Preparing. */
  runStage?: BillingStage;
}

export interface MeterEntry {
  unitNumber: string;
  reading: number;
}

/** "Unit,Reading" (any header names containing "unit" and "reading"); one row per unit. */
export function parseReadingsCsv(text: string): { entries: MeterEntry[]; problems: { row: number; problem: string }[] } {
  const rows = parseCsv(text);
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const unitAt = header.findIndex((h) => h.includes('unit'));
  const readingAt = header.findIndex((h) => h.includes('reading') || h === 'kl');
  const problems: { row: number; problem: string }[] = [];
  if (unitAt < 0 || readingAt < 0) return { entries: [], problems: [{ row: 1, problem: 'The header needs a “Unit” column and a “Reading” column.' }] };
  const entries: MeterEntry[] = [];
  rows.slice(1).forEach((cells, i) => {
    const unitNumber = (cells[unitAt] ?? '').trim().replace(/^unit\s*/i, '');
    const raw = (cells[readingAt] ?? '').trim().replace(/\s/g, '').replace(',', '.');
    const reading = Number(raw);
    if (!unitNumber) problems.push({ row: i + 2, problem: 'No unit number.' });
    else if (!raw || !Number.isFinite(reading) || reading < 0) problems.push({ row: i + 2, problem: `Unit ${unitNumber}: “${cells[readingAt] ?? ''}” isn’t a reading.` });
    else entries.push({ unitNumber, reading: Math.round(reading * 100) / 100 });
  });
  return { entries, problems };
}
