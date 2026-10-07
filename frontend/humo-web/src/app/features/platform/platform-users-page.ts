import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Dialog } from '@angular/cdk/dialog';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, combineLatest, map, of } from 'rxjs';
import { AccessDataSource, AuditDataSource, AuditEvent, IMPERSONATION_REASONS, Identity, ROLE_LABELS, RoleAssignment } from '../../domain';
import { pageState } from '../../core/prototype/page-state';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { relativeTime } from '../../ui/format/relative-time';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { roleColor } from '../access/access-view';
import { ImpersonateDialog } from './impersonate-dialog';

/**
 * Platform › Users & impersonation. Humo staff find a customer user to help them.
 * "View as…" appears only for identities individually granted System.Impersonate.
 */
@Component({
  selector: 'app-platform-users-page',
  imports: [PageHeader, ViewTabs, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-users-page.html',
  styleUrl: './platform-users-page.scss',
})
export class PlatformUsersPage {
  private readonly access = inject(AccessDataSource);
  private readonly dialog = inject(Dialog);
  protected readonly session = inject(SessionService);
  protected readonly page = pageState();
  protected readonly state = urlState({ view: 'customers', q: null });

  private readonly result = toSignal(
    combineLatest([this.access.directory(null), this.access.humoTeam()]).pipe(
      map(([customers, team]) => ({ customers, team, failed: false })),
      catchError(() => of({ customers: [] as Identity[], team: [] as Identity[], failed: true })),
    ),
  );
  protected readonly recent = toSignal(
    inject(AuditDataSource)
      .query({ agencyId: null, category: 'impersonation' })
      .pipe(
        map((all) => all.filter((e) => e.action.startsWith('Started')).slice(0, 5)),
        catchError(() => of([] as AuditEvent[])),
      ),
    { initialValue: [] as AuditEvent[] },
  );

  protected readonly loading = computed(() => this.page.status() === 'loading' || this.result() === undefined);
  protected readonly failed = computed(() => this.page.status() === 'error' || !!this.result()?.failed);
  protected readonly canImpersonate = computed(() => this.session.actorCan('System.Impersonate'));

  protected readonly tabs = computed(() => [
    { id: 'customers', label: 'Customer users', count: this.result()?.customers.length },
    { id: 'team', label: 'Humo team', count: this.result()?.team.length },
  ]);

  protected readonly rows = computed(() => {
    const { view, q } = this.state();
    const all = this.page.forceEmpty() ? [] : view === 'team' ? (this.result()?.team ?? []) : (this.result()?.customers ?? []);
    const needle = (q ?? '').trim().toLowerCase();
    return all
      .filter((p) => !needle || [p.name, p.email, ...p.memberships.map((m) => this.agencyName(m.agencyId))].some((x) => x.toLowerCase().includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly columns = computed<ColumnDef<Identity>[]>(() => [
    { key: 'person', header: 'Person', mobile: 'title', width: '30%', sort: (r) => r.name },
    ...(this.state().view === 'team' ? [] : [{ key: 'org', header: 'Organisation', width: '20%', sort: (r: Identity) => this.agencyName(r.memberships[0]?.agencyId ?? null) }]),
    { key: 'roles', header: 'Roles' },
    { key: 'action', header: '', align: 'end', width: '150px' },
  ]);

  protected readonly rowId = (r: Identity) => r.id;
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly reasons = IMPERSONATION_REASONS;
  protected readonly roleColor = roleColor;
  protected readonly relativeTime = relativeTime;

  protected roleLabel(m: RoleAssignment): string {
    return ROLE_LABELS[m.role];
  }

  protected agencyName(id: string | null): string {
    return id === null ? 'Humo' : (this.session.agencies.find((a) => a.id === id)?.shortName ?? id);
  }

  protected authorised(i: Identity): boolean {
    return i.memberships.some((m) => m.grants?.includes('System.Impersonate'));
  }

  protected set(key: 'view' | 'q', value: string | null): void {
    this.state.update((s) => ({ ...s, [key]: value || null }));
  }

  protected impersonate(target: Identity): void {
    if (!this.canImpersonate()) return;
    this.dialog.open(ImpersonateDialog, {
      data: target,
      ariaLabel: `Impersonate ${target.name}`,
      backdropClass: 'cdk-overlay-dark-backdrop',
      autoFocus: 'first-tabbable',
    });
  }
}
