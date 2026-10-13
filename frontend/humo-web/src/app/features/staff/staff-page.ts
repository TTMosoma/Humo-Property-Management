import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ROLE_LABELS, StaffDataSource, StaffSummary, todaySA } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';

/** Portfolio › Staff: who manages what, and how much each person is carrying. */
@Component({
  selector: 'app-staff-page',
  imports: [PageHeader, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Portfolio" title="Staff" subtitle="Who manages which schemes, and each person’s open work. Roles and scheme assignments are set in Users & access." />

    @if (result.loading()) {
      <ui-skeleton [count]="8" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load the team" (retry)="result.retry()" /></div>
    } @else if (!rows().length) {
      <div class="surface"><ui-empty-state title="No staff yet" message="Add people in Users & access." /></div>
    } @else {
      <ui-data-table caption="Staff" [rows]="rows()" [columns]="columns" [rowId]="rowId" (rowClick)="open($event)">
        <ng-template uiCell="person" let-s>
          <div class="person">
            <span class="avatar" aria-hidden="true">{{ s.initials }}</span>
            <div>
              <div class="title">{{ s.name }}</div>
              <div class="muted">{{ s.title ?? roles(s) }}</div>
            </div>
          </div>
        </ng-template>
        <ng-template uiCell="schemes" let-s>
          @if (s.allSchemes) {
            <span>All schemes</span>
          } @else {
            <div>{{ s.schemes.length }} scheme{{ s.schemes.length === 1 ? '' : 's' }}</div>
            <div class="muted">{{ schemeNames(s) }}</div>
          }
        </ng-template>
        <ng-template uiCell="work" let-s>
          <div>{{ s.openTasks }} Task{{ s.openTasks === 1 ? '' : 's' }}@if (s.openMessages) { · {{ s.openMessages }} message{{ s.openMessages === 1 ? '' : 's' }} }</div>
          @if (s.overdueTasks) { <div class="danger">{{ s.overdueTasks }} overdue</div> }
        </ng-template>
        <ng-template uiCell="approvals" let-s>{{ s.approvalsWaiting || '—' }}</ng-template>
        <ng-template uiCell="status" let-s>
          @if (s.away; as a) {
            <ui-status-pill [label]="awayLabel(s)" [tone]="'warning'" />
            <div class="muted">{{ a.coverName }} covering</div>
          } @else if (s.covering.length) {
            <div class="muted">Covering {{ s.covering.join(', ') }}</div>
          } @else {
            <ui-status-pill label="In" tone="success" />
          }
        </ng-template>
      </ui-data-table>
    }
  `,
  styles: `
    :host { display: block; }
    .person { display: flex; gap: var(--s-2); align-items: center; }
    .avatar { display: grid; flex: none; place-items: center; width: 32px; height: 32px; font-size: var(--fs-xs); font-weight: var(--fw-semibold); color: var(--c-primary-text); background: var(--c-primary-soft); border-radius: 50%; }
    .title { font-weight: var(--fw-medium); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .danger { font-size: var(--fs-xs); color: var(--c-danger); }
  `,
})
export class StaffPage {
  private readonly router = inject(Router);
  private readonly data = inject(StaffDataSource);

  protected readonly result = loadable(() => this.data.list());
  protected readonly rows = computed(() => this.result.value() ?? []);
  protected readonly columns: ColumnDef<StaffSummary>[] = [
    { key: 'person', header: 'Person', mobile: 'title', sort: (s) => s.name },
    { key: 'schemes', header: 'Schemes', width: '28%', sort: (s) => (s.allSchemes ? 999 : s.schemes.length) },
    { key: 'work', header: 'Open work', width: '170px', sort: (s) => s.overdueTasks * 1000 + s.openTasks },
    { key: 'approvals', header: 'Approvals they can decide', width: '130px', align: 'end', sort: (s) => s.approvalsWaiting },
    { key: 'status', header: 'Today', width: '170px', mobile: 'meta' },
  ];
  protected readonly rowId = (s: StaffSummary) => s.id;
  protected readonly roles = (s: StaffSummary) => s.roles.map((r) => ROLE_LABELS[r]).join(', ');
  protected readonly schemeNames = (s: StaffSummary) => s.schemes.slice(0, 3).map((x) => x.name).join(', ') + (s.schemes.length > 3 ? ` +${s.schemes.length - 3}` : '');
  protected readonly awayLabel = (s: StaffSummary) => (s.away!.from > todaySA() ? `Away from ${formatDate(s.away!.from, true)}` : `Away until ${formatDate(s.away!.to, true)}`);

  protected open(s: StaffSummary): void {
    void this.router.navigate(['/staff', s.id]);
  }
}
