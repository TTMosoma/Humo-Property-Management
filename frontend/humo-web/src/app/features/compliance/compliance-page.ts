import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { COMPLIANCE_TYPES, COMPLIANCE_TYPE, ComplianceDataSource, ComplianceItem, ComplianceStatus, ComplianceType, Scheme } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { addManualForm } from './compliance-forms';
import { STATUS_RANK, STATUS_TONE, statusLabel, whenLabel } from './compliance-view';
import { DesktopHint } from '../../ui/states/desktop-hint';

interface MatrixRow {
  scheme: Scheme;
  cells: Record<ComplianceType, ComplianceItem | undefined>;
  other: ComplianceItem[];
  worst: ComplianceStatus;
}

/**
 * Compliance (review finding F22): a matrix of schemes × obligations, worked
 * out from the records Humo already keeps. Each cell drills into its item,
 * which links to the source record. Also a scheme's Compliance tab.
 */
@Component({
  selector: 'app-compliance-page',
  imports: [DesktopHint, PageHeader, ScopeNotice, ViewTabs, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!fixedScheme()) {
      <ui-page-header eyebrow="Records" title="Compliance" subtitle="What’s due, overdue or complete across your schemes, worked out from meetings, documents, suppliers and each scheme’s financial year.">
        @if (canManage()) {
          <button type="button" class="btn btn-secondary" (click)="add()"><ion-icon name="add-outline" aria-hidden="true" /> Add item</button>
        }
      </ui-page-header>
      <app-scope-notice />
    } @else if (canManage()) {
      <div class="tab-actions">
        <button type="button" class="btn btn-secondary btn-sm" (click)="add()"><ion-icon name="add-outline" aria-hidden="true" /> Add item</button>
      </div>
    }

    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="4" />
      <ui-skeleton [count]="8" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load compliance" (retry)="result.retry()" /></div>
    } @else {
      <div class="summary">
        @for (s of summary(); track s.status) {
          <button type="button" class="sum surface" [class]="'sum ' + s.status" (click)="go(s.view)">
            <span class="n">{{ s.count }}</span>
            <span class="l">{{ s.label }}</span>
          </button>
        }
      </div>

      <ui-view-tabs label="Compliance views" [tabs]="tabs()" [active]="view()" (activeChange)="state.update((s) => ({ ...s, view: $event }))" />

      @if (view() === 'matrix') {
        <ui-desktop-hint what="The compliance matrix" />
        <div class="surface matrix-wrap">
          <table class="matrix">
            <caption class="visually-hidden">Compliance by scheme and obligation</caption>
            <thead>
              <tr>
                <th scope="col" class="scheme-col">Scheme</th>
                @for (t of types; track t.id) {
                  <th scope="col" [title]="t.label + ': ' + t.description">{{ t.short }}</th>
                }
                <th scope="col">Other</th>
              </tr>
            </thead>
            <tbody>
              @for (r of matrix(); track r.scheme.id) {
                <tr>
                  <th scope="row" class="scheme-col"><a [routerLink]="['/schemes', r.scheme.id, 'compliance']">{{ r.scheme.name }}</a></th>
                  @for (t of types; track t.id) {
                    @let c = r.cells[t.id];
                    <td>
                      @if (c) {
                        <a class="cell" [class]="'cell ' + c.status" [routerLink]="['/compliance', c.id]" [attr.aria-label]="t.label + ', ' + r.scheme.name + ': ' + label(c.status) + ' ' + when(c)">
                          <span class="dot" aria-hidden="true"></span>
                          <span class="c-label">{{ label(c.status) }}</span>
                          <span class="c-when">{{ when(c) }}</span>
                        </a>
                      }
                    </td>
                  }
                  <td>
                    @if (r.other.length) {
                      @let o = r.other[0];
                      <a class="cell" [class]="'cell ' + o.status" [routerLink]="['/compliance', o.id]" [title]="o.title">
                        <span class="dot" aria-hidden="true"></span>
                        <span class="c-label">{{ r.other.length }} item{{ r.other.length === 1 ? '' : 's' }}</span>
                        <span class="c-when">{{ o.title }}</span>
                      </a>
                    } @else {
                      <span class="none">—</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <p class="note">Humo tracks deadlines from your records; it doesn’t give legal advice. Rules such as the 4-month AGM deadline are prototype defaults until they’re set per scheme.</p>
      } @else if (rows().length === 0) {
        <div class="surface"><ui-empty-state title="Nothing here" [message]="view() === 'due' ? 'Nothing is due in the next 30 days or overdue.' : 'No items in this view.'" /></div>
      } @else {
        <ui-data-table caption="Compliance items" [rows]="rows()" [columns]="columns()" [rowId]="rowId" (rowClick)="open($event)">
          <ng-template uiCell="item" let-i>
            <div class="title">{{ i.title }}</div>
            <div class="muted">{{ i.ref }} · {{ typeLabel(i) }}</div>
          </ng-template>
          <ng-template uiCell="scheme" let-i>{{ schemeName(i) }}</ng-template>
          <ng-template uiCell="status" let-i>
            <ui-status-pill [label]="label(i.status)" [tone]="tone(i)" />
            <div class="muted">{{ when(i) }}</div>
          </ng-template>
          <ng-template uiCell="due" let-i>{{ i.dueAt ? formatDate(i.dueAt) : '—' }}</ng-template>
          <ng-template uiCell="detail" let-i><span class="detail">{{ i.detail }}</span></ng-template>
        </ui-data-table>
      }
    }
  `,
  styles: `
    :host { display: block; }
    .tab-actions { display: flex; justify-content: flex-end; margin-bottom: var(--s-3); }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--s-3); margin-bottom: var(--s-4); }
    .sum { display: flex; flex-direction: column; align-items: flex-start; padding: var(--s-3) var(--s-4); font: inherit; text-align: left; border: 1px solid var(--c-border); cursor: pointer; }
    .sum .n { font-size: var(--fs-xl); font-weight: var(--fw-semibold); }
    .sum .l { font-size: var(--fs-sm); color: var(--c-text-2); }
    .sum.overdue .n { color: var(--c-danger); }
    .sum.due-soon .n { color: var(--c-warning); }
    .sum.complete .n { color: var(--c-success); }
    .matrix-wrap { overflow-x: auto; }
    .matrix { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .matrix th, .matrix td { padding: 6px; border-bottom: 1px solid var(--c-border); text-align: left; vertical-align: top; }
    .matrix thead th { position: sticky; top: 0; font-size: var(--fs-xs); font-weight: var(--fw-semibold); color: var(--c-text-muted); text-transform: uppercase; letter-spacing: 0.04em; background: var(--c-surface); white-space: nowrap; }
    .scheme-col { min-width: 170px; font-weight: var(--fw-medium); }
    .cell { display: grid; grid-template-columns: 10px 1fr; column-gap: 6px; min-width: 96px; padding: 6px 8px; color: var(--c-text); border-radius: var(--r); text-decoration: none; }
    .cell:hover { background: var(--c-surface-sunken); }
    .dot { grid-row: span 2; width: 10px; height: 10px; margin-top: 4px; border-radius: 50%; background: var(--c-text-faint); }
    .c-label { font-weight: var(--fw-medium); }
    .c-when { grid-column: 2; font-size: var(--fs-xs); color: var(--c-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
    .cell.complete .dot { background: var(--c-success); }
    .cell.upcoming .dot { background: var(--c-info); }
    .cell.due-soon { background: var(--c-warning-soft); }
    .cell.due-soon .dot { background: var(--c-warning); }
    .cell.overdue { background: var(--c-danger-soft); }
    .cell.overdue .dot { background: var(--c-danger); }
    .cell.not-applicable { color: var(--c-text-faint); }
    .cell.not-applicable .dot { background: transparent; border: 1px solid var(--c-border-strong, var(--c-border)); }
    .none { color: var(--c-text-faint); }
    .note { margin: var(--s-3) 0 0; font-size: var(--fs-xs); color: var(--c-text-muted); }
    .title { font-weight: var(--fw-medium); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .detail { font-size: var(--fs-sm); color: var(--c-text-2); }
    @media (max-width: 700px) { .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `,
})
export class CompliancePage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(ComplianceDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly scope = inject(ScopeService);
  private readonly session = inject(SessionService);

  protected readonly fixedScheme = toSignal(this.route.data.pipe(map((d) => d['scheme'] as Scheme | undefined)), {
    initialValue: this.route.snapshot.data['scheme'] as Scheme | undefined,
  });
  protected readonly state = urlState({ view: null, scheme: null });
  private readonly schemeIds = computed(() => (this.fixedScheme() ? [this.fixedScheme()!.id] : this.state().scheme ? [this.state().scheme!] : this.scope.effectiveIds()));

  protected readonly result = loadable(() => this.data.list(this.schemeIds()));
  private readonly items = computed(() => this.result.value() ?? []);

  /** One scheme: the list is clearer than a one-row matrix. */
  protected readonly view = computed(() => this.state().view ?? (this.fixedScheme() ? 'all' : 'matrix'));
  protected readonly types = COMPLIANCE_TYPES;

  protected readonly summary = computed(() => {
    const count = (s: ComplianceStatus) => this.items().filter((i) => i.status === s).length;
    return [
      { status: 'overdue', label: 'Overdue', count: count('overdue'), view: 'due' },
      { status: 'due-soon', label: 'Due within 30 days', count: count('due-soon'), view: 'due' },
      { status: 'upcoming', label: 'Upcoming', count: count('upcoming'), view: 'upcoming' },
      { status: 'complete', label: 'Complete', count: count('complete'), view: 'complete' },
    ];
  });

  protected readonly tabs = computed(() => {
    const items = this.items();
    const tabs = [
      { id: 'due', label: 'Due & overdue', count: items.filter((i) => i.status === 'overdue' || i.status === 'due-soon').length },
      { id: 'upcoming', label: 'Upcoming', count: items.filter((i) => i.status === 'upcoming').length },
      { id: 'complete', label: 'Complete' },
      { id: 'all', label: 'All' },
    ];
    return this.fixedScheme() ? tabs : [{ id: 'matrix', label: 'Matrix' }, ...tabs];
  });

  protected readonly matrix = computed<MatrixRow[]>(() => {
    const bySchemes = new Map<string, ComplianceItem[]>();
    for (const i of this.items()) bySchemes.set(i.schemeId, [...(bySchemes.get(i.schemeId) ?? []), i]);
    return this.scope
      .accessible()
      .filter((s) => bySchemes.has(s.id))
      .map((scheme) => {
        const items = bySchemes.get(scheme.id)!;
        const cells = Object.fromEntries(COMPLIANCE_TYPES.map((t) => [t.id, items.find((i) => i.type === t.id)])) as MatrixRow['cells'];
        const other = items.filter((i) => i.type === 'manual' && i.status !== 'complete').sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
        const worst = items.reduce<ComplianceStatus>((w, i) => (STATUS_RANK[i.status] < STATUS_RANK[w] ? i.status : w), 'complete');
        return { scheme, cells, other, worst };
      })
      .sort((a, b) => STATUS_RANK[a.worst] - STATUS_RANK[b.worst] || a.scheme.name.localeCompare(b.scheme.name));
  });

  protected readonly rows = computed(() => {
    const v = this.view();
    const items = this.items().filter((i) => i.status !== 'not-applicable' || v === 'all');
    const filtered =
      v === 'due' ? items.filter((i) => i.status === 'overdue' || i.status === 'due-soon') : v === 'upcoming' ? items.filter((i) => i.status === 'upcoming') : v === 'complete' ? items.filter((i) => i.status === 'complete') : items;
    return [...filtered].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
  });

  protected readonly columns = computed<ColumnDef<ComplianceItem>[]>(() => {
    const cols: ColumnDef<ComplianceItem>[] = [{ key: 'item', header: 'Item', mobile: 'title', sort: (i) => i.title }];
    if (!this.fixedScheme()) cols.push({ key: 'scheme', header: 'Scheme', width: '17%', mobile: 'meta', sort: (i) => this.schemeName(i) });
    cols.push(
      { key: 'status', header: 'Status', width: '140px', sort: (i) => STATUS_RANK[i.status] },
      { key: 'due', header: 'Due', width: '120px', sort: (i) => i.dueAt ?? '9999' },
      { key: 'detail', header: 'Where it stands', width: '36%', mobile: 'field' },
    );
    return cols;
  });

  protected readonly canManage = computed(() => this.session.can('Compliance.Manage') && this.session.hasFeature('compliance') && !this.session.readOnly());
  protected readonly label = statusLabel;
  protected readonly when = whenLabel;
  protected readonly tone = (i: ComplianceItem) => STATUS_TONE[i.status];
  protected readonly typeLabel = (i: ComplianceItem) => (i.type === 'manual' ? 'Added item' : COMPLIANCE_TYPE[i.type].label);
  protected readonly rowId = (i: ComplianceItem) => i.id;
  protected readonly formatDate = formatDate;

  protected schemeName(i: ComplianceItem): string {
    return this.scope.findScheme(i.schemeId)?.name ?? '';
  }

  protected go(view: string): void {
    this.state.update((s) => ({ ...s, view }));
  }

  protected open(i: ComplianceItem): void {
    void this.router.navigate(['/compliance', i.id]);
  }

  protected add(): void {
    const schemes = this.fixedScheme() ? [this.fixedScheme()!] : this.scope.accessible();
    addManualForm(this.drawer, this.data, schemes, this.fixedScheme()?.id ?? this.scope.scopeId() ?? undefined);
  }
}
