import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HubConnection, HubConnectionState } from '@microsoft/signalr';
import { DataChanges, DataTopic } from '../core/data/data-changes';
import { SessionService } from '../core/session/session.service';
import { HttpLiveUpdates, LIVE_CONNECTION } from './http-live-updates';

/** A stand-in for the SignalR connection: records what the app asked of it, and lets the test push messages. */
class FakeConnection {
  state = HubConnectionState.Disconnected;
  handlers = new Map<string, (arg: unknown) => void>();
  reconnected?: () => void;
  stopped = false;
  constructor(readonly url: string) {}
  on(name: string, handler: (arg: unknown) => void) {
    this.handlers.set(name, handler);
  }
  onreconnected(handler: () => void) {
    this.reconnected = handler;
  }
  async start() {
    this.state = HubConnectionState.Connected;
  }
  async stop() {
    this.stopped = true;
    this.state = HubConnectionState.Disconnected;
  }
  push(topics: unknown) {
    this.handlers.get('changed')?.(topics);
  }
}

describe('Live updates over SignalR (HttpLiveUpdates)', () => {
  const owner = signal('');
  const impersonation = signal<{ id: string } | null>(null);
  let made: FakeConnection[];
  let heard: DataTopic[][];

  const settle = async () => {
    TestBed.tick();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    made = [];
    heard = [];
    owner.set('');
    impersonation.set(null);
    TestBed.configureTestingModule({
      providers: [
        HttpLiveUpdates,
        { provide: SessionService, useValue: { dataOwner: owner, impersonation } },
        {
          provide: LIVE_CONNECTION,
          useValue: (url: string) => {
            const c = new FakeConnection(url);
            made.push(c);
            return c as unknown as HubConnection;
          },
        },
      ],
    });
    const changes = TestBed.inject(DataChanges);
    const notify = changes.notify.bind(changes);
    changes.notify = (...topics: DataTopic[]) => {
      heard.push(topics);
      notify(...topics);
    };
  });

  it('connects only while someone is signed in', async () => {
    TestBed.inject(HttpLiveUpdates).start();
    await settle();
    expect(made).toHaveLength(0);

    owner.set('u-1|a-1');
    await settle();
    expect(made).toHaveLength(1);
    expect(made[0].url).toBe('/api/hubs/updates');

    owner.set('');
    await settle();
    expect(made[0].stopped).toBe(true);
  });

  it('a pushed change makes the bell and My work fetch again', async () => {
    owner.set('u-1|a-1');
    TestBed.inject(HttpLiveUpdates).start();
    await settle();

    made[0].push(['notifications', 'work-items']);

    expect(heard).toEqual([['notifications', 'work-items']]);
  });

  it('ignores anything it does not know', async () => {
    owner.set('u-1|a-1');
    TestBed.inject(HttpLiveUpdates).start();
    await settle();

    made[0].push(['session', 'payables']);
    made[0].push('notifications');

    expect(heard).toEqual([]);
  });

  it('reconnects when the person switches role or impersonates, so the API puts them in the right groups', async () => {
    owner.set('u-1|a-1');
    TestBed.inject(HttpLiveUpdates).start();
    await settle();

    owner.set('u-1|a-2');
    await settle();
    impersonation.set({ id: 'imp-1' });
    await settle();

    expect(made).toHaveLength(3);
    expect(made.slice(0, 2).every((c) => c.stopped)).toBe(true);
  });

  it('catches up after a dropped connection comes back', async () => {
    owner.set('u-1|a-1');
    TestBed.inject(HttpLiveUpdates).start();
    await settle();

    made[0].reconnected?.();

    expect(heard).toEqual([['notifications', 'work-items']]);
  });
});
