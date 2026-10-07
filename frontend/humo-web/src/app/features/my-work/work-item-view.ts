import { Tone } from '../../ui/status-pill/status-pill';
import { Urgency, WORK_TYPE_AREA, WORK_TYPE_LABELS, WorkItem, urgencyOf } from '../../domain';
import { dueLabel } from '../../ui/format/money';

/** Presentation helpers shared by Tasks, Approvals and previews. */
export const URGENCY_TONE: Record<Urgency, Tone> = {
  overdue: 'danger',
  today: 'warning',
  week: 'info',
  later: 'neutral',
};

export const URGENCY_LABEL: Record<Urgency, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  later: 'Later',
};

export const URGENCY_ORDER: Record<Urgency, number> = { overdue: 0, today: 1, week: 2, later: 3 };

export function workItemView(w: WorkItem) {
  const urgency = urgencyOf(w);
  return {
    urgency,
    tone: w.status === 'open' ? URGENCY_TONE[urgency] : ('neutral' as Tone),
    due: w.status === 'open' ? dueLabel(w.dueAt) : statusLabel(w),
    typeLabel: WORK_TYPE_LABELS[w.type],
    area: WORK_TYPE_AREA[w.type],
  };
}

export function statusLabel(w: WorkItem): string {
  switch (w.status) {
    case 'done':
      return 'Done';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    default:
      return 'Open';
  }
}

export const AREA_ICON: Record<string, string> = {
  Finance: 'wallet-outline',
  Maintenance: 'construct-outline',
  Governance: 'library-outline',
  Compliance: 'shield-checkmark-outline',
  Communication: 'chatbubbles-outline',
};
