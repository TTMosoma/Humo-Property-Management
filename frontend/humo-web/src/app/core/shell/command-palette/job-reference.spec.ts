import { jobReference, matchesJob } from './job-reference';

describe('Finding a job from the search bar', () => {
  it('reads a reference however it’s typed', () => {
    for (const typed of ['MR-1022', 'mr1022', 'MR 1022', ' 1022 ', 'mr-1022']) expect(jobReference(typed)).toBe('1022');
    for (const words of ['kitchen sink', 'KC 42', 'MR', '12']) expect(jobReference(words)).toBeNull();
  });

  it('matches a reference without its dashes, or every word', () => {
    const job = { ref: 'MR-1022', title: 'Kitchen sink leaking under the cabinet', location: 'Unit 12 — Kitchen' };
    expect(matchesJob(job, 'mr1022')).toBe(true);
    expect(matchesJob(job, 'sink cabinet')).toBe(true);
    expect(matchesJob(job, 'sink garden')).toBe(false);
    expect(matchesJob(job, 'MR-1023')).toBe(false);
  });
});
