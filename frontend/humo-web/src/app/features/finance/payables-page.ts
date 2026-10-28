import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { combineLatest, map } from 'rxjs';
import { BatchView, InvoiceView, PayablesDataSource, describeFailure, fieldErrorsOf, sumRands } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { REASON_FIELD, openForm } from '../shared/form-drawer';
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
 * invoices, to verified bank accounts; in batches from each scheme's trust
 * account; approved and released by someone other than the preparer (D27).
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
  private readonly drawer = inject(DrawerService);
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
  /** Open batches first (waiting for approval, then to release), then the most recent closed ones. */
  protected readonly batches = computed(() => {
    const all = this.result.value()?.batches ?? [];
    const open = all.filter((b) => this.isOpen(b)).sort((a, b) => a.batch.createdAt.localeCompare(b.batch.createdAt));
    const closed = all.filter((b) => !this.isOpen(b)).sort((a, b) => (b.batch.releasedAt ?? b.batch.cancelledAt ?? b.batch.createdAt).localeCompare(a.batch.releasedAt ?? a.batch.cancelledAt ?? a.batch.createdAt));
    return [...open, ...closed.slice(0, 10)];
  });

  protected isOpen(b: BatchView): boolean {
    return b.batch.status === 'awaiting-approval' || b.batch.status === 'approved';
  }

  protected preparedByMe(b: BatchView): boolean {
    return !!b.batch.createdById && b.batch.createdById === this.session.identity().id;
  }

  protected statusOf(b: BatchView): { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' } {
    switch (b.batch.status) {
      case 'awaiting-approval':
        return { label: 'Awaiting approval', tone: 'warning' };
      case 'approved':
        return { label: 'Approved — ready to release', tone: 'success' };
      case 'released':
        return { label: 'Released', tone: 'neutral' };
      case 'rejected':
        return { label: 'Rejected', tone: 'danger' };
      default:
        return { label: 'Cancelled', tone: 'neutral' };
    }
  }

  protected readonly rows = computed(() => {
    const v = this.state().view;
    const status = v === 'approval' ? ['awaiting-approval', 'rejected'] : v === 'paid' ? ['paid'] : ['approved'];
    return this.invoices()
      .filter((i) => status.includes(i.invoice.status))
      .sort((a, b) => (v === 'paid' ? (b.invoice.paidAt ?? '').localeCompare(a.invoice.paidAt ?? '') : a.invoice.dueAt.localeCompare(b.invoice.dueAt)));
  });

  protected readonly tabs = computed(() => {
    const inv = this.invoices();
    const openBatches = (this.result.value()?.batches ?? []).filter((b) => this.isOpen(b)).length;
    return [
      { id: 'approval', label: 'Awaiting approval', count: inv.filter((i) => i.invoice.status === 'awaiting-approval').length },
      { id: 'ready', label: 'Ready to pay', count: inv.filter((i) => i.invoice.status === 'approved').length },
      { id: 'batches', label: 'Payment batches', count: openBatches },
      { id: 'paid', label: 'Paid' },
    ];
  });

  protected readonly selection = computed(() => this.rows().filter((r) => this.selected().includes(r.invoice.id)));
  protected readonly selectionTotal = computed(() => sumRands(this.selection().map((r) => r.invoice.amount)));
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
      next: () => {
        this.busy.set(false);
        this.selected.set([]);
        this.feedback.success('Batch created. Someone other than you approves it in My work.');
        this.setView('batches');
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.feedback.error(failure(e, 'The batch wasn’t created'));
      },
    });
  }

  /** Money leaves the trust account: always a fresh passkey, never an SMS code (the API checks it too). */
  protected release(b: BatchView): void {
    this.busy.set(true);
    const suppliers = b.batch.payees?.length ?? b.invoices.length;
    const detail = `Release ${formatRand(b.batch.total)} to ${suppliers} ${suppliers === 1 ? 'supplier' : 'suppliers'} from ${b.scheme.name}’s trust account`;
    this.stepUp.guard({ action: 'release-payment', detail }, () => this.data.releaseBatch(b.batch.id, b.batch.version)).subscribe({
      complete: () => this.busy.set(false),
      next: (file) => {
        this.busy.set(false);
        this.feedback.success(`Released ${b.batch.ref}. Import ${file} into ${b.scheme.name}’s trust account in internet banking; the suppliers have been sent remittances.`);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.feedback.error(failure(e, 'The batch wasn’t released'));
      },
    });
  }

  protected downloadFile(b: BatchView): void {
    this.busy.set(true);
    this.stepUp.guard({ action: 'export-data', detail: `Download the payment file for ${b.batch.ref}` }, () => this.data.paymentFile(b.batch.id)).subscribe({
      complete: () => this.busy.set(false),
      next: (file) => {
        this.busy.set(false);
        this.feedback.success(`Downloaded ${file}.`);
      },
      error: () => {
        this.busy.set(false);
        this.feedback.error('The payment file couldn’t be downloaded.');
      },
    });
  }

  protected cancel(b: BatchView): void {
    openForm(this.drawer, {
      eyebrow: `${b.batch.ref} · ${formatRand(b.batch.total)}`,
      title: 'Cancel payment batch',
      intro: 'The batch is withdrawn before anything is paid, and its invoices are ready to pay again. Do this when a supplier’s bank details changed after the batch was made, or something in it is wrong.',
      fields: [REASON_FIELD],
      submitLabel: 'Cancel batch',
      submit: (v) => this.data.cancelBatch(b.batch.id, v['reason'], b.batch.version),
      success: () => `${b.batch.ref} cancelled. Its invoices are back under “Ready to pay”.`,
      failure: 'The batch wasn’t cancelled',
    });
  }
}

/** The API's reason when it refused the request (e.g. a supplier's bank details aren't verified), or what went wrong. */
function failure(e: unknown, action: string): string {
  const reason = Object.values(fieldErrorsOf(e))[0];
  return reason ? `${action}. ${reason}` : describeFailure(e, action);
}
