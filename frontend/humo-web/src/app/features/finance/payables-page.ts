import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { BatchView, InvoiceView, PayablesDataSource } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { StepUpService } from '../../core/security/step-up.service';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { BulkBar } from '../../ui/data-table/bulk-bar';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { RandPipe, formatDate, formatRand } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { ApprovalCard } from '../my-work/approval-card';

/**
 * Finance › Payables. Job: pay suppliers correctly — only approved, matched
 * invoices; in batches from each scheme's trust account; with a second
 * authoriser before money leaves.
 */
import { SmartNudge } from '../shared/smart-nudge';
@Component({
  selector: 'app-payables-page',
  imports: [SmartNudge, PageHeader, ScopeNotice, ViewTabs, DataTable, CellDef, BulkBar, StatusPill, ApprovalCard, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payables-page.html',
  styleUrl: './payables-page.scss',
})
export class PayablesPage {
  private readonly data = inject(PayablesDataSource);
  private readonly feedback = inject(FeedbackService);
  private readonly stepUp = inject(StepUpService);
  protected readonly scope = inject(ScopeService);
  protected readonly session = inject(SessionService);

  protected readonly state = urlState({ view: 'ready' });
  protected readonly selected = signal<string[]>([]);
  protected readonly busy = signal(false);

  protected readonly result = loadable(() => {
    const ids = this.scope.effectiveIds();
    return combineLatest([this.data.invoices(ids), this.data.batches(ids)]).pipe(map(([invoices, batches]) => ({ invoices, batches })));
  });

  protected readonly loading = this.result.loading;
  protected readonly failed = this.result.failed;
  private readonly invoices = computed(() => ((this.result.value()?.invoices ?? [])));
  protected readonly batches = computed(() =>
    ((this.result.value()?.batches ?? [])).filter((b) => b.batch.status !== 'released' || this.state().view === 'paid'),
  );

  protected readonly rows = computed(() => {
    const v = this.state().view;
    const status = v === 'approval' ? ['awaiting-approval', 'rejected'] : v === 'paid' ? ['paid'] : ['approved'];
    return this.invoices()
      .filter((i) => status.includes(i.invoice.status))
      .sort((a, b) => (v === 'paid' ? (b.invoice.paidAt ?? '').localeCompare(a.invoice.paidAt ?? '') : a.invoice.dueAt.localeCompare(b.invoice.dueAt)));
  });

  protected readonly tabs = computed(() => {
    const inv = this.invoices();
    const openBatches = (this.result.value()?.batches ?? []).filter((b) => b.batch.status !== 'released').length;
    return [
      { id: 'approval', label: 'Awaiting approval', count: inv.filter((i) => i.invoice.status === 'awaiting-approval').length },
      { id: 'ready', label: 'Ready to pay', count: inv.filter((i) => i.invoice.status === 'approved').length },
      { id: 'batches', label: 'Payment batches', count: openBatches },
      { id: 'paid', label: 'Paid' },
    ];
  });

  protected readonly selection = computed(() => this.rows().filter((r) => this.selected().includes(r.invoice.id)));
  protected readonly selectionTotal = computed(() => this.selection().reduce((s, r) => s + r.invoice.amount, 0));
  protected readonly mixedSchemes = computed(() => new Set(this.selection().map((r) => r.scheme.id)).size > 1);
  protected readonly canPay = computed(() => this.session.can('Payables.Prepare'));
  protected readonly canRelease = computed(() => this.session.can('Payables.Release'));

  protected readonly columns: ColumnDef<InvoiceView>[] = [
    { key: 'invoice', header: 'Invoice', mobile: 'title', sort: (r) => r.invoice.id },
    { key: 'supplier', header: 'Supplier', width: '18%', sort: (r) => r.supplier.name },
    { key: 'scheme', header: 'Scheme', width: '90px', mobile: 'meta', sort: (r) => r.scheme.code },
    { key: 'match', header: 'Match', width: '170px' },
    { key: 'amount', header: 'Amount', align: 'end', width: '130px', sort: (r) => r.invoice.amount },
    { key: 'due', header: 'Due', width: '110px', sort: (r) => r.invoice.dueAt },
  ];

  protected readonly rowId = (r: InvoiceView) => r.invoice.id;
  protected readonly formatDate = formatDate;

  protected match(r: InvoiceView): { label: string; tone: 'success' | 'warning' | 'neutral' } {
    if (r.variance === null) return { label: r.invoice.contractRef ? `Contract ${r.invoice.contractRef}` : 'No quote', tone: 'neutral' };
    if (r.variance > 0) return { label: `+ ${formatRand(r.variance)} over quote`, tone: 'warning' };
    return { label: 'Matches quote', tone: 'success' };
  }

  protected setView(view: string): void {
    this.state.set({ view });
    this.selected.set([]);
  }

  protected createBatch(): void {
    if (this.mixedSchemes()) return;
    const ids = this.selected();
    this.busy.set(true);
    this.data.createBatch(ids).subscribe({
      next: (id) => {
        this.busy.set(false);
        this.selected.set([]);
        this.feedback.success(`Batch ${id} created — sent to a second authoriser`);
        this.setView('batches');
      },
      error: () => {
        this.busy.set(false);
        this.feedback.error('The batch couldn’t be created. Nothing was changed.');
      },
    });
  }

  /** Money leaves the trust account: always a fresh step-up (the API checks it too). */
  protected release(b: BatchView): void {
    this.busy.set(true);
    const detail = `Release ${formatRand(b.batch.total)} to ${b.invoices.length} suppliers from ${b.scheme.name}’s trust account`;
    this.stepUp.guard({ action: 'release-payment', detail }, () => this.data.releaseBatch(b.batch.id)).subscribe({
      complete: () => this.busy.set(false),
      next: () => {
        this.busy.set(false);
        this.feedback.success(`Released ${formatRand(b.batch.total)} to ${b.invoices.length} suppliers from ${b.scheme.name}’s trust account`);
      },
      error: () => {
        this.busy.set(false);
        this.feedback.error('The batch couldn’t be released. Nothing was paid.');
      },
    });
  }
}
