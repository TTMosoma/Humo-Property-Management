import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { PersonDataSource, PersonSummary, RelationshipView, Scheme } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { FilterBar, FilterDef } from '../../ui/data-table/filter-bar';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { RandPipe } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { PersonPreview } from './person-preview';
import { RoleChip, hasRole, roleChips } from './person-view';

const PAGE = 50;

/**
 * People (decision D1): one directory; Owners, Tenants and Trustees are filtered
 * views of the same people. Reused as a scheme's People tab with the scheme fixed.
 */
@Component({
  selector: 'app-people-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, FilterBar, DataTable, CellDef, EmptyState, ErrorState, Skeleton, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './people-page.html',
  styleUrl: './people-page.scss',
})
export class PeoplePage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(PersonDataSource);
  private readonly drawer = inject(DrawerService);
  protected readonly scope = inject(ScopeService);

  protected readonly fixedScheme = toSignal(this.route.data.pipe(map((d) => d['scheme'] as Scheme | undefined)), {
    initialValue: this.route.snapshot.data['scheme'] as Scheme | undefined,
  });

  protected readonly state = urlState({ role: 'all', q: '', scheme: null });
  protected readonly activeId = signal<string | null>(null);
  protected readonly limit = signal(PAGE);

  private readonly schemeIds = computed(() => (this.fixedScheme() ? [this.fixedScheme()!.id] : this.scope.effectiveIds()));

  protected readonly result = loadable(() => this.data.list(this.schemeIds()).pipe(map((p) => ({ rows: p.items }))));

  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;
  private readonly all = computed(() =>
    [...(this.result.value()?.rows ?? [])].sort((a, b) => a.person.lastName.localeCompare(b.person.lastName)),
  );

  protected readonly filtered = computed(() => {
    const s = this.state();
    const q = (s.q ?? '').toLowerCase().trim();
    return this.all()
      .filter((p) => s.role === 'all' || !s.role || hasRole(p, s.role as 'owner' | 'tenant' | 'trustee'))
      .filter((p) => !s.scheme || p.relationships.some((r) => r.scheme.id === s.scheme))
      .filter((p) => {
        if (!q) return true;
        const hay = `${p.person.displayName} ${p.person.email} ${p.person.phone.replace(/\s/g, '')} ${roleChips(p).map((c) => c.label).join(' ')}`.toLowerCase();
        return q.split(/\s+/).every((t) => hay.includes(t.replace(/\s/g, '')));
      });
  });

  protected readonly rows = computed(() => this.filtered().slice(0, this.limit()));

  protected readonly tabs = computed(() => {
    const all = this.all();
    return [
      { id: 'all', label: 'Everyone', count: all.length },
      { id: 'owner', label: 'Owners', count: all.filter((p) => hasRole(p, 'owner')).length },
      { id: 'tenant', label: 'Tenants', count: all.filter((p) => hasRole(p, 'tenant')).length },
      { id: 'trustee', label: 'Trustees', count: all.filter((p) => hasRole(p, 'trustee')).length },
    ];
  });

  protected readonly filters = computed<FilterDef[]>(() =>
    this.fixedScheme() || this.scope.scopeId()
      ? []
      : [{ key: 'scheme', label: 'Scheme', options: this.scope.accessible().map((s) => ({ value: s.id, label: s.name })) }],
  );

  protected readonly columns: ColumnDef<PersonSummary>[] = [
    { key: 'name', header: 'Name', mobile: 'title', sort: (p) => p.person.lastName },
    { key: 'roles', header: 'Roles', sort: (p) => p.relationships.length },
    { key: 'contact', header: 'Contact', width: '26%', mobile: 'meta' },
    { key: 'balance', header: 'Balance', align: 'end', width: '130px', sort: (p) => p.balance },
  ];

  protected readonly rowId = (p: PersonSummary) => p.person.id;
  protected readonly hasOwner = (r: RelationshipView) => r.relationship.type === 'owner';

  protected chips(p: PersonSummary): RoleChip[] {
    return roleChips(p);
  }

  protected patch(change: Partial<Record<'role' | 'q' | 'scheme', string | null>>): void {
    this.state.update((s) => ({ ...s, ...change }));
    this.limit.set(PAGE);
  }

  protected open(p: PersonSummary): void {
    this.activeId.set(p.person.id);
    this.drawer.open(PersonPreview, { personId: p.person.id }, p.person.displayName).closed.subscribe(() => {
      if (this.activeId() === p.person.id) this.activeId.set(null);
    });
  }
}
