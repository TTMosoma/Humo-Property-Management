import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of, switchMap } from 'rxjs';
import { AuditCategory, AuditDataSource, AuditEvent, AuditQuery, IMPERSONATION_REASONS, ROLE_LABELS } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { pageState } from '../../core/prototype/page-state';
import { ScopeService } from '../../core/scope/scope.service';
import { StepUpService } from '../../core/security/step-up.service';
import { SessionService } from '../../core/session/session.service';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { formatRand } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';

const DAY = new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' });
const STAMP = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Audit log: what people actually did. Two audiences, one page:
 *  - Settings › Audit log: an agency administrator sees their agency, including
 *    every time Humo staff impersonated one of their people ("Humo access").
 *  - Platform › Audit log: Humo sees every agency and its own staff.
 */
@Component({
  selector: 'app-audit-page',
  imports: [PageHeader, ViewTabs, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audit-page.html',
  styleUrl: './audit-page.scss',
})
export class AuditPage {
  private readonly data = inject(AuditDataSource);
  private readonly stepUp = inject(StepUpService);
  private readonly feedback = inject(FeedbackService);
  private readonly scope = inject(ScopeService);
  protected readonly session = inject(SessionService);
  protected readonly page = pageState();

  /** Platform view (Humo) vs one agency's view. */
  protected readonly platform = !!inject(ActivatedRoute).snapshot.data['platform'];
  protected readonly state = urlState({ view: 'all', q: null, agency: null, only: null, actor: null, role: null, scheme: null, range: null });
  protected readonly expanded = signal<string | null>(null);
  protected readonly exporting = signal(false);

  private readonly query = computed<AuditQuery>(() => ({ agencyId: this.platform ? null : (this.session.agency()?.id ?? '') }));

  private readonly result = toSignal(
    toObservable(this.query).pipe(
      switchMap((q) =>
        this.data.query(q).pipe(
          map((events) => ({ events, failed: false })),
          catchError(() => of({ events: [] as AuditEvent[], failed: true })),
        ),
      ),
    ),
  );

  protected readonly loading = computed(() => this.page.status() === 'loading' || this.result() === undefined);
  protected readonly failed = computed(() => this.page.status() === 'error' || !!this.result()?.failed);
  private readonly all = computed(() => (this.page.forceEmpty() ? [] : [...(this.result()?.events ?? [])].sort((a, b) => b.at.localeCompare(a.at))));

  /** Agency filter (platform only) and text search, before the category tabs. */
  private readonly base = computed(() => {
    const { q, agency, only, actor, role, scheme, range } = this.state();
    const needle = (q ?? '').trim().toLowerCase();
    const since = range ? Date.now() - Number(range) * 86_400_000 : 0;
    return this.all().filter((e) => {
      if (actor && e.actor.identityId !== actor && e.actingAs?.identityId !== actor) return false;
      if (role && e.role !== role) return false;
      if (scheme && e.schemeId !== scheme) return false;
      if (since && new Date(e.at).getTime() < since) return false;
      if (agency === 'humo' && e.agencyId !== null) return false;
      if (agency && agency !== 'humo' && e.agencyId !== agency) return false;
      if (only === 'problems' && e.result === 'success') return false;
      if (!needle) return true;
      return [e.actor.name, e.actingAs?.name, e.action, e.resource, e.resourceId, ROLE_LABELS[e.role]].some((x) => x?.toLowerCase().includes(needle));
    });
  });

  protected readonly tabs = computed(() => {
    const b = this.base();
    const count = (c: AuditCategory) => b.filter((e) => e.category === c).length;
    return [
      { id: 'all', label: 'All events', count: b.length },
      { id: 'activity', label: 'Activity', count: count('activity') },
      { id: 'security', label: 'Security', count: count('security') },
      { id: 'impersonation', label: this.platform ? 'Impersonation' : 'Humo access', count: b.filter((e) => !!e.actingAs).length },
    ];
  });

  protected readonly rows = computed(() => {
    const v = this.state().view;
    if (v === 'impersonation') return this.base().filter((e) => !!e.actingAs);
    return v === 'all' ? this.base() : this.base().filter((e) => e.category === v);
  });

  /** Grouped by day, newest first. */
  protected readonly days = computed(() => {
    const groups: { label: string; events: AuditEvent[] }[] = [];
    for (const e of this.rows()) {
      const label = DAY.format(new Date(e.at));
      const last = groups[groups.length - 1];
      if (last?.label === label) last.events.push(e);
      else groups.push({ label, events: [e] });
    }
    return groups;
  });

  protected readonly humoSessions = computed(() => this.all().filter((e) => e.category === 'impersonation' && e.action.startsWith('Started')).length);

  protected readonly agencies = this.session.agencies;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly reasons = IMPERSONATION_REASONS;
  protected readonly time = (iso: string) => TIME.format(new Date(iso));
  protected readonly stamp = (iso: string) => STAMP.format(new Date(iso));
  protected readonly rand = (n: number) => formatRand(n);

  protected agencyName(id: string | null): string {
    return id === null ? 'Humo platform' : (this.agencies.find((a) => a.id === id)?.shortName ?? id);
  }

  protected schemeName(id: string | null | undefined): string | null {
    return id ? (this.scope.findScheme(id)?.name ?? id) : null;
  }

  /** Business references (MR-1042, PB-0412) read well in the row; internal ids stay in the details. */
  protected showRef(e: AuditEvent): boolean {
    return !['Identity', 'Role assignment', 'Security settings', 'Step-up', 'Session', 'Passkey', 'Export'].includes(e.resource ?? '');
  }

  protected toggle(id: string): void {
    this.expanded.update((x) => (x === id ? null : id));
  }

  /** Filter options come from the events themselves. */
  protected readonly people = computed(() => {
    const m = new Map<string, string>();
    for (const e of this.all()) {
      m.set(e.actor.identityId, e.actor.name);
      if (e.actingAs) m.set(e.actingAs.identityId, e.actingAs.name);
    }
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });
  protected readonly roles = computed(() => [...new Set(this.all().map((e) => e.role))].map((r) => ({ id: r, label: ROLE_LABELS[r] })));
  protected readonly schemesSeen = computed(() =>
    [...new Set(this.all().map((e) => e.schemeId).filter((x): x is string => !!x))].map((id) => ({ id, name: this.schemeName(id) ?? id })),
  );
  protected readonly filtered = computed(() => ['actor', 'role', 'scheme', 'range', 'agency', 'only', 'q'].some((k) => !!(this.state() as Record<string, string | null>)[k]));

  protected clearFilters(): void {
    this.state.set({ view: this.state().view, q: null, agency: null, only: null, actor: null, role: null, scheme: null, range: null });
  }

  protected set(key: 'view' | 'q' | 'agency' | 'only' | 'actor' | 'role' | 'scheme' | 'range', value: string | null): void {
    this.state.update((s) => ({ ...s, [key]: value || null }));
    this.expanded.set(null);
  }

  protected exportLog(): void {
    const q: AuditQuery = { ...this.query(), category: this.state().view === 'all' || this.state().view === 'impersonation' ? undefined : (this.state().view as AuditCategory) };
    this.exporting.set(true);
    this.stepUp
      .guard({ action: 'export-data', detail: `Export ${this.rows().length} audit events (${this.platform ? 'all agencies' : this.session.agency()?.shortName})` }, () => this.data.export(q))
      .subscribe({
        next: (file) => {
          this.exporting.set(false);
          this.feedback.success(`Prepared ${file}. The export itself is recorded in the audit log.`);
        },
        error: () => {
          this.exporting.set(false);
          this.feedback.error('The export couldn’t be prepared.');
        },
        complete: () => this.exporting.set(false),
      });
  }
}
