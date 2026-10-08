import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, catchError, of } from 'rxjs';
import { Role, WorkItem, WorkItemDataSource, WorkItemType, isOpen } from '../../domain';
import { ScopeService } from '../scope/scope.service';
import { loadable } from '../data/loadable';
import { SessionService } from '../session/session.service';

/** Badge keys used by the navigation config. */
export type AttentionKey =
  | 'tasks'
  | 'approvals'
  | 'inbox'
  | 'receipts'
  | 'credit-control'
  | 'payables'
  | 'jobs'
  | 'compliance';

const FINANCE_TYPES: WorkItemType[] = [
  'receipt-allocation',
  'debtor-follow-up',
  'invoice-approval',
  'payment-batch-approval',
  'billing-run-approval',
];
const OPERATIONS_TYPES: WorkItemType[] = ['maintenance-triage', 'maintenance-overdue', 'document-expiry'];
const NOT_FOR_PORTFOLIO_MANAGERS: WorkItemType[] = ['receipt-allocation', 'payment-batch-approval', 'billing-run-approval'];

/**
 * The Attention model, filtered for the current person.
 *
 * Every badge, queue and "needs attention" list in the app reads from here,
 * so the numbers are consistent and never leak another scheme's information.
 */
@Injectable({ providedIn: 'root' })
export class AttentionService {
  private readonly session = inject(SessionService);
  private readonly scope = inject(ScopeService);
  private readonly source = inject(WorkItemDataSource);

  /** Live: emits again whenever a work item changes (HTTP: re-fetched or pushed). */
  private readonly items = loadable(() => this.source.watch());
  private readonly all = computed(() => this.items.value() ?? []);
  /** For queues that show the work items themselves (Tasks, Approvals). */
  readonly status = this.items.status;
  readonly retry = () => this.items.retry();

  /** Everything this membership may see in any scheme it can access (ignores the scope chip). */
  private readonly entitled = computed<WorkItem[]>(() => {
    const m = this.session.assignment();
    const accessible = new Set(this.scope.accessible().map((s) => s.id));
    const me = new Set(this.session.selfIds());
    const mine = (w: WorkItem) => w.assigneeId !== null && me.has(w.assigneeId);

    return this.all().filter((w) => {
      if (!accessible.has(w.schemeId)) return false;
      switch (m.role) {
        case 'agency-admin':
          return true;
        case 'portfolio-manager':
          if (NOT_FOR_PORTFOLIO_MANAGERS.includes(w.type)) return false;
          return m.scope.schemeIds.includes(w.schemeId) || mine(w);
        case 'finance':
          return FINANCE_TYPES.includes(w.type) || mine(w);
        case 'operations':
          return OPERATIONS_TYPES.includes(w.type) || mine(w);
        case 'trustee':
          return (w.kind === 'approval' && !!w.approverRoles?.includes('trustee')) || mine(w);
        default:
          return false;
      }
    });
  });

  /** Everything this membership may see, in the current scope (open and closed). */
  readonly visible = computed<WorkItem[]>(() => {
    const ids = new Set(this.scope.effectiveIds());
    return this.entitled().filter((w) => ids.has(w.schemeId));
  });

  readonly open = computed(() => this.visible().filter(isOpen));

  /** Tasks for me, plus unassigned ones someone needs to pick up. */
  readonly myTasks = computed(() => {
    const me = new Set(this.session.selfIds());
    return this.open().filter((w) => w.kind === 'task' && (w.assigneeId === null || me.has(w.assigneeId)));
  });

  readonly pendingApprovals = computed(() => {
    const role = this.session.role();
    return this.open().filter((w) => w.kind === 'approval' && this.canDecide(w, role));
  });

  readonly inbox = computed(() => {
    const me = new Set(this.session.selfIds());
    return this.open().filter((w) => w.kind === 'message' && (w.assigneeId === null || me.has(w.assigneeId) || this.session.role() === 'agency-admin'));
  });

  readonly counts = computed<Record<AttentionKey, number>>(() => {
    const open = this.open();
    const sumOf = (types: WorkItemType[]) =>
      open.filter((w) => types.includes(w.type)).reduce((n, w) => n + (w.count ?? 1), 0);
    return {
      tasks: this.myTasks().length,
      approvals: this.pendingApprovals().length,
      inbox: this.inbox().length,
      receipts: sumOf(['receipt-allocation']),
      'credit-control': sumOf(['debtor-follow-up']),
      payables: sumOf(['invoice-approval', 'payment-batch-approval']),
      jobs: sumOf(['maintenance-overdue']),
      compliance: sumOf(['compliance-due', 'document-expiry']),
    };
  });

  /** Open items for one scheme, regardless of the current scope (scheme pages and previews). */
  openForScheme(schemeId: string): WorkItem[] {
    return this.entitled().filter((w) => w.schemeId === schemeId && isOpen(w));
  }

  canDecide(item: WorkItem, role: Role = this.session.role()): boolean {
    return item.kind === 'approval' && !!item.approverRoles?.includes(role);
  }

  // ---- Commands (delegated to the port) ----
  complete(ids: string[]): Observable<void> {
    return this.source.complete(ids, this.session.identity().name);
  }

  reopen(ids: string[]): Observable<void> {
    return this.source.reopen(ids);
  }

  assign(ids: string[], assigneeId: string | null): Observable<void> {
    return this.source.assign(ids, assigneeId);
  }

  decide(id: string, decision: 'approved' | 'rejected', comment?: string): Observable<void> {
    return this.source.decide(id, decision, this.session.identity().name, comment);
  }
}
