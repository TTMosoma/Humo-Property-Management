import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Scheme, SchemeDataSource, coversAllSchemes, isHumoRole } from '../../domain';
import { loadable } from '../data/loadable';
import { safeStorage } from '../prototype/safe-storage';
import { SessionService } from '../session/session.service';

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Scheme scope: "which scheme am I working on right now?"
 *
 * - `scopeId` null means "All schemes". Every portfolio-wide list, count and
 *   search respects it, so an agent can work on one scheme for an hour without
 *   re-filtering each module.
 * - Pinned schemes appear in the sidebar for one-click access. Portfolio managers
 *   start with their assigned schemes pinned.
 * - Trustees, owners and tenants are always scoped to their own scheme(s).
 */
@Injectable({ providedIn: 'root' })
export class ScopeService {
  private readonly session = inject(SessionService);
  private readonly source = inject(SchemeDataSource);

  /** Loaded once for the shell. Pages that list schemes show its state (and can retry it). */
  private readonly schemes = loadable(() => this.source.list());
  private readonly allSchemes = computed(() => this.schemes.value() ?? []);
  readonly status = this.schemes.status;
  readonly retry = () => this.schemes.retry();

  /**
   * Schemes the active assignment covers. "Role determines what someone can do;
   * assignment determines what they can see." Covering for a colleague is an
   * extra (temporary) assignment, not a wider role.
   */
  readonly accessible = computed<Scheme[]>(() => this.inScope().filter((s) => s.status !== 'archived'));

  /** Every scheme the assignment covers, archived ones included (the schemes list's "Archived" view). */
  readonly inScope = computed<Scheme[]>(() => {
    const m = this.session.assignment();
    if (isHumoRole(m.role)) return [];
    const inAgency = this.allSchemes().filter((s) => s.organisationId === m.scope.organisationId);
    if (coversAllSchemes(m)) return inAgency;
    return inAgency.filter((s) => m.scope.schemeIds.includes(s.id));
  });

  /** Whether this membership can change scope (staff) or is fixed to its scheme(s). */
  readonly canChangeScope = computed(() => this.session.isStaff());

  private readonly chosenId = signal<string | null>(readSession('humo.scope'));

  readonly scopeId = computed<string | null>(() => {
    const ids = this.accessible().map((s) => s.id);
    if (!this.canChangeScope()) {
      const own = this.session.assignment().scope.schemeIds;
      return own.length === 1 ? own[0] : null;
    }
    const chosen = this.chosenId();
    return chosen && (ids.length === 0 || ids.includes(chosen)) ? chosen : null;
  });

  readonly scheme = computed(() => this.allSchemes().find((s) => s.id === this.scopeId()));

  /** The scheme ids every list should be filtered to. */
  readonly effectiveIds = computed<string[]>(() => {
    const id = this.scopeId();
    return id ? [id] : this.accessible().map((s) => s.id);
  });

  // ---- Pinned schemes (per role assignment, persisted) ----
  private readonly pinnedStore = signal<Record<string, string[]>>(this.readPins());

  readonly pinnedIds = computed<string[]>(() => {
    // Pins belong to an assignment: Sarah's Portfolio Manager pins aren't her Finance pins.
    const stored = this.pinnedStore()[this.session.assignment().id];
    if (stored) return stored;
    // Sensible default: a portfolio manager's assigned schemes; otherwise the first few in the agency.
    const m = this.session.assignment();
    if (this.session.isStaff() && m.scope.schemeIds.length <= 8) return m.scope.schemeIds;
    return [];
  });

  readonly pinned = computed<Scheme[]>(() => {
    const byId = new Map(this.accessible().map((s) => [s.id, s]));
    return this.pinnedIds()
      .map((id) => byId.get(id))
      .filter((s): s is Scheme => !!s);
  });

  constructor() {
    effect(() => writeSession('humo.scope', this.chosenId()));
    effect(() => safeStorage.set('humo.pins', JSON.stringify(this.pinnedStore())));
  }

  setScope(id: string | null): void {
    this.chosenId.set(id);
  }

  isPinned(id: string): boolean {
    return this.pinnedIds().includes(id);
  }

  togglePin(id: string): void {
    const key = this.session.assignment().id;
    const current = this.pinnedIds();
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    this.pinnedStore.update((s) => ({ ...s, [key]: next }));
  }

  findScheme(id: string | null | undefined): Scheme | undefined {
    return id ? this.allSchemes().find((s) => s.id === id) : undefined;
  }

  private readPins(): Record<string, string[]> {
    try {
      return JSON.parse(safeStorage.get('humo.pins') ?? '{}');
    } catch {
      return {};
    }
  }
}
