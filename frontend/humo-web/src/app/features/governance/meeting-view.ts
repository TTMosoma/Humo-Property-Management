import { MEETING_STAGES, MEETING_STAGE_LABELS, MeetingStage, RESOLUTION_PROGRESS_LABELS, ResolutionProgress } from '../../domain';
import { StageDef } from '../../ui/stage-tracker/stage-tracker';
import { Tone } from '../../ui/status-pill/status-pill';

export const MEETING_TRACKER: StageDef[] = MEETING_STAGES.map((s) => ({ id: s.id, label: s.label }));

export const MEETING_STAGE_TONE: Record<MeetingStage, Tone> = {
  draft: 'neutral',
  'notice-sent': 'info',
  'pack-ready': 'info',
  held: 'accent',
  'minutes-draft': 'warning',
  'minutes-approved': 'success',
  cancelled: 'neutral',
};

export const stageLabel = (s: MeetingStage) => MEETING_STAGE_LABELS[s];

export const PROGRESS_TONE: Record<ResolutionProgress, Tone> = {
  'awaiting-decision': 'warning',
  'not-passed': 'neutral',
  withdrawn: 'neutral',
  'no-actions': 'success',
  'in-progress': 'info',
  completed: 'success',
};

export const progressLabel = (p: ResolutionProgress) => RESOLUTION_PROGRESS_LABELS[p];

/** "Thu 24 Oct, 18:00" */
export function when(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

/** Date + time fields (as the form gives them) → ISO. */
export function isoFrom(date: string, time: string): string {
  return new Date(`${date}T${time || '18:00'}:00`).toISOString();
}

/** ISO → the date and time field values. */
export function fieldsFrom(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
