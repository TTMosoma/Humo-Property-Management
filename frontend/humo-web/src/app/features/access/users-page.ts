import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, map, of, switchMap } from 'rxjs';
import { AccessDataSource, Identity, ROLE_LABELS, RoleFamily } from '../../domain';
import { pageState } from '../../core/prototype/page-state';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { AccessDrawer } from './access-drawer';
import { FAMILY_LABELS, familyOf, roleColor } from './access-view';

/**
 * Settings › Users & access. Every person with access to the agency on Humo,
 * one row per identity (never per role), with the roles they hold and where.
 */
@Component({
  selector: 'app-users-page',
  imports: [PageHeader, ViewTabs, DataTable, CellDef, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users-page.html',
  styleUrl: './users-page.scss',
})
export class UsersPage {
  private readonly access = inject(AccessDataSource);
  private readonly drawer = inject(DrawerService);
  protected readonly session = inject(SessionService);
  protected readonly page = pageState();

  protected readonly state = urlState({ view: 'agency', q: null });
  private readonly agencyId = computed(() => this.session.agency()?.id ?? '');

  private readonly result = toSignal(
    toObservable(this.agencyId).pipe(
      switchMap((id) =>
        this.access.directory(id).pipe(
          map((people) => ({ people, failed: false })),
          catchError(() => of({ people: [] as Identity[], failed: true })),
        ),
      ),
    ),
  );

  protected readonly loading = computed(() => this.page.status() === 'loading' || this.result() === undefined);
  protected readonly failed = computed(() => this.page.status() === 'error' || !!this.result()?.failed);
  private readonly people = computed(() => (this.page.forceEmpty() ? [] : (this.result()?.people ?? [])));

  protected readonly tabs = computed(() => {
    const all = this.people();
    const n = (f: RoleFamily) => all.filter((p) => familyOf(p, this.agencyId()) === f).length;
    return (['agency', 'governance', 'resident', 'supplier'] as RoleFamily[]).map((f) => ({ id: f, label: FAMILY_LABELS[f], count: n(f) }));
  });

  protected readonly rows = computed(() => {
    const { view, q } = this.state();
    const needle = (q ?? '').trim().toLowerCase();
    return this.people()
      .filter((p) => familyOf(p, this.agencyId()) === view)
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly columns: ColumnDef<Identity>[] = [
    { key: 'person', header: 'Person', mobile: 'title', width: '32%', sort: (r) => r.name },
    { key: 'roles', header: 'Roles and where they apply' },
    { key: 'manage', header: '', align: 'end', width: '150px', mobile: 'hidden' },
  ];

  protected readonly rowId = (r: Identity) => r.id;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly roleColor = roleColor;

  protected assignments(i: Identity) {
    return i.memberships.filter((m) => m.agencyId === this.agencyId());
  }

  protected set(key: 'view' | 'q', value: string | null): void {
    this.state.update((s) => ({ ...s, [key]: value || null }));
  }

  protected open(i: Identity): void {
    this.drawer.open(AccessDrawer, { identityId: i.id }, `Access for ${i.name}`);
  }
}
