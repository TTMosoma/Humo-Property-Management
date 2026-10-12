/**
 * Bank statements imported as CSV (docs/22 §1). Every bank's export differs,
 * so the columns are mapped once per trust account and remembered. The
 * reading rules live here, shared by the screen's preview and the API, so
 * both agree on what a row means.
 */

export type StatementDateFormat = 'yyyy-mm-dd' | 'dd/mm/yyyy' | 'mm/dd/yyyy';

export const STATEMENT_DATE_FORMATS: { value: StatementDateFormat; label: string }[] = [
  { value: 'yyyy-mm-dd', label: '2026-10-07 (yyyy-mm-dd)' },
  { value: 'dd/mm/yyyy', label: '07/10/2026 (dd/mm/yyyy)' },
  { value: 'mm/dd/yyyy', label: '10/07/2026 (mm/dd/yyyy)' },
];

/** Which column holds what, by header name. Either `amount` (credits positive) or `credit` (+ optional `debit`). */
export interface StatementMapping {
  date: string;
  dateFormat: StatementDateFormat;
  amount?: string;
  credit?: string;
  debit?: string;
  reference: string;
  payer?: string;
}

/** One row as read: a credit becomes a receipt; debits and unreadable rows don't. */
export interface StatementLine {
  /** 1-based row number in the file, counting the header as row 1. */
  row: number;
  kind: 'credit' | 'debit' | 'invalid';
  date?: string;
  amount?: number;
  reference?: string;
  payer?: string;
  problem?: string;
}

/** A tiny RFC 4180 reader: commas or semicolons, quoted fields, "" escapes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** "R 1 234,50", "1,234.50", "(500.00)", "-500" → number, or null. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim().replace(/^R\s*/i, '').replace(/\s/g, '');
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  // A comma followed by exactly two digits at the end is a decimal comma.
  if (/,\d{2}$/.test(s) && !/\.\d{2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return negative ? -n : n;
}

/** The date as yyyy-mm-dd, or null if it doesn't read in the given format. */
export function parseStatementDate(raw: string, format: StatementDateFormat): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (format === 'yyyy-mm-dd' && iso) [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  else if (format === 'dd/mm/yyyy' && dmy) [y, m, d] = [+dmy[3], +dmy[2], +dmy[1]];
  else if (format === 'mm/dd/yyyy' && dmy) [y, m, d] = [+dmy[3], +dmy[1], +dmy[2]];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Reads every data row with the mapping. The first row must be the header. */
export function readStatement(rows: string[][], mapping: StatementMapping): StatementLine[] {
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name?: string) => (name ? header.indexOf(name.trim().toLowerCase()) : -1);
  const at = { date: col(mapping.date), amount: col(mapping.amount), credit: col(mapping.credit), debit: col(mapping.debit), reference: col(mapping.reference), payer: col(mapping.payer) };
  return rows.slice(1).map((cells, i): StatementLine => {
    const row = i + 2;
    const cell = (k: keyof typeof at) => (at[k] >= 0 ? (cells[at[k]] ?? '').trim() : '');
    const date = parseStatementDate(cell('date'), mapping.dateFormat);
    if (!date) return { row, kind: 'invalid', problem: `The date “${cell('date')}” doesn’t read as ${mapping.dateFormat}.` };
    let amount: number | null;
    if (at.amount >= 0) amount = parseAmount(cell('amount'));
    else {
      const credit = cell('credit') ? parseAmount(cell('credit')) : 0;
      const debit = cell('debit') ? parseAmount(cell('debit')) : 0;
      amount = credit === null || debit === null ? null : Math.round(((credit ?? 0) - Math.abs(debit ?? 0)) * 100) / 100;
    }
    if (amount === null) return { row, kind: 'invalid', date, problem: 'The amount isn’t a number.' };
    if (amount === 0) return { row, kind: 'invalid', date, problem: 'The amount is zero.' };
    const reference = cell('reference');
    const payer = cell('payer') || undefined;
    if (amount < 0) return { row, kind: 'debit', date, amount, reference, payer };
    if (!reference && !payer) return { row, kind: 'invalid', date, amount, problem: 'No reference or payer to match it by.' };
    return { row, kind: 'credit', date, amount, reference, payer };
  });
}

/** The mapping's columns must exist in the header, with an amount or a credit column. */
export function mappingProblems(header: string[], m: StatementMapping): Record<string, string> {
  const has = (c?: string) => !!c && header.map((h) => h.trim().toLowerCase()).includes(c.trim().toLowerCase());
  const e: Record<string, string> = {};
  if (!has(m.date)) e['date'] = 'Choose the date column.';
  if (!has(m.reference)) e['reference'] = 'Choose the reference or description column.';
  if (!has(m.amount) && !has(m.credit)) e['amount'] = 'Choose an amount column, or a credit column.';
  if (m.payer && !has(m.payer)) e['payer'] = 'That payer column isn’t in the file.';
  if (m.debit && !has(m.debit)) e['debit'] = 'That debit column isn’t in the file.';
  return e;
}

/** What an import will do, before it's confirmed. */
export interface StatementPreview {
  fileName: string;
  header: string[];
  /** Credits that become receipts. */
  receipts: StatementLine[];
  /** Credits already in the scheme's receipts (or earlier in this file). */
  duplicates: StatementLine[];
  debits: number;
  invalid: StatementLine[];
  total: number;
}

export interface StatementImportResult {
  batchId: string;
  imported: number;
  duplicates: number;
  debits: number;
  invalid: number;
  total: number;
}

/** A finished import, kept for the record. */
export interface StatementImportBatch {
  id: string;
  schemeId: string;
  bankAccount: string;
  fileName: string;
  at: string;
  by: string;
  imported: number;
  duplicates: number;
  debits: number;
  invalid: number;
  total: number;
}

/** Receipts captured by hand: one deposit as it appears on the bank statement. */
export interface NewReceipt {
  schemeId: string;
  date: string;
  amount: number;
  reference: string;
  payer?: string;
}
