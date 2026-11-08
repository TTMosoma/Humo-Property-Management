import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PolicyNotices } from '../security/policy-notices';
import { FeedbackService, failureTimeout } from './feedback.service';

vi.mock('@ionic/angular/standalone', async () => (await import('../../testing-ionic')).ionicStandin());
// The same class the service was given, whichever spec loaded the stand-in first.
const { ToastController } = (await import('../../testing-ionic')).ionicStandin();

type Options = { duration: number; buttons: { text?: string; icon?: string }[]; message: string; header?: string };

describe('FeedbackService', () => {
  let created: Options[];
  let toast: HTMLElement & { header?: string; dismiss: ReturnType<typeof vi.fn>; present: () => Promise<void> };

  beforeEach(() => {
    vi.useFakeTimers();
    created = [];
    toast = Object.assign(document.createElement('div'), { dismiss: vi.fn(() => Promise.resolve()), present: () => Promise.resolve() });
    TestBed.configureTestingModule({
      providers: [
        FeedbackService,
        { provide: PolicyNotices, useValue: { consume: () => null } },
        {
          provide: ToastController,
          useValue: {
            getTop: () => Promise.resolve(undefined),
            create: (o: Options) => {
              created.push(o);
              toast.header = o.header;
              return Promise.resolve(toast);
            },
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    toast.remove();
  });

  it('shows a failure in full, with a close button and the time left', async () => {
    const long = 'None of the 2 photos were stored. '.repeat(20);
    await TestBed.inject(FeedbackService).error(long);

    expect(created[0].message).toBe(long);
    expect(created[0].buttons.map((b) => b.icon)).toEqual(['close-outline']);
    expect(toast.header).toBe(`Closes in ${failureTimeout(long) / 1000}s`);
  });

  it('closes a failure when its countdown runs out, but not while the pointer is on it', async () => {
    await TestBed.inject(FeedbackService).error('The photo wasn’t stored.');
    const total = failureTimeout('The photo wasn’t stored.');

    toast.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(total + 1000);
    expect(toast.dismiss).not.toHaveBeenCalled();
    expect(toast.header).toBe('Paused while you read');

    toast.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(total);
    expect(toast.dismiss).toHaveBeenCalled();
  });

  it('gives a longer message longer, within limits', () => {
    expect(failureTimeout('Short.')).toBe(8_000);
    expect(failureTimeout('x'.repeat(1000))).toBe(30_000);
  });

  it('lets a confirmation go by itself', async () => {
    await TestBed.inject(FeedbackService).success('Photo added');

    expect(created[0].duration).toBe(3000);
    expect(created[0].buttons).toEqual([]);
  });
});
