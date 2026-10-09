import { ReportCell, ReportColumn, ReportResult } from '../../domain';
import { formatDate, formatRand } from '../../ui/format/money';

/** A cell as the screen shows it. CSV keeps the raw value. */
export function formatCell(c: ReportColumn, v: ReportCell): string {
  if (v === null || v === undefined || v === '') return '—';
  switch (c.kind) {
    case 'money':
      return formatRand(Number(v));
    case 'percent':
      return `${Number(v).toFixed(1)}%`;
    case 'number':
      return Number(v).toLocaleString('en-ZA');
    case 'date':
      return formatDate(String(v));
    default:
      return String(v);
  }
}

/** The report as RFC 4180 CSV: raw values (no currency symbols), so spreadsheets can add them up. */
export function toCsv(r: ReportResult): string {
  const esc = (v: ReportCell | undefined) => (v === null || v === undefined ? '' : /[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [r.columns.map((c) => esc(c.label)).join(','), ...r.rows.map((row) => r.columns.map((c) => esc(row[c.key])).join(','))];
  if (r.totals) lines.push(r.columns.map((c) => esc(r.totals![c.key])).join(','));
  return lines.join('\r\n');
}

/** Saves the CSV through the browser's own download. */
export function downloadCsv(r: ReportResult): void {
  const blob = new Blob(['﻿' + toCsv(r)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${r.def.id}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
