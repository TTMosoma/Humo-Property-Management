import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BoardDataSource, BoardSummary } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';

/** Governance › Trustee boards: every scheme's board at a glance, short boards first. */
@Component({
  selector: 'app-trustees-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Governance" title="Trustee boards" subtitle="Who serves on each scheme’s board. The board sets quorum at trustee meetings and who approves in Humo Property Management." />
    <app-scope-notice />

    <ui-view-tabs label="Board views" [tabs]="tabs()" [active]="state().view ?? 'all'" (activeChange)="state.update((s) => ({ ...s, view: $event }))" />

    @if (result.loading()) {
      <ui-skeleton [count]="8" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load the boards" (retry)="result.retry()" /></div>
    } @else if (!rows().length) {
      <div class="surface"><ui-empty-state title="Nothing here" message="Every board in this view has enough trustees." /></div>
    } @else {
      <ui-data-table caption="Trustee boards" [rows]="rows()" [columns]="columns" [rowId]="rowId" (rowClick)="open($event)">
        <ng-template uiCell="scheme" let-b>
          <div class="title">{{ b.scheme.name }}</div>
          <div class="muted">{{ b.scheme.code }} · {{ b.scheme.unitCount }} units</div>
        </ng-template>
        <ng-template uiCell="size" let-b>
          <ui-status-pill [label]="b.size + ' of at least ' + b.minimum" [tone]="b.size < b.minimum ? 'danger' : 'success'" />
        </ng-template>
        <ng-template uiCell="chair" let-b>{{ b.chairperson ?? 'No chairperson' }}</ng-template>
        <ng-template uiCell="notes" let-b>
          @if (b.coOpted) {
            <div class="muted">{{ b.coOpted }} co-opted until the AGM</div>
          }
          @if (!b.coOpted) {
            <span class="muted">—</span>
          }
        </ng-template>
      </ui-data-table>
    }
  `,
  styles: `
    :host { display: block; }
    .title { font-weight: var(--fw-medium); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
  `,
})
export class TrusteesPage {
  private readonly router = inject(Router);
  private readonly data = inject(BoardDataSource);
  private readonly scope = inject(ScopeService);

  protected readonly state = urlState({ view: 'all' });
  protected readonly result = loadable(() => this.data.list(this.scope.effectiveIds()));
  private readonly all = computed(() => this.result.value() ?? []);
  protected readonly tabs = computed(() => [
    { id: 'all', label: 'All', count: this.all().length },
    { id: 'short', label: 'Below minimum', count: this.all().filter((b) => b.size < b.minimum).length },
    { id: 'co-opted', label: 'Co-opted trustees', count: this.all().filter((b) => b.coOpted).length },
  ]);
  protected readonly rows = computed(() => {
    const v = this.state().view ?? 'all';
    return this.all()
      .filter((b) => (v === 'short' ? b.size < b.minimum : v === 'co-opted' ? b.coOpted > 0 : true))
      .sort((a, b) => Number(b.size < b.minimum) - Number(a.size < a.minimum) || a.scheme.name.localeCompare(b.scheme.name));
  });

  protected readonly columns: ColumnDef<BoardSummary>[] = [
    { key: 'scheme', header: 'Scheme', mobile: 'title', sort: (b) => b.scheme.name },
    { key: 'size', header: 'Trustees', width: '190px', sort: (b) => b.size - b.minimum },
    { key: 'chair', header: 'Chairperson', width: '24%', sort: (b) => b.chairperson ?? '' },
    { key: 'notes', header: 'Notes', width: '24%', mobile: 'field' },
  ];
  protected readonly rowId = (b: BoardSummary) => b.scheme.id;

  protected open(b: BoardSummary): void {
    void this.router.navigate(['/governance/trustees', b.scheme.id]);
  }
}
