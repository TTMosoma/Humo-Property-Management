import { Job, JobEvent } from './job';

/**
 * A resident's own request as they may see it, the same as the API's `/me/jobs` (`Maintenance/ResidentRequests.cs`):
 * the request, its photos, the booking and a plain history. Never the quotes, prices, approvals, invoices, staff notes
 * or who in the agency handles it. The prototype uses this so it shows residents what the live system does.
 */
export function forResident(job: Job): Job {
  return {
    id: job.id,
    version: job.version,
    ref: job.ref,
    schemeId: job.schemeId,
    unitId: job.unitId,
    location: job.location,
    title: job.title,
    description: job.description,
    category: job.category,
    priority: job.priority,
    stage: job.stage,
    reportedBy: job.reportedBy,
    reportedAt: job.reportedAt,
    assigneeId: null,
    photos: job.photos,
    quotes: [],
    supplierId: job.supplierId,
    workOrder: job.workOrder ? { issuedAt: job.workOrder.issuedAt, scheduledFor: job.workOrder.scheduledFor, accessNotes: job.workOrder.accessNotes } : undefined,
    completion: job.completion,
    verification: job.verification,
    budgetCategory: '',
    events: residentHistory(job),
  } as Job;
}

/** The reason staff gave when they cancelled it, which the resident is shown. */
export function cancelReason(job: Job): string | undefined {
  return job.events.find((e) => e.kind === 'stage' && e.text.startsWith('Cancelled: '))?.text.slice('Cancelled: '.length);
}

/** A plain history of the request, newest first (never the staff's own lines). */
export function residentHistory(job: Job): JobEvent[] {
  const lines: JobEvent[] = [];
  const add = (at: string | undefined, text: string) => {
    if (at) lines.push({ id: `${job.ref}-h${lines.length + 1}`, at, kind: 'stage', text, by: '' });
  };
  const first = (events: JobEvent[]) => [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  const last = (events: JobEvent[]) => [...events].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];

  add(job.reportedAt, 'Reported');
  add(first(job.events.filter((e) => e.kind === 'quote' || e.kind === 'approval'))?.at, 'The managing agent is arranging a supplier');
  if (job.workOrder) add(job.workOrder.issuedAt, `Booked for ${day(job.workOrder.scheduledFor)}`);
  add(first(job.events.filter((e) => e.kind === 'stage' && e.text.startsWith('Supplier on site')))?.at, 'The supplier is working on it');
  if (job.completion) add(job.completion.completedAt, 'The supplier says it’s done');
  if (job.verification) add(job.verification.at, job.verification.outcome === 'fixed' ? 'Confirmed fixed' : 'Reported as not fixed: the supplier is coming back');
  if (job.stage === 'cancelled') add(last(job.events.filter((e) => e.kind === 'stage' && e.text.startsWith('Cancelled: ')))?.at, `Cancelled: ${cancelReason(job) ?? ''}`);
  if (job.stage === 'closed') add(last(job.events.filter((e) => e.kind === 'stage' && e.text === 'Job closed'))?.at, 'Closed');
  // By time; at the same moment, the later step first.
  return lines.map((l, i) => ({ l, i })).sort((a, b) => Date.parse(b.l.at) - Date.parse(a.l.at) || b.i - a.i).map((x) => x.l);
}

/** "Friday 20 November", in South African time. */
function day(iso: string): string {
  // Written as the API writes it, without the browser's comma ("Friday 20 November").
  const parts = new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg' }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}
