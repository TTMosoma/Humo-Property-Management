import { byDay } from './message-days';

describe('byDay', () => {
  const now = new Date('2026-11-17T12:00:00+02:00');
  const m = (id: string, at: string) => ({ id, at, from: 'them' as const, by: 'Sipho', body: id });

  it('groups a conversation by South African day, oldest first, in plain words', () => {
    const days = byDay(
      [m('today', '2026-11-17T08:30:00+02:00'), m('older', '2026-11-03T09:00:00+02:00'), m('late', '2026-11-16T23:30:00+02:00'), m('early', '2026-11-16T00:15:00+02:00')],
      now,
    );
    expect(days.map((d) => [d.label, d.messages.map((x) => x.id)])).toEqual([
      ['Tuesday, 3 November', ['older']],
      ['Yesterday', ['early', 'late']],
      ['Today', ['today']],
    ]);
  });

  it('gives the year for a day in another year', () => {
    expect(byDay([m('x', '2025-12-30T10:00:00+02:00')], now)[0].label).toBe('30 December 2025');
  });
});
