import { COMPLIANCE_STATUS_LABELS, ComplianceItem, ComplianceStatus } from '../../domain';
import { formatDate } from '../../ui/format/money';
import { Tone } from '../../ui/status-pill/status-pill';

export const STATUS_TONE: Record<ComplianceStatus, Tone> = {
  complete: 'success',
  upcoming: 'info',
  'due-soon': 'warning',
  overdue: 'danger',
  'not-applicable': 'neutral',
};

export const statusLabel = (s: ComplianceStatus) => COMPLIANCE_STATUS_LABELS[s];

/** Worst first. */
export const STATUS_RANK: Record<ComplianceStatus, number> = { overdue: 0, 'due-soon': 1, upcoming: 2, complete: 3, 'not-applicable': 4 };

/** What a matrix cell or list row says under the status: the date that matters. */
export function whenLabel(i: ComplianceItem): string {
  if (i.status === 'not-applicable') return '';
  if (!i.dueAt) return i.status === 'overdue' ? 'Missing' : '';
  if (i.status === 'complete') return i.type === 'building-insurance' || i.type === 'fire-equipment' || i.type === 'lift-inspection' ? `to ${formatDate(i.dueAt, true)}` : (i.period ?? '');
  const days = Math.round((new Date(i.dueAt).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} late`;
  if (days === 0) return 'today';
  return days <= 45 ? `in ${days} day${days === 1 ? '' : 's'}` : formatDate(i.dueAt, true);
}
