import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PolicyNotices } from '../security/policy-notices';
import { FeedbackService } from './feedback.service';

vi.mock('@ionic/angular/standalone', () => ({ ToastController: class {} }));
const { ToastController } = await import('@ionic/angular/standalone');

describe('FeedbackService', () => {
  let created: { duration: number; buttons: { text: string }[]; message: string }[];

  beforeEach(() => {
    created = [];
    const toast = { present: () => Promise.resolve(), dismiss: () => Promise.resolve() };
    TestBed.configureTestingModule({
      providers: [
        FeedbackService,
        { provide: PolicyNotices, useValue: { consume: () => null } },
        {
          provide: ToastController,
          useValue: {
            getTop: () => Promise.resolve(undefined),
            create: (o: { duration: number; buttons: { text: string }[]; message: string }) => {
              created.push(o);
              return Promise.resolve(Object.assign(document.createElement('div'), toast));
            },
          },
        },
      ],
    });
  });

  it('keeps a failure on screen, in full, until it is closed', async () => {
    const long = 'None of the 2 photos were stored. '.repeat(20);
    await TestBed.inject(FeedbackService).error(long);

    expect(created[0].duration).toBe(0);
    expect(created[0].message).toBe(long);
    expect(created[0].buttons.map((b) => b.text)).toEqual(['Close']);
  });

  it('lets a confirmation go by itself', async () => {
    await TestBed.inject(FeedbackService).success('Photo added');

    expect(created[0].duration).toBe(3000);
    expect(created[0].buttons).toEqual([]);
  });
});
