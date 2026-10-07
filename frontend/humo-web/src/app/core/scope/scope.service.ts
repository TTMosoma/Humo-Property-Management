import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { Scheme, SchemeDataSource, isHumoRole } from '../../domain';
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

  /** Loaded once for the shell; independent of the page-level error simulator. */
  private readonly allSchemes = toSignal(
    inject(SchemeDataSource).list().pipe(catchError(() => of([] as Scheme[]))),
    { initialValue: [] as Scheme[] },
  );

  /**
   * Schemes the active assignment covers. "Role determines what someone can do;
   * assignment determines what they can see." Covering for a colleague is an
   * extra (temporary) assignment, not a wider role.
   */
  readonly accessible = computed<Scheme[]>(() => {
    const m = this.session.membership();
    if (isHumoRole(m.role)) return [];
    const inAgency = this.allSchemes().filter((s) => s.agencyId === m.agencyId);
    if (m.schemeIds.length === 0) return inAgency;
    return inAgency.filter((s) => m.schemeIds.includes(s.id));
  });

  /** Whether this membership can change scope (staff) or is fixed to its scheme(s). */
  readonly canChangeScope = computed(() => this.session.isStaff());

  private readonly chosenId = signal<string | null>(readSession('humo.scope'));

  readonly scopeId = computed<string | null>(() => {
    const ids = this.accessible().map((s) => s.id);
    if (!this.canChangeScope()) {
      const own = this.session.membership().schemeIds;
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
    const stored = this.pinnedStore()[this.session.membership().id];
    if (stored) return stored;
    // Sensible default: a portfolio manager's assigned schemes; otherwise the first few in the agency.
    const m = this.session.membership();
    if (this.session.isStaff() && m.schemeIds.length <= 8) return m.schemeIds;
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
    const key = this.session.membership().id;
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
