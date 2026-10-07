import { JOB_STAGES, Job, JobStage, Priority } from '../../domain';
import { Tone } from '../../ui/status-pill/status-pill';

export const STAGE_LABEL: Record<JobStage, string> = {
  reported: 'New — needs triage',
  quoting: 'Getting quotes',
  approval: 'Awaiting approval',
  approved: 'Approved — issue work order',
  scheduled: 'Scheduled',
  'in-progress': 'In progress',
  completed: 'Awaiting verification',
  verified: 'Verified — awaiting invoice',
  invoiced: 'Invoice received',
  paid: 'Paid',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const STAGE_TONE: Record<JobStage, Tone> = {
  reported: 'info',
  quoting: 'neutral',
  approval: 'warning',
  approved: 'accent',
  scheduled: 'accent',
  'in-progress': 'accent',
  completed: 'info',
  verified: 'success',
  invoiced: 'warning',
  paid: 'success',
  closed: 'neutral',
  cancelled: 'neutral',
};

export const PRIORITY_TONE: Record<Priority, Tone> = { urgent: 'danger', high: 'warning', normal: 'neutral', low: 'neutral' };

/** The board groups the 11 stages into the columns an agent actually works in. */
export const BOARD_COLUMNS: { id: string; label: string; stages: JobStage[] }[] = [
  { id: 'new', label: 'New', stages: ['reported'] },
  { id: 'quotes', label: 'Quotes & approval', stages: ['quoting', 'approval'] },
  { id: 'work', label: 'Booked & in progress', stages: ['approved', 'scheduled', 'in-progress'] },
  { id: 'check', label: 'Check it’s fixed', stages: ['completed'] },
  { id: 'pay', label: 'Invoice & pay', stages: ['verified', 'invoiced', 'paid'] },
];

export const TRACKER_STAGES = JOB_STAGES.map((s) => ({ id: s.id, label: s.short }));

export function isOpenJob(j: Job): boolean {
  return !['closed', 'cancelled'].includes(j.stage);
}

/** Overdue: past the stage due date (e.g. supplier missed the booking). */
export function isOverdue(j: Job): boolean {
  return !!j.dueAt && new Date(j.dueAt).getTime() < Date.now() && ['quoting', 'scheduled', 'in-progress'].includes(j.stage);
}

export function daysOpen(j: Job): number {
  return Math.max(0, Math.floor((Date.now() - new Date(j.reportedAt).getTime()) / 86_400_000));
}

/** What a resident sees: plain words, no internal stages. */
export function residentStatus(j: Job): { label: string; tone: Tone } {
  switch (j.stage) {
    case 'reported':
      return { label: 'Received', tone: 'info' };
    case 'quoting':
    case 'approval':
    case 'approved':
      return { label: 'Being arranged', tone: 'neutral' };
    case 'scheduled':
      return { label: 'Booked', tone: 'accent' };
    case 'in-progress':
      return { label: 'Being fixed', tone: 'accent' };
    case 'completed':
      return { label: 'Done — was it fixed?', tone: 'warning' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'neutral' };
    default:
      return { label: 'Fixed', tone: 'success' };
  }
}

