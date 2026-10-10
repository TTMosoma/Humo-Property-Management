import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { WorkItem, WorkItemType, isOpen, urgencyOf, sumRands } from '../../domain';
import { AttentionService } from '../../core/attention/attention.service';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { FilterBar, FilterDef } from '../../ui/data-table/filter-bar';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { RandPipe } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { ApprovalCard } from './approval-card';
import { URGENCY_ORDER } from './work-item-view';
import { WorkItemPreview } from './work-item-preview';

const TYPE_FILTER: { value: string; label: string; types: WorkItemType[] }[] = [
  { value: 'quotes', label: 'Quotes', types: ['quote-approval'] },
  { value: 'invoices', label: 'Supplier invoices', types: ['invoice-approval'] },
  { value: 'payments', label: 'Payment batches', types: ['payment-batch-approval'] },
  { value: 'billing', label: 'Billing runs', types: ['billing-run-approval'] },
];

/**
 * My work › Approvals: the single place where quotes, invoices, payment batches
 * and billing runs are decided (review finding F2). Module pages show approval
 * status and link here; they never host their own approve buttons.
 */
@Component({
  selector: 'app-approvals-page',
  imports: [PageHeader, ViewTabs, FilterBar, ApprovalCard, EmptyState, ErrorState, Skeleton, ScopeNotice, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="My work" title="Approvals" [subtitle]="subtitle()" />
    <app-scope-notice />

    <ui-view-tabs label="Approval views" [tabs]="tabs()" [active]="state().view ?? 'mine'" (activeChange)="patch({ view: $event })" />
    <ui-filter-bar
      searchLabel="Search approvals, suppliers, references…"
      [filters]="filters()"
      [values]="{ type: state().type, scheme: state().scheme }"
      (valuesChange)="patch({ type: $event['type'] ?? null, scheme: $event['scheme'] ?? null })"
      [search]="state().q ?? ''"
      (searchChange)="patch({ q: $event })"
    />

    @switch (attention.status()) {
      @case ('loading') {
        <ui-skeleton variant="tiles" [count]="3" />
      }
      @case ('error') {
        <div class="surface"><ui-error-state title="We couldn’t load approvals" (retry)="attention.retry()" /></div>
      }
      @default {
        @if (items().length === 0) {
          <div class="surface">
            @if (state().q || state().type || state().scheme) {
              <ui-empty-state kind="filtered" title="No approvals match these filters">
                <button type="button" class="btn btn-secondary" (click)="patch({ q: '', type: null, scheme: null })">Clear filters</button>
              </ui-empty-state>
            } @else if (state().view === 'decided') {
              <ui-empty-state kind="first-use" illustration="approvals" title="No decisions yet" message="Approvals you and others make appear here with who decided and why." />
            } @else {
              <ui-empty-state kind="done" illustration="approvals" title="Nothing waiting for your approval" message="When a quote, invoice, payment batch or billing run needs your decision, it appears here with the evidence to decide." />
            }
          </div>
        } @else {
          @if (state().view !== 'decided') {
            <p class="total">
              {{ items().length }} {{ items().length === 1 ? 'item' : 'items' }} ·
              <span class="money">{{ total() | rand }}</span> awaiting a decision
            </p>
          }
          <div class="list">
            @for (w of items(); track w.id) {
              <app-approval-card [item]="w" (details)="open($event)" />
            }
          </div>
        }
      }
    }
  `,
  styles: `
    :host { display: block; }
    .list { display: grid; gap: var(--s-4); max-width: 920px; }
    .total { margin-bottom: var(--s-3); font-size: var(--fs-sm); color: var(--c-text-muted); }
    .total .money { font-weight: var(--fw-semibold); color: var(--c-text); }
  `,
})
export class ApprovalsPage {
  protected readonly attention = inject(AttentionService);
  private readonly scope = inject(ScopeService);
  private readonly drawer = inject(DrawerService);
  protected readonly session = inject(SessionService);

  protected readonly state = urlState({ view: 'mine', q: '', type: null, scheme: null });

  private readonly approvals = computed(() => this.attention.visible().filter((w) => w.kind === 'approval'));

  private readonly byView = computed(() => {
    switch (this.state().view) {
      case 'all':
        return this.approvals().filter(isOpen);
      case 'decided':
        return this.approvals().filter((w) => !isOpen(w));
      default:
        return this.attention.pendingApprovals();
    }
  });

  protected readonly items = computed<WorkItem[]>(() => {
    const s = this.state();
    const types = TYPE_FILTER.find((t) => t.value === s.type)?.types;
    const q = (s.q ?? '').toLowerCase().trim();
    return this.byView()
      .filter((w) => !types || types.includes(w.type))
      .filter((w) => !s.scheme || w.schemeId === s.scheme)
      .filter((w) => !q || [w.title, w.ref, w.supplierName, w.detail, this.scope.findScheme(w.schemeId)?.name].join(' ').toLowerCase().includes(q))
      .sort((a, b) =>
        s.view === 'decided'
          ? (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '')
          : URGENCY_ORDER[urgencyOf(a)] - URGENCY_ORDER[urgencyOf(b)] || a.dueAt.localeCompare(b.dueAt),
      );
  });

  protected readonly total = computed(() => sumRands(this.items().map((w) => w.amount ?? 0)));

  protected readonly tabs = computed(() => [
    { id: 'mine', label: 'Waiting for me', count: this.attention.pendingApprovals().length },
    { id: 'all', label: 'All pending', count: this.approvals().filter(isOpen).length },
    { id: 'decided', label: 'Decided' },
  ]);

  protected readonly subtitle = computed(() =>
    this.session.role() === 'trustee'
      ? 'Quotes, invoices and payments that need the trustees’ decision — with the budget impact and evidence in front of you.'
      : 'Decide quotes, invoices, payment batches and billing runs with the evidence in front of you.',
  );

  protected readonly filters = computed<FilterDef[]>(() => {
    const defs: FilterDef[] = [{ key: 'type', label: 'Type', options: TYPE_FILTER.map(({ value, label }) => ({ value, label })) }];
    if (!this.scope.scopeId() && this.scope.accessible().length > 1) {
      const ids = new Set(this.approvals().map((w) => w.schemeId));
      defs.push({
        key: 'scheme',
        label: 'Scheme',
        options: this.scope.accessible().filter((s) => ids.has(s.id)).map((s) => ({ value: s.id, label: s.name })),
      });
    }
    return defs;
  });

  protected patch(change: Partial<Record<'view' | 'q' | 'type' | 'scheme', string | null>>): void {
    this.state.update((s) => ({ ...s, ...change }));
  }

  protected open(w: WorkItem): void {
    this.drawer.open(WorkItemPreview, { id: w.id }, w.title);
  }
}
