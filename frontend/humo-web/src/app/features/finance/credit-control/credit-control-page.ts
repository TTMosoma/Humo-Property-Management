import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { Ageing, AgeingBucket, COLLECTION_STAGE_LABELS, CollectionDataSource, CollectionStage, CollectionView } from '../../../domain';
import { loadable } from '../../../core/data/loadable';
import { ScopeNotice } from '../../../core/scope/scope-notice';
import { ScopeService } from '../../../core/scope/scope.service';
import { SessionService } from '../../../core/session/session.service';
import { AgeingBar } from '../../../ui/ageing/ageing-bar';
import { BulkBar } from '../../../ui/data-table/bulk-bar';
import { CellDef, ColumnDef, DataTable } from '../../../ui/data-table/data-table';
import { urlState } from '../../../ui/data-table/url-state';
import { ViewTabs } from '../../../ui/data-table/view-tabs';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { RandPipe, formatDate } from '../../../ui/format/money';
import { PageHeader } from '../../../ui/page-header/page-header';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { StatusPill } from '../../../ui/status-pill/status-pill';
import { remindForm } from './collection-forms';
import { COLLECTION_STAGE_TONE } from './collection-view';

const STAGE_TABS: CollectionStage[] = ['not-started', 'reminder', 'final-demand', 'letter-of-demand', 'handed-over', 'arrangement', 'disputed'];
const TAB_LABELS: Record<CollectionStage, string> = { ...COLLECTION_STAGE_LABELS, reminder: 'Reminder', 'final-demand': 'Final demand', 'letter-of-demand': 'Letter of demand', arrangement: 'Arrangement' };
const BUCKETS: AgeingBucket[] = ['d30', 'd60', 'd90', 'd120'];
const DAYS: Record<AgeingBucket, number> = { d30: 30, d60: 60, d90: 90, d120: 120 };

/**
 * Finance › Credit control. Job: chase arrears in a structured, fair way.
 * Every account in arrears sits at a stage of the collection pipeline with a
 * next action and a due date; ageing is a filter and a chart, not the page.
 */
@Component({
  selector: 'app-credit-control-page',
  imports: [PageHeader, ScopeNotice, AgeingBar, ViewTabs, DataTable, CellDef, BulkBar, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Finance" title="Credit control" subtitle="Every account in arrears, where it is in collection, and what’s next: reminder, final demand, letter of demand, attorney." />
    <app-scope-notice />

    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="3" />
      <ui-skeleton [count]="6" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load credit control" (retry)="result.retry()" /></div>
    } @else {
      <div class="top">
        <section class="surface panel ageing">
          <div class="panel-head">
            <h2 class="section-title">Arrears by age</h2>
            <span class="money total">{{ overdue() | rand }}</span>
          </div>
          <ui-ageing-bar [ageing]="ageing()" />
          <div class="chips" role="group" aria-label="Filter by age">
            <button type="button" class="chip" [class.on]="!state().age" (click)="setAge(null)">Any age</button>
            @for (b of buckets; track b) {
              <button type="button" class="chip" [class.on]="state().age === b" (click)="setAge(b)">{{ ageLabel(b) }}</button>
            }
          </div>
        </section>
        <section class="surface panel kpis">
          <div>
            <div class="label-caps">Accounts in arrears</div>
            <div class="big">{{ all().length }}</div>
          </div>
          <div>
            <div class="label-caps">Next action overdue</div>
            <div class="big" [class.danger]="late().length">{{ late().length }}</div>
          </div>
          <div>
            <div class="label-caps">On an arrangement</div>
            <div class="big">{{ count('arrangement') }}</div>
          </div>
        </section>
      </div>

      <ui-view-tabs label="Collection stages" [tabs]="tabs()" [active]="state().view ?? 'action'" (activeChange)="setView($event)" />

      @if (rows().length === 0) {
        <div class="surface">
          @if (all().length === 0) {
            <ui-empty-state illustration="empty-tray" title="No arrears" message="Every account in this scope is paid up." />
          } @else {
            <ui-empty-state title="Nothing here" message="No accounts at this stage{{ state().age ? ' and age' : '' }}." />
          }
        </div>
      } @else {
        <ui-data-table caption="Accounts in arrears" [rows]="rows()" [columns]="columns" [rowId]="rowId" [selectable]="canManage()" [(selected)]="selected" (rowClick)="open($event)">
          <ng-template uiCell="account" let-r>
            <div class="title">Unit {{ r.unit.number }} · {{ r.holder.displayName }}</div>
            <div class="muted">{{ r.account.accountNo }} · {{ r.scheme.name }}</div>
          </ng-template>
          <ng-template uiCell="overdue" let-r>
            <div class="money">{{ r.overdueAmount | rand }}</div>
            <div class="muted">{{ r.daysInArrears }}+ days</div>
          </ng-template>
          <ng-template uiCell="stage" let-r><ui-status-pill [label]="stageLabel(r)" [tone]="stageTone(r)" /></ng-template>
          <ng-template uiCell="next" let-r>
            @if (r.next; as n) {
              <div>{{ n.label }}</div>
              <div class="muted" [class.late]="n.overdue">{{ n.overdue ? 'Overdue since' : 'Due' }} {{ formatDate(n.dueAt, true) }}</div>
            }
          </ng-template>
          <ng-template uiCell="who" let-r><span class="muted">{{ r.assigneeName }}</span></ng-template>
        </ui-data-table>

        @if (selected().length) {
          <ui-bulk-bar [count]="selected().length" (clear)="selected.set([])">
            <button type="button" class="btn btn-secondary btn-sm" [disabled]="!remindable().length" (click)="remind()">
              <ion-icon name="mail-outline" aria-hidden="true" /> Send reminders@if (remindable().length !== selection().length) { ({{ remindable().length }} not started) }
            </button>
          </ui-bulk-bar>
        }
      }
    }
  `,
  styles: `
    :host { display: block; }
    .top { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--s-3); margin-bottom: var(--s-4); }
    .panel { padding: var(--s-4) var(--s-5); }
    .panel-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: var(--s-3); }
    .section-title { margin: 0; font-size: var(--fs-md); }
    .total { font-size: var(--fs-lg); font-weight: var(--fw-semibold); }
    .chips { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-top: var(--s-3); }
    .chip { padding: 4px 12px; font: inherit; font-size: var(--fs-xs); color: var(--c-text-2); background: var(--c-surface-sunken); border: 1px solid transparent; border-radius: var(--r-pill); cursor: pointer; }
    .chip.on { color: var(--c-primary); background: var(--c-primary-soft); border-color: var(--c-primary); }
    .kpis { display: flex; flex-direction: column; justify-content: space-between; gap: var(--s-3); }
    .big { font-size: var(--fs-xl); font-weight: var(--fw-semibold); }
    .big.danger, .late { color: var(--c-danger); }
    .title { font-weight: var(--fw-medium); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .muted.late { color: var(--c-danger); }
    @media (max-width: 900px) { .top { grid-template-columns: 1fr; } .kpis { flex-direction: row; flex-wrap: wrap; } }
  `,
})
export class CreditControlPage {
  private readonly router = inject(Router);
  private readonly data = inject(CollectionDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly scope = inject(ScopeService);
  private readonly session = inject(SessionService);

  protected readonly state = urlState({ view: 'action', age: null });
  protected readonly selected = signal<string[]>([]);

  protected readonly result = loadable(() => this.data.list(this.scope.effectiveIds()).pipe(map((p) => p.items)));
  protected readonly all = computed(() => this.result.value() ?? []);

  /** The age filter applies to everything below the chart. */
  private readonly aged = computed(() => {
    const age = this.state().age as AgeingBucket | undefined;
    return age ? this.all().filter((r) => r.daysInArrears >= DAYS[age]) : this.all();
  });

  protected readonly ageing = computed<Ageing>(() =>
    this.all().reduce<Ageing>(
      (s, r) => ({ current: 0, d30: s.d30 + r.account.ageing.d30, d60: s.d60 + r.account.ageing.d60, d90: s.d90 + r.account.ageing.d90, d120: s.d120 + r.account.ageing.d120 }),
      { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
    ),
  );
  protected readonly overdue = computed(() => this.all().reduce((s, r) => s + r.overdueAmount, 0));
  protected readonly late = computed(() => this.all().filter((r) => r.next?.overdue));

  protected readonly tabs = computed(() => {
    const rows = this.aged();
    return [
      { id: 'action', label: 'Needs action', count: rows.filter((r) => r.next?.overdue).length },
      ...STAGE_TABS.map((s) => ({ id: s, label: TAB_LABELS[s], count: rows.filter((r) => r.case.stage === s).length })),
      { id: 'all', label: 'All' },
    ];
  });

  protected readonly rows = computed(() => {
    const v = this.state().view ?? 'action';
    const rows = this.aged();
    const out = v === 'all' ? rows : v === 'action' ? rows.filter((r) => r.next?.overdue) : rows.filter((r) => r.case.stage === v);
    return [...out].sort((a, b) => (a.next?.dueAt ?? '').localeCompare(b.next?.dueAt ?? '') || b.overdueAmount - a.overdueAmount);
  });

  protected readonly selection = computed(() => this.all().filter((r) => this.selected().includes(r.account.id)));
  protected readonly remindable = computed(() => this.selection().filter((r) => r.case.stage === 'not-started'));

  protected readonly columns: ColumnDef<CollectionView>[] = [
    { key: 'account', header: 'Account', mobile: 'title', sort: (r) => r.unit.number.padStart(6, '0') },
    { key: 'overdue', header: 'Overdue', align: 'end', width: '130px', sort: (r) => r.overdueAmount },
    { key: 'stage', header: 'Stage', width: '190px', sort: (r) => r.case.stage },
    { key: 'next', header: 'Next action', width: '28%', mobile: 'field', sort: (r) => r.next?.dueAt ?? '' },
    { key: 'who', header: 'With', width: '140px', mobile: 'meta', sort: (r) => r.assigneeName },
  ];

  protected readonly buckets = BUCKETS;
  protected readonly ageLabel = (b: AgeingBucket) => `${DAYS[b]}+ days`;
  protected readonly rowId = (r: CollectionView) => r.account.id;
  protected readonly stageTone = (r: CollectionView) => COLLECTION_STAGE_TONE[r.case.stage];
  protected readonly stageLabel = (r: CollectionView) => COLLECTION_STAGE_LABELS[r.case.stage];
  protected readonly count = (s: CollectionStage) => this.all().filter((r) => r.case.stage === s).length;
  protected readonly formatDate = formatDate;
  protected readonly canManage = computed(() => this.session.can('Collections.Manage') && this.session.hasFeature('credit-control') && !this.session.readOnly());

  protected setView(view: string): void {
    this.state.update((s) => ({ ...s, view }));
    this.selected.set([]);
  }

  protected setAge(age: AgeingBucket | null): void {
    this.state.update((s) => ({ ...s, age }));
    this.selected.set([]);
  }

  protected open(r: CollectionView): void {
    void this.router.navigate(['/finance/credit-control', r.account.id]);
  }

  protected remind(): void {
    remindForm(this.drawer, this.data, this.remindable(), () => this.selected.set([]));
  }
}
