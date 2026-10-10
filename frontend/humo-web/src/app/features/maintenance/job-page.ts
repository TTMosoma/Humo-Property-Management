import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { JobDataSource, JobEvent, PRIORITY_LABEL, TimelineEvent, TimelineKind, supplierCompliance } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { RandPipe, formatDate, formatRand } from '../../ui/format/money';
import { PhotoTile } from '../../ui/photo/photo-tile';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { ChainLink } from '../../ui/record/relationship-chain';
import { StageTracker } from '../../ui/stage-tracker/stage-tracker';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { Timeline } from '../../ui/timeline/timeline';
import { links } from '../accounts/account-view';
import { JobNextStep } from './job-next-step';
import { STAGE_LABEL, STAGE_TONE, TRACKER_STAGES, daysOpen, isOverdue } from './job-view';
import { AttachmentsPanel } from '../library/attachments-panel';

const EVENT_KIND: Record<JobEvent['kind'], TimelineKind> = {
  stage: 'status',
  comment: 'note',
  quote: 'document',
  approval: 'status',
  message: 'message',
  invoice: 'charge',
  payment: 'payment',
  photo: 'document',
};

/**
 * A maintenance job (Record page P1 + Workflow tracker P3): the single record
 * for request → quotes → approval → work order → completion → verification →
 * invoice → payment. Every stage's next action lives on this page.
 */
@Component({
  selector: 'app-job-page',
  imports: [AttachmentsPanel, RecordHeader, StageTracker, JobNextStep, StatusPill, PhotoTile, Timeline, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './job-page.html',
  styleUrl: './job-page.scss',
})
export class JobPage {
  private readonly route = inject(ActivatedRoute);
  private readonly jobs = inject(JobDataSource);
  private readonly feedback = inject(FeedbackService);
  protected readonly session = inject(SessionService);

  private readonly ref = toSignal(this.route.paramMap.pipe(map((p) => p.get('requestId')!)), {
    initialValue: this.route.snapshot.paramMap.get('requestId')!,
  });

  /** undefined = loading; null = failed; false = not found. */
  protected readonly result = loadable(() => {
    const ref = this.ref();
    return this.jobs.get(ref).pipe(map((d) => d ?? (false as const)));
  });

  protected readonly detail = computed(() => {
    const r = this.result.value();
    return r ? r : undefined;
  });

  protected readonly comment = signal('');

  protected readonly stages = TRACKER_STAGES;
  protected readonly formatDate = formatDate;
  protected readonly links = links;

  protected readonly overdue = computed(() => (this.detail() ? isOverdue(this.detail()!.job) : false));
  protected readonly status = computed(() => {
    const j = this.detail()?.job;
    return j ? { label: STAGE_LABEL[j.stage], tone: STAGE_TONE[j.stage] } : null;
  });

  protected readonly approved = computed(() => {
    const j = this.detail()?.job;
    return j?.approval?.status === 'approved' ? j.quotes.find((q) => q.recommended) : undefined;
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const j = d.job;
    return [
      { label: 'Reported', value: formatDate(j.reportedAt, true), hint: `by ${j.reportedBy.name}` },
      { label: 'Open for', value: `${daysOpen(j)} days`, tone: this.overdue() ? 'danger' : 'default' },
      { label: 'Assigned to', value: d.assigneeName },
      { label: 'Supplier', value: d.supplier?.name ?? '—' },
      { label: 'Approved', value: this.approved() ? formatRand(this.approved()!.amount) : '—' },
    ];
  });

  protected readonly chain = computed<ChainLink[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const chain: ChainLink[] = [{ kind: 'Scheme', label: d.scheme.name, route: links.scheme(d.scheme) }];
    if (d.unit) chain.push({ kind: 'Unit', label: `Unit ${d.unit.number}`, route: links.unit(d.scheme, d.unit) });
    else chain.push({ kind: 'Location', label: d.job.location });
    if (d.supplier) chain.push({ kind: 'Supplier', label: d.supplier.name, route: `/suppliers/${d.supplier.id}` });
    chain.push({ kind: 'Job', label: d.job.ref });
    return chain;
  });

  protected readonly events = computed<TimelineEvent[]>(() =>
    (this.detail()?.job.events ?? []).map((e) => ({ id: e.id, at: e.at, kind: EVENT_KIND[e.kind], title: e.text, actor: e.by })),
  );

  /** Three-way match: approved quote → invoice → payment. */
  protected readonly money = computed(() => {
    const d = this.detail();
    if (!d) return null;
    const quote = this.approved();
    const inv = d.invoice?.invoice;
    return {
      quote: quote?.amount,
      invoice: inv?.amount,
      variance: d.invoice?.variance ?? null,
      paid: inv?.status === 'paid' ? inv.amount : undefined,
      invoiceStatus: inv?.status,
    };
  });

  protected priorityLabel(p: keyof typeof PRIORITY_LABEL): string {
    return PRIORITY_LABEL[p];
  }

  protected compliance(id: string) {
    const s = this.detail()?.suppliers[id];
    if (!s) return null;
    const c = supplierCompliance(s);
    return c === 'valid' ? { label: 'Vetted', tone: 'success' as const } : c === 'expiring' ? { label: 'Doc expiring', tone: 'warning' as const } : { label: 'Doc ' + c, tone: 'danger' as const };
  }

  protected addComment(): void {
    const text = this.comment().trim();
    const d = this.detail();
    if (!text || !d) return;
    this.jobs.act(d.job.ref, { type: 'comment', text }, d.job.version).subscribe({
      next: () => {
        this.comment.set('');
        this.feedback.success('Comment added');
      },
      error: () => this.feedback.error('Couldn’t add the comment — your text is still here.'),
    });
  }
}
