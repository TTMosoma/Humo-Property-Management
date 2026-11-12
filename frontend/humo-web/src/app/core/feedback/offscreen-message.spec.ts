import { offscreenMessage } from './offscreen-message';

describe('offscreenMessage', () => {
  it('says the problem, tidied', () => {
    expect(offscreenMessage(['  Enter  the amount.\n'])).toBe('Enter the amount.');
  });

  it('counts the others', () => {
    expect(offscreenMessage(['Enter the amount.', 'Choose a date.'])).toBe('Enter the amount. (and 1 more problem on this page)');
    expect(offscreenMessage(['A', 'B', 'C'])).toBe('A (and 2 more problems on this page)');
  });

  it('shortens a long one and ignores empty ones', () => {
    const long = 'x'.repeat(300);
    expect(offscreenMessage([long]).length).toBe(158);
    expect(offscreenMessage(['', '  '])).toBe('');
  });
});
