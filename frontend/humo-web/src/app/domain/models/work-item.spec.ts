import { workButton } from './work-item';

describe('workButton', () => {
  it('sends a task for real work to the record, so it can’t be ticked off', () => {
    expect(workButton({ type: 'debtor-follow-up' })).toBe('Open debtor case');
    expect(workButton({ type: 'maintenance-triage' })).toBe('Open the job');
    expect(workButton({ type: 'rule-breach' })).toBe('Open the breach');
  });

  it('leaves a plain to-do to be marked done', () => {
    expect(workButton({ type: 'follow-up' })).toBeUndefined();
    expect(workButton({ type: 'meeting-action' })).toBeUndefined();
  });
});
