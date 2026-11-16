import { Job } from './job';
import { cancelReason, forResident, residentHistory } from './resident-request';

const base = {
  id: 'j1',
  version: 3,
  ref: 'MR-1019',
  schemeId: 's1',
  unitId: 'u1',
  location: 'Unit 12 — Kitchen',
  title: 'Kitchen is leaking',
  description: 'Dripping under the sink',
  category: 'Plumbing',
  priority: 'normal',
  reportedBy: { name: 'Sipho Khumalo', role: 'owner', personId: 'p1' },
  reportedAt: '2026-11-15T17:44:54+02:00',
  assigneeId: 'staff-1',
  photos: [],
  budgetCategory: 'Maintenance — plumbing',
} as const;

describe('A resident’s view of their request (forResident)', () => {
  it('leaves out the quotes, approval, invoice, staff notes and who handles it', () => {
    const job = {
      ...base,
      stage: 'approved',
      quotes: [{ id: 'q1', supplierId: 'sup1', status: 'received', amount: 7500 }],
      approval: { status: 'approved', decidedBy: 'Thandeka' },
      invoiceId: 'inv-1',
      events: [
        { id: 'e3', at: '2026-11-16T09:00:00+02:00', kind: 'approval', text: 'Approved within delegation: Plumbing Kings, R7 500', by: 'Thandeka' },
        { id: 'e2', at: '2026-11-16T08:00:00+02:00', kind: 'comment', text: 'Owner is difficult, call first', by: 'Johan' },
        { id: 'e1', at: '2026-11-15T18:00:00+02:00', kind: 'quote', text: 'Quote requested from Plumbing Kings', by: 'Johan' },
      ],
    } as unknown as Job;

    const seen = forResident(job);
    const text = JSON.stringify(seen);

    expect(seen.quotes).toEqual([]);
    expect(seen.approval).toBeUndefined();
    expect(seen.invoiceId).toBeUndefined();
    expect(seen.assigneeId).toBeNull();
    expect(text).not.toContain('difficult');
    expect(text).not.toContain('7 500');
    expect(seen.events.map((e) => e.text)).toEqual(['The managing agent is arranging a supplier', 'Reported']);
  });

  it('a cancelled request says why, newest first', () => {
    const job = {
      ...base,
      stage: 'cancelled',
      quotes: [],
      events: [{ id: 'e1', at: '2026-11-15T19:53:06+02:00', kind: 'stage', text: 'Cancelled: Already fixed', by: 'Johan' }],
    } as unknown as Job;

    expect(cancelReason(job)).toBe('Already fixed');
    expect(residentHistory(job).map((e) => e.text)).toEqual(['Cancelled: Already fixed', 'Reported']);
    // The reason survives the resident's view, so the page can show it.
    expect(cancelReason(forResident(job))).toBe('Already fixed');
  });

  it('a booking and its finish read in plain words', () => {
    const job = {
      ...base,
      stage: 'completed',
      quotes: [],
      workOrder: { issuedAt: '2026-11-16T10:00:00+02:00', scheduledFor: '2026-11-20T08:00:00+02:00', accessNotes: 'Caretaker has keys' },
      completion: { completedAt: '2026-11-20T12:00:00+02:00', notes: 'Valve replaced' },
      events: [],
    } as unknown as Job;

    expect(residentHistory(job).map((e) => e.text)).toEqual(['The supplier says it’s done', 'Booked for Friday 20 November', 'Reported']);
  });
});
