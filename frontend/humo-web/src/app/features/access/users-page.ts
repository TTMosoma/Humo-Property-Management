import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { AccessDataSource, IDENTITY_STATUS_LABELS, Identity, ROLE_LABELS, RoleFamily, UnitDataSource, heldAssignments } from '../../domain';
import { ScopeService } from '../../core/scope/scope.service';
import { inviteForm } from './user-forms';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { AccessDrawer } from './access-drawer';
import { FAMILY_LABELS, familyOf, roleColor } from './access-view';

/**
 * Settings › Users & access. Every person with access to the agency in Humo Property Management,
 * one row per identity (never per role), with the roles they hold and where.
 */
@Component({
  selector: 'app-users-page',
  imports: [PageHeader, ViewTabs, DataTable, CellDef, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, StatusPill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users-page.html',
  styleUrl: './users-page.scss',
})
export class UsersPage {
  private readonly access = inject(AccessDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly units = inject(UnitDataSource);
  private readonly scope = inject(ScopeService);
  protected readonly session = inject(SessionService);

  protected readonly state = urlState({ view: 'agency', q: null });
  private readonly organisationId = computed(() => this.session.organisation()?.id ?? '');

  protected readonly result = loadable(() => this.access.directory(this.organisationId()));

  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;
  private readonly people = computed(() => this.result.value() ?? []);

  protected readonly tabs = computed(() => {
    const all = this.people();
    const n = (f: RoleFamily) => all.filter((p) => familyOf(p, this.organisationId()) === f).length;
    return (['agency', 'governance', 'resident', 'supplier'] as RoleFamily[]).map((f) => ({ id: f, label: FAMILY_LABELS[f], count: n(f) }));
  });

  protected readonly rows = computed(() => {
    const { view, q } = this.state();
    const needle = (q ?? '').trim().toLowerCase();
    return this.people()
      .filter((p) => familyOf(p, this.organisationId()) === view)
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

  protected suspendedHere(i: Identity): boolean {
    return i.memberships.some((m) => m.organisationId === this.organisationId() && m.status === 'suspended');
  }

  protected statusLabel(i: Identity): string {
    return IDENTITY_STATUS_LABELS[i.status];
  }

  protected assignments(i: Identity) {
    return heldAssignments(i).filter((m) => m.scope.organisationId === this.organisationId());
  }

  protected set(key: 'view' | 'q', value: string | null): void {
    this.state.update((s) => ({ ...s, [key]: value || null }));
  }

  protected invite(): void {
    const org = this.session.organisation();
    if (org) inviteForm(this.drawer, this.access, this.units, org.id, org.shortName, this.scope.accessible());
  }

  protected open(i: Identity): void {
    this.drawer.open(AccessDrawer, { identityId: i.id }, `Access for ${i.name}`);
  }
}
