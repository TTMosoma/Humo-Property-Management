import { Feature } from './entitlement';
import { Permission } from './permission';

/**
 * Reports (review finding F7): ONE catalogue for portfolio and scheme
 * reports, financial ones included, with categories and the scheme scope.
 * Every report is a table the API works out from live records; the client
 * shows it, sorts it, prints it and exports it as CSV.
 */

export type ReportCategory = 'financial' | 'arrears' | 'maintenance' | 'governance' | 'portfolio';

export const REPORT_CATEGORIES: { id: ReportCategory; label: string; description: string }[] = [
  { id: 'financial', label: 'Financial', description: 'Levies, billing, receipts and supplier payments.' },
  { id: 'arrears', label: 'Arrears', description: 'What’s owed, how old it is, and where collection stands.' },
  { id: 'maintenance', label: 'Maintenance', description: 'Jobs by stage and how suppliers perform.' },
  { id: 'governance', label: 'Governance & compliance', description: 'Resolutions and compliance across schemes.' },
  { id: 'portfolio', label: 'Portfolio', description: 'Scheme health, units and occupancy.' },
];

export type ReportId =
  | 'levy-roll'
  | 'billing-summary'
  | 'receipts'
  | 'supplier-payments'
  | 'age-analysis'
  | 'debtors'
  | 'collections'
  | 'jobs-by-stage'
  | 'supplier-performance'
  | 'resolutions'
  | 'compliance-status'
  | 'scheme-health'
  | 'occupancy';

export interface ReportDef {
  id: ReportId;
  title: string;
  category: ReportCategory;
  description: string;
  /** Who may run it (on top of Reports.View). */
  permission: Permission;
  /** The plan feature it needs. */
  feature: Feature;
  /** Reports with a period choose the last N months. */
  period?: boolean;
}

export type ReportColumnKind = 'text' | 'money' | 'number' | 'percent' | 'date';

export interface ReportColumn {
  key: string;
  label: string;
  kind: ReportColumnKind;
  /** Summed in the totals row. */
  total?: boolean;
}

export type ReportCell = string | number | null;

export interface ReportResult {
  def: ReportDef;
  /** When the figures were worked out. */
  generatedAt: string;
  /** What it covers, in words: "24 schemes · last 3 months". */
  scope: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  /** Per-row link, when a row is a record. */
  links?: (string | null)[];
  totals?: Record<string, ReportCell>;
  /** How the figures were worked out, for anyone checking them. */
  notes: string[];
}

export interface ReportParams {
  schemeIds: string[];
  /** Months back from today, for reports with a period. */
  months?: number;
}
