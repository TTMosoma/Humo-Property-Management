import { DestroyRef, Injectable, InjectionToken, Injector, computed, effect, inject } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { DataChanges, DataTopic } from '../core/data/data-changes';
import { LiveUpdates } from '../core/data/live-updates';
import { SessionService } from '../core/session/session.service';
import { SessionDataSource } from '../domain';
import { API_BASE_URL, HttpSessionDataSource } from './http-session-data-source';

/** The topics the API pushes (`Live/LiveUpdates.cs`); anything else is ignored. */
const PUSHED: readonly DataTopic[] = ['notifications', 'work-items', 'session', 'jobs', 'inbox'];

/**
 * Checks the session with the API again (GET /me). If it has ended (passkeys removed, signed out elsewhere, suspended),
 * the shell leaves for the signed-out page. Tests replace it.
 */
export const SESSION_CHECK = new InjectionToken<() => void>('SESSION_CHECK', {
  factory: () => {
    const source = inject(SessionDataSource);
    return () => {
      if (source instanceof HttpSessionDataSource) source.reload().subscribe();
    };
  },
});

/** Builds the SignalR connection; tests replace it. */
export const LIVE_CONNECTION = new InjectionToken<(url: string) => HubConnection>('LIVE_CONNECTION', {
  factory: () => (url) =>
    new HubConnectionBuilder()
      .withUrl(url, { withCredentials: true })
      // Keeps trying after a dropped connection (0 s, 2 s, 10 s, 30 s, then every 30 s).
      .withAutomaticReconnect({ nextRetryDelayInMilliseconds: (r) => [0, 2_000, 10_000][r.previousRetryCount] ?? 30_000 })
      .configureLogging(LogLevel.Warning)
      .build(),
});

/**
 * The live build's connection to `/api/hubs/updates`. The API sends only the names of what changed; each name is fed
 * into `DataChanges`, so the bell and My work fetch again through the normal endpoints. Connected while someone is
 * signed in, and reconnected when they switch role or impersonate, so the API puts them in the right groups.
 */
@Injectable()
export class HttpLiveUpdates implements LiveUpdates {
  private readonly session = inject(SessionService);
  private readonly changes = inject(DataChanges);
  private readonly connect = inject(LIVE_CONNECTION);
  private readonly checkSession = inject(SESSION_CHECK);
  private readonly url = `${inject(API_BASE_URL)}/hubs/updates`;
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  /** One reconnect at a time, in order. */
  private queue: Promise<void> = Promise.resolve();
  private connection: HubConnection | null = null;
  private started = false;

  /** Who the connection is for: empty when nobody is signed in. */
  private readonly owner = computed(() => (this.session.dataOwner() ? `${this.session.dataOwner()}|${this.session.impersonation()?.id ?? ''}` : ''));

  start(): void {
    if (this.started) return;
    this.started = true;
    effect(
      () => {
        const owner = this.owner();
        this.queue = this.queue.then(() => this.reconnect(owner));
      },
      { injector: this.injector },
    );
    this.destroyRef.onDestroy(() => {
      this.queue = this.queue.then(() => this.stop());
    });
  }

  private async reconnect(owner: string): Promise<void> {
    await this.stop();
    if (!owner) return;
    const connection = this.connect(this.url);
    connection.on('changed', (topics: unknown) => this.heard(topics));
    // Back after a gap: anything could have changed meanwhile, the session included.
    connection.onreconnected(() => {
      this.checkSession();
      this.changes.notify(...PUSHED);
    });
    this.connection = connection;
    try {
      await connection.start();
    } catch {
      // Not reachable now (offline, or the session ended): the app still works, refreshing on the person's own actions.
      if (this.connection === connection) this.connection = null;
    }
  }

  private async stop(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    if (connection && connection.state !== HubConnectionState.Disconnected) await connection.stop().catch(() => undefined);
  }

  private heard(topics: unknown): void {
    const known = Array.isArray(topics) ? PUSHED.filter((t) => topics.includes(t)) : [];
    // Their access changed: find out now whether this session still counts.
    if (known.includes('session')) this.checkSession();
    if (known.length) this.changes.notify(...known);
  }
}
