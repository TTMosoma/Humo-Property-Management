import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { ContractorNetwork } from '../../domain/contractor';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import {
  DELEGATED_LIMIT,
  DocStatus,
  JobAction,
  JobDataSource,
  JobDetail,
  PRIORITY_LABEL,
  Priority,
  Quote,
  Supplier,
  Trade,
  docStatus,
  supplierCompliance,
} from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { SessionService } from '../../core/session/session.service';
import { STAFF } from '../../mock/fixtures/staff';
import { RandPipe, formatDate, formatRand } from '../../ui/format/money';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { ApprovalCard } from '../my-work/approval-card';

const TRADES: Trade[] = ['Plumbing', 'Electrical', 'Roofing & waterproofing', 'Painting', 'Security', 'Gate automation', 'Lifts', 'Gardens', 'Pools', 'Pest control', 'Building', 'Fire equipment'];

/**
 * The "Next step" panel: at every stage the job page shows the one thing to
 * do now, with the context needed to do it well. This is what turns a
 * maintenance record into a workflow (review finding F16).
 */
@Component({
  selector: 'app-job-next-step',
  imports: [ApprovalCard, StatusPill, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './job-next-step.html',
  styleUrl: './job-next-step.scss',
})
export class JobNextStep {
  private readonly jobs = inject(JobDataSource);
  private readonly network = inject(ContractorNetwork);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);

  readonly detail = input.required<JobDetail>();

  /** A Humo Contractor quote request for this job, if quotes were requested through Humo. */
  protected readonly networkRequest = toSignal(
    toObservable(computed(() => this.detail().job.ref)).pipe(
      distinctUntilChanged(),
      switchMap((ref) => this.network.quoteRequestFor({ product: 'humo-pm', ref }).pipe(catchError(() => of(undefined)))),
      map((v) => v ?? null),
    ),
    { initialValue: null },
  );

  protected readonly staff = STAFF.filter((s) => s.title !== 'Senior Accountant' && s.title !== 'Credit Controller');
  protected readonly trades = TRADES;
  protected readonly priorities = Object.keys(PRIORITY_LABEL) as Priority[];
  protected readonly priorityLabel = PRIORITY_LABEL;
  protected readonly limit = DELEGATED_LIMIT;
  protected readonly formatDate = formatDate;
  protected readonly now = new Date().toISOString();

  protected readonly busy = signal(false);
  /** Portfolio managers and agency admins run jobs; finance and trustees see the state. */
  // Permission-based: Operations runs jobs too; Observe impersonation removes both.
  protected readonly canAct = computed(() => this.session.can('Maintenance.Manage'));
  protected readonly isFinance = computed(() => this.session.can('Payables.Prepare'));

  // ---- Form state (reset when the job or stage changes) ----
  protected readonly assignee = signal('');
  protected readonly priority = signal<Priority>('normal');
  protected readonly category = signal<Trade>('Plumbing');
  protected readonly chosenSuppliers = signal<string[]>([]);
  protected readonly quoteDrafts = signal<Record<string, { amount: string; guarantee: string }>>({});
  protected readonly recommended = signal<string | null>(null);
  protected readonly scheduleDate = signal('');
  protected readonly accessNotes = signal('');
  protected readonly overrideCompliance = signal(false);
  protected readonly completionNotes = signal('');
  protected readonly notFixedComment = signal('');
  protected readonly showNotFixed = signal(false);
  protected readonly invoiceNo = signal('');
  protected readonly invoiceAmount = signal('');
  protected readonly cancelReason = signal('');
  protected readonly showCancel = signal(false);

  constructor() {
    effect(() => {
      const d = this.detail();
      const key = `${d.job.ref}:${d.job.stage}`;
      untracked(() => this.reset(d, key));
    });
  }

  private lastKey = '';

  private reset(d: JobDetail, key: string): void {
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.assignee.set(d.job.assigneeId ?? d.scheme.portfolioManagerId);
    this.priority.set(d.job.priority);
    this.category.set(d.job.category);
    this.chosenSuppliers.set(this.compliantCandidates(d).slice(0, 2).map((s) => s.id));
    this.quoteDrafts.set({});
    this.recommended.set(d.job.quotes.find((q) => q.recommended)?.id ?? this.cheapest(d)?.id ?? null);
    const tomorrow = new Date(Date.now() + 86_400_000);
    this.scheduleDate.set(tomorrow.toISOString().slice(0, 10));
    this.accessNotes.set(d.unit ? 'Owner/occupant will provide access. Call 30 minutes before.' : 'Collect keys from the guardhouse.');
    this.overrideCompliance.set(false);
    this.completionNotes.set('');
    this.showNotFixed.set(false);
    this.notFixedComment.set('');
    this.invoiceNo.set(`INV-${21000 + Math.floor(Math.random() * 900)}`);
    this.invoiceAmount.set(String(d.job.quotes.find((q) => q.recommended)?.amount ?? ''));
    this.showCancel.set(false);
  }

  // ---- Derived ----

  protected readonly received = computed(() => this.detail().job.quotes.filter((q) => q.status === 'received'));
  protected readonly requested = computed(() => this.detail().job.quotes.filter((q) => q.status === 'requested'));
  /** The chosen quote — or, until someone chooses, the cheapest received one. */
  protected readonly recommendedQuote = computed<Quote | undefined>(() => {
    const received = this.received();
    return received.find((q) => q.id === this.recommended()) ?? [...received].sort((a, b) => a.amount - b.amount)[0];
  });
  protected readonly notYetAsked = computed(() => {
    const asked = new Set(this.detail().job.quotes.map((q) => q.supplierId));
    return this.detail().candidates.filter((s) => !asked.has(s.id) && s.status === 'active');
  });
  protected readonly supplier = computed(() => this.detail().supplier);
  /** Expired or missing site-work documents: the work order needs an explicit override. */
  protected readonly supplierIssues = computed(() => {
    const s = this.supplier();
    return s ? this.issues(s, ['expired', 'missing']) : [];
  });
  /** Documents expiring soon: a heads-up, not a blocker. */
  protected readonly supplierWarnings = computed(() => {
    const s = this.supplier();
    return s ? this.issues(s, ['expiring']) : [];
  });
  protected readonly approvedAmount = computed(() => this.detail().job.quotes.find((q) => q.recommended)?.amount);
  protected readonly invoiceAmountNum = computed(() => Number(this.invoiceAmount()) || 0);
  protected readonly variance = computed(() => {
    const a = Number(this.invoiceAmount());
    const approved = this.approvedAmount();
    return approved === undefined || !a ? null : Math.round((a - approved) * 100) / 100;
  });

  protected issues(s: Supplier, only: DocStatus[] = ['expired', 'missing', 'expiring']): string[] {
    return s.documents
      .filter((d) => d.type !== 'B-BBEE certificate' && only.includes(docStatus(d)))
      .map((d) => {
        const st = docStatus(d);
        if (st === 'missing') return `${d.type} not on file`;
        const days = Math.round((new Date(d.expires!).getTime() - Date.now()) / 86_400_000);
        return st === 'expired' ? `${d.type} expired ${-days} days ago` : `${d.type} expires in ${days} days`;
      });
  }

  protected compliance(s: Supplier) {
    const c = supplierCompliance(s);
    return c === 'valid'
      ? { label: 'Vetted', tone: 'success' as const }
      : c === 'expiring'
        ? { label: 'Document expiring', tone: 'warning' as const }
        : { label: c === 'missing' ? 'Document missing' : 'Document expired', tone: 'danger' as const };
  }

  protected supplierName(id: string): string {
    return this.detail().suppliers[id]?.name ?? this.detail().candidates.find((c) => c.id === id)?.name ?? 'Supplier';
  }

  private compliantCandidates(d: JobDetail): Supplier[] {
    return d.candidates.filter((s) => s.status === 'active' && !['expired', 'missing'].includes(supplierCompliance(s)));
  }

  private cheapest(d: JobDetail) {
    return [...d.job.quotes.filter((q) => q.status === 'received')].sort((a, b) => a.amount - b.amount)[0];
  }

  // ---- Actions ----

  protected toggleSupplier(id: string): void {
    this.chosenSuppliers.update((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }

  protected setDraft(quoteId: string, field: 'amount' | 'guarantee', value: string): void {
    this.quoteDrafts.update((d) => ({ ...d, [quoteId]: { amount: d[quoteId]?.amount ?? '', guarantee: d[quoteId]?.guarantee ?? '', [field]: value } }));
  }

  protected triageAndRequest(): void {
    const ref = this.detail().job.ref;
    this.run(
      [
        { type: 'triage', assigneeId: this.assignee(), priority: this.priority(), category: this.category() },
        ...(this.chosenSuppliers().length ? [{ type: 'request-quotes', supplierIds: this.chosenSuppliers() } as JobAction] : []),
      ],
      this.chosenSuppliers().length ? `Quotes requested from ${this.chosenSuppliers().length} suppliers` : 'Triage saved',
      ref,
    );
  }

  protected requestMore(id: string): void {
    this.run([{ type: 'request-quotes', supplierIds: [id] }], `Quote requested from ${this.supplierName(id)}`);
  }

  protected recordQuote(quoteId: string): void {
    const d = this.quoteDrafts()[quoteId];
    const amount = Number(d?.amount);
    if (!amount) return;
    this.run([{ type: 'record-quote', quoteId, amount, guaranteeMonths: d?.guarantee ? Number(d.guarantee) : undefined }], `Quote recorded: ${formatRand(amount)}`);
  }

  protected approveDelegated(): void {
    const q = this.recommendedQuote();
    if (q) this.run([{ type: 'approve-within-delegation', quoteId: q.id }], `Approved ${formatRand(q.amount)} — ready for a work order`);
  }

  protected sendForApproval(): void {
    const q = this.recommendedQuote();
    if (q) this.run([{ type: 'send-for-approval', quoteId: q.id }], q.amount > DELEGATED_LIMIT ? 'Sent to the trustees for approval' : 'Sent for approval');
  }

  protected issueWorkOrder(): void {
    const at = new Date(this.scheduleDate() + 'T08:00:00');
    this.run([{ type: 'issue-work-order', scheduledFor: at.toISOString(), accessNotes: this.accessNotes() }], `Work order sent to ${this.supplier()?.name} for ${formatDate(at.toISOString())}`);
  }

  protected start(): void {
    this.run([{ type: 'start-work' }], 'Marked as in progress');
  }

  protected complete(): void {
    const notes = this.completionNotes().trim() || 'Work completed.';
    this.run([{ type: 'complete', notes }], 'Completion recorded — resident asked to confirm');
  }

  protected verify(outcome: 'fixed' | 'not-fixed'): void {
    this.run(
      [{ type: 'verify', outcome, comment: outcome === 'not-fixed' ? this.notFixedComment() : undefined, onBehalf: true }],
      outcome === 'fixed' ? 'Verified as fixed' : 'Sent back to the supplier',
    );
  }

  protected captureInvoice(): void {
    const amount = Number(this.invoiceAmount());
    if (!amount || !this.invoiceNo().trim()) return;
    const v = this.variance();
    this.run(
      [{ type: 'capture-invoice', amount, invoiceNo: this.invoiceNo().trim() }],
      v !== null && v > 0 ? 'Invoice over quote — sent for re-approval' : 'Invoice matched — ready to pay',
    );
  }

  protected close(): void {
    this.run([{ type: 'close' }], 'Job closed');
  }

  protected cancel(): void {
    if (!this.cancelReason().trim()) return;
    this.run([{ type: 'cancel', reason: this.cancelReason().trim() }], 'Job cancelled');
  }

  private run(actions: JobAction[], message: string, ref = this.detail().job.ref): void {
    this.busy.set(true);
    const next = (i: number): void => {
      if (i >= actions.length) {
        this.busy.set(false);
        this.feedback.success(message);
        return;
      }
      this.jobs.act(ref, actions[i]).subscribe({
        next: () => next(i + 1),
        error: () => {
          this.busy.set(false);
          this.feedback.error('That didn’t save. Nothing was changed — try again.');
        },
      });
    };
    next(0);
  }
}
