/**
 * DEVELOPMENT / SIMULATION ONLY — not production persistence.
 *
 * Keeps the simulated backend's data in this browser's localStorage so that a
 * refresh doesn't throw away what you created, edited or archived while
 * walking through Humo. Each mock store saves a snapshot of its own state
 * (shortly after it changes) and restores it on start-up. The real backend
 * replaces all of this; nothing in the app outside `mock/` knows it exists.
 *
 * Snapshots are versioned: bump SCHEMA when a store's shape changes, and old
 * snapshots are ignored (the store re-seeds). "Reset simulation" in the
 * prototype toolbar clears everything and reloads from the seed data.
 */
const SCHEMA = 2;
const PREFIX = 'humo.sim.';

interface Envelope<T> {
  schema: number;
  savedAt: string;
  data: T;
}

/** Simulated server state kept under other keys (the session, nudge history, scope). Theme and latency preferences stay. */
const SESSION_KEYS = ['humo.persona', 'humo.signedOut', 'humo.membership', 'humo.impersonation', 'humo.nudges', 'humo.pins', 'humo.sidebar'];

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const simulationStorage = {
  /** The saved snapshot for a store, or null (none, unreadable, or from an older schema). */
  load<T>(store: string): T | null {
    try {
      const raw = localStorage.getItem(PREFIX + store);
      if (!raw) return null;
      const env = JSON.parse(raw) as Envelope<T>;
      return env.schema === SCHEMA ? env.data : null;
    } catch {
      return null;
    }
  },

  /** Saves a snapshot soon (debounced), so a burst of changes writes once. */
  save(store: string, snapshot: () => unknown): void {
    clearTimeout(timers.get(store));
    timers.set(
      store,
      setTimeout(() => {
        try {
          const env: Envelope<unknown> = { schema: SCHEMA, savedAt: new Date().toISOString(), data: snapshot() };
          localStorage.setItem(PREFIX + store, JSON.stringify(env));
        } catch {
          // Storage full or blocked: the simulation still works, it just won't survive a refresh.
        }
      }, 400),
    );
  },

  /** When the simulation was last saved (for the prototype toolbar). */
  lastSaved(): string | null {
    try {
      const times = Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIX))
        .map((k) => (JSON.parse(localStorage.getItem(k) ?? '{}') as Envelope<unknown>).savedAt)
        .filter(Boolean)
        .sort();
      return times.at(-1) ?? null;
    } catch {
      return null;
    }
  },

  /** Forgets every simulated record and the simulated session. Reload afterwards. */
  reset(): void {
    try {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith(PREFIX) || SESSION_KEYS.includes(k)) localStorage.removeItem(k);
      }
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  },
};

/** Map → entries and back, for snapshots. */
export const entries = <K, V>(m: Map<K, V>): [K, V][] => [...m.entries()];
