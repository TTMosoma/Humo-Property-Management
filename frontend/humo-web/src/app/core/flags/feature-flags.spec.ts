import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Observable, defer, of, throwError } from 'rxjs';
import { OpsDataSource } from '../../domain';
import { SessionService } from '../session/session.service';
import { FeatureFlags } from './feature-flags';

describe('FeatureFlags', () => {
  afterEach(() => vi.useRealTimers());

  it('reads the switches again after a failed read, so an open tab catches up', async () => {
    vi.useFakeTimers();
    let calls = 0;
    // The first read fails (the API is restarting); the retry gets the switches.
    const myFlags = (): Observable<Record<string, boolean>> =>
      defer(() => (++calls === 1 ? throwError(() => new Error('unavailable')) : of({ 'receipt-capture': true })));
    const session = { signedIn: signal(true), identity: signal({ id: 'u-1' }), assignment: signal({ id: 'a-1' }) };
    TestBed.configureTestingModule({
      providers: [
        { provide: OpsDataSource, useValue: { myFlags } },
        { provide: SessionService, useValue: session },
      ],
    });
    const flags = TestBed.inject(FeatureFlags);
    TestBed.tick();
    expect(flags.on('receipt-capture')).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(flags.on('receipt-capture')).toBe(true);
    expect(calls).toBe(2);

    // Signing in as someone else reads them again.
    session.identity.set({ id: 'u-2' });
    TestBed.tick();
    expect(calls).toBe(3);
  });

  it('reads nothing while signed out', () => {
    let calls = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: OpsDataSource, useValue: { myFlags: () => (calls++, of({ 'receipt-capture': true })) } },
        { provide: SessionService, useValue: { signedIn: signal(false), identity: signal({ id: '' }), assignment: signal({ id: '' }) } },
      ],
    });
    const flags = TestBed.inject(FeatureFlags);
    TestBed.tick();
    expect(flags.on('receipt-capture')).toBe(false);
    expect(calls).toBe(0);
  });
});
