import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { SCHEME_STATUS_LABELS, SchemeDataSource } from '../../domain';
import { newSchemeForm } from './scheme-forms';
import { loadable } from '../../core/data/loadable';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { FilterBar, FilterDef } from '../../ui/data-table/filter-bar';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { RandPipe, formatRand } from '../../ui/format/money';
import { SchemeArt } from '../../ui/illustration/scheme-art';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { SchemePreview } from './scheme-preview';
import { COMPLIANCE, RATING, SchemeRow, collectionTone, toRows } from './scheme-view';

/**
 * Portfolio › Schemes: which scheme needs me? A health table across the
 * portfolio (collections, arrears, jobs, compliance), with pinning and
 * "work on this scheme" to set the scope for the rest of the app.
 */
@Component({
  selector: 'app-schemes-page',
  imports: [PageHeader, ViewTabs, FilterBar, DataTable, CellDef, StatusPill, SchemeArt, EmptyState, ErrorState, Skeleton, IonIcon, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './schemes-page.html',
  styleUrl: './schemes-page.scss',
})
export class SchemesPage {
  private readonly data = inject(SchemeDataSource);
  private readonly drawer = inject(DrawerService);
  protected readonly scope = inject(ScopeService);
  protected readonly session = inject(SessionService);

  protected readonly state = urlState({ view: 'all', q: '', type: null, province: null, manager: null, health: null });
  protected readonly activeId = signal<string | null>(null);

  private readonly healthLoad = loadable(() => this.data.health());
  private readonly health = computed(() => this.healthLoad.value() ?? []);

  /** The list needs both the schemes and their health figures. */
  protected readonly status = computed(() => {
    const states = [this.scope.status(), this.healthLoad.status()];
    return states.includes('error') ? 'error' : states.includes('loading') ? 'loading' : 'ready';
  });

  protected retry(): void {
    if (this.scope.status() === 'error') this.scope.retry();
    if (this.healthLoad.status() === 'error') this.healthLoad.retry();
  }

  /** Archived schemes only appear in their own view. */
  protected readonly allRows = computed(() => toRows(this.state().view === 'archived' ? this.scope.inScope().filter((s) => s.status === 'archived') : this.scope.accessible(), this.health()));
  private readonly archivedCount = computed(() => this.scope.inScope().filter((s) => s.status === 'archived').length);
  private readonly router = inject(Router);

  protected addScheme(): void {
    newSchemeForm(this.drawer, this.data, this.router);
  }

  private readonly byView = computed(() => {
    const rows = this.allRows();
    const mine = this.session.assignment().scope.schemeIds;
    switch (this.state().view) {
      case 'pinned':
        return rows.filter((r) => this.scope.isPinned(r.scheme.id));
      case 'mine':
        return rows.filter((r) => mine.includes(r.scheme.id));
      case 'attention':
        return rows.filter((r) => r.health.rating !== 'good');
      default:
        return rows;
    }
  });

  protected readonly rows = computed(() => {
    const s = this.state();
    const q = (s.q ?? '').toLowerCase().trim();
    return this.byView()
      .filter((r) => !s.type || r.scheme.type === s.type)
      .filter((r) => !s.province || r.scheme.province === s.province)
      .filter((r) => !s.manager || r.scheme.portfolioManager?.identityId === s.manager)
      .filter((r) => !s.health || r.health.rating === s.health)
      .filter((r) => !q || [r.scheme.name, r.scheme.code, r.scheme.suburb, r.scheme.city, r.manager].join(' ').toLowerCase().includes(q));
  });

  protected readonly totals = computed(() => {
    const rows = this.rows();
    return {
      schemes: rows.length,
      units: rows.reduce((n, r) => n + r.scheme.unitCount, 0),
      arrears: rows.reduce((n, r) => n + r.health.arrears, 0),
      atRisk: rows.filter((r) => r.health.rating === 'at-risk').length,
    };
  });

  protected readonly subtitle = computed(() => {
    const all = this.allRows();
    const arrears = all.reduce((n, r) => n + r.health.arrears, 0);
    const units = all.reduce((n, r) => n + r.scheme.unitCount, 0);
    return `${all.length} schemes · ${units.toLocaleString('en-ZA').replace(/,/g, ' ')} units · ${formatRand(arrears, { compact: true })} in arrears`;
  });

  protected readonly tabs = computed(() => {
    const rows = toRows(this.scope.accessible(), this.health());
    const tabs = [
      { id: 'all', label: 'All schemes', count: rows.length },
      { id: 'pinned', label: 'Pinned', count: rows.filter((r) => this.scope.isPinned(r.scheme.id)).length },
      { id: 'attention', label: 'Needs attention', count: rows.filter((r) => r.health.rating !== 'good').length },
    ];
    if (this.session.role() === 'portfolio-manager') {
      tabs.splice(1, 0, { id: 'mine', label: 'My schemes', count: this.session.assignment().scope.schemeIds.length });
    }
    if (this.archivedCount() || this.state().view === 'archived') tabs.push({ id: 'archived', label: 'Archived', count: this.archivedCount() });
    return tabs;
  });

  protected schemeStatus(r: SchemeRow): string {
    return SCHEME_STATUS_LABELS[r.scheme.status];
  }

  protected readonly filters = computed<FilterDef[]>(() => [
    {
      key: 'type',
      label: 'Type',
      options: ['Sectional Title', 'Home Owners Association', 'Share Block'].map((t) => ({ value: t, label: t })),
    },
    {
      key: 'province',
      label: 'Province',
      options: ['Gauteng', 'KwaZulu-Natal', 'Western Cape'].map((p) => ({ value: p, label: p })),
    },
    {
      key: 'manager',
      label: 'Manager',
      // The managers of the schemes in view (from their assignments), not a fixed staff list.
      options: [...new Map(this.allRows().filter((r) => r.scheme.portfolioManager).map((r) => [r.scheme.portfolioManager!.identityId, r.scheme.portfolioManager!.name])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    },
    {
      key: 'health',
      label: 'Health',
      options: (['good', 'watch', 'at-risk'] as const).map((h) => ({ value: h, label: RATING[h].label })),
    },
  ]);

  protected readonly columns: ColumnDef<SchemeRow>[] = [
    { key: 'scheme', header: 'Scheme', mobile: 'title', sort: (r) => r.scheme.name },
    { key: 'units', header: 'Units', align: 'end', width: '72px', sort: (r) => r.scheme.unitCount },
    { key: 'collections', header: 'Collections', align: 'end', width: '120px', sort: (r) => r.health.collectionRate },
    { key: 'arrears', header: 'Arrears', align: 'end', width: '120px', sort: (r) => r.health.arrears },
    { key: 'jobs', header: 'Open jobs', align: 'end', width: '96px', sort: (r) => r.health.openJobs },
    { key: 'compliance', header: 'Compliance', width: '130px', sort: (r) => r.health.compliance },
    { key: 'manager', header: 'Manager', width: '160px', mobile: 'meta', sort: (r) => r.manager },
    { key: 'pin', header: '', width: '48px', align: 'center', mobile: 'hidden' },
  ];

  protected readonly rowId = (r: SchemeRow) => r.scheme.id;
  protected ratingOf(r: SchemeRow) {
    return RATING[r.health.rating];
  }

  protected complianceOf(r: SchemeRow) {
    return COMPLIANCE[r.health.compliance];
  }

  protected readonly collectionTone = collectionTone;

  protected patch(change: Partial<Record<'view' | 'q' | 'type' | 'province' | 'manager' | 'health', string | null>>): void {
    this.state.update((s) => ({ ...s, ...change }));
  }

  protected setFilters(v: Record<string, string | null>): void {
    this.patch({ type: v['type'] ?? null, province: v['province'] ?? null, manager: v['manager'] ?? null, health: v['health'] ?? null });
  }

  protected open(r: SchemeRow): void {
    this.activeId.set(r.scheme.id);
    this.drawer.open(SchemePreview, r, r.scheme.name).closed.subscribe(() => {
      if (this.activeId() === r.scheme.id) this.activeId.set(null);
    });
  }

  protected togglePin(r: SchemeRow, e: Event): void {
    e.stopPropagation();
    this.scope.togglePin(r.scheme.id);
  }
}
