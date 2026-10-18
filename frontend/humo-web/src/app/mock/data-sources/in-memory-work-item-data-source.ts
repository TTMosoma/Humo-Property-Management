import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { AGENCY_WORK, LARGE_APPROVAL_AMOUNT, PolicyError, WORK_TYPE_LABELS, WorkItem, WorkItemDataSource, agencyConflict } from '../../domain';
import { MockDb } from '../db/mock-db';
import { MockAuthSession } from '../server/mock-auth-session';
import { CommandSpec, MockGateway } from '../server/mock-gateway';

const NOUN: Partial<Record<WorkItem['type'], string>> = {
  'quote-approval': 'quote',
  'invoice-approval': 'supplier invoice',
  'payment-batch-approval': 'payment batch',
  'billing-run-approval': 'billing run',
};

/** In-memory Attention store, backed by MockDb so other commands (e.g. allocations) can update work. */
@Injectable()
export class InMemoryWorkItemDataSource extends WorkItemDataSource {
  private readonly db = inject(MockDb);
  private readonly gateway = inject(MockGateway);
  private readonly auth = inject(MockAuthSession);

  watch(): Observable<WorkItem[]> {
    return this.db.changes$.pipe(map(() => this.db.workItems));
  }

  complete(ids: string[], by: string): Observable<void> {
    return this.mutate(ids, this.spec(ids, 'Completed'), (w) => ({ ...w, status: 'done', decidedBy: by, decidedAt: new Date().toISOString() }));
  }

  reopen(ids: string[]): Observable<void> {
    return this.mutate(ids, this.spec(ids, 'Reopened'), (w) => ({ ...w, status: 'open', decidedBy: undefined, decidedAt: undefined, comment: undefined }));
  }

  assign(ids: string[], assigneeId: string | null): Observable<void> {
    return this.mutate(ids, this.spec(ids, 'Assigned'), (w) => ({ ...w, assigneeId }));
  }

  decide(id: string, decision: 'approved' | 'rejected', by: string, comment?: string): Observable<void> {
    const w = this.db.workItems.find((x) => x.id === id);
    const spec: CommandSpec = {
      ...this.spec([id], decision === 'approved' ? 'Approved' : 'Rejected'),
      permission: 'Approvals.Decide',
      // Approving a large amount needs a fresh step-up proof; rejecting never does.
      stepUp: decision === 'approved' && (w?.amount ?? 0) >= LARGE_APPROVAL_AMOUNT,
    };
    // D6: a trustee who works for the managing agency can't approve its work. Refused and audited; another trustee decides.
    if (decision === 'approved' && w && AGENCY_WORK.includes(w.type) && agencyConflict(this.auth.current.identity, this.auth.assignment())) {
      return this.gateway.command(spec, () => {
        throw new PolicyError('conflict-of-interest', 'Trustee works for the managing agency; can’t approve its work (D6)');
      });
    }
    return this.mutate([id], spec, (w) => ({ ...w, status: decision, decidedBy: by, decidedAt: new Date().toISOString(), comment }));
  }

  /** Applies a change only after the simulated request succeeds (so error mode leaves data untouched). */
  private mutate(ids: string[], spec: CommandSpec, change: (w: WorkItem) => WorkItem): Observable<void> {
    return this.gateway.command(spec, () => this.db.updateWork(ids, change)).pipe(map(() => undefined));
  }

  /** Audit description, e.g. "Approved quote" for MR-1042. */
  private spec(ids: string[], verb: string): CommandSpec {
    const items = this.db.workItems.filter((w) => ids.includes(w.id));
    const one = items.length === 1 ? items[0] : undefined;
    return {
      action: one ? `${verb} ${NOUN[one.type] ?? WORK_TYPE_LABELS[one.type].toLowerCase()}` : `${verb} ${items.length} tasks`,
      resource: one ? WORK_TYPE_LABELS[one.type] : 'Tasks',
      resourceId: one?.ref ?? items.map((w) => w.ref).join(', '),
      amount: one?.amount,
      schemeId: one?.schemeId,
      permission: 'Work.Manage',
    };
  }
}
