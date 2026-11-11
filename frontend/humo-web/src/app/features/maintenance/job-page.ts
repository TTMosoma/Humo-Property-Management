import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { AGENCY_QUEUE, Job, JobDataSource, JobEvent, JobStage, PRIORITY_LABEL, Photo, Priority, Quote, TimelineEvent, TimelineKind, supplierCompliance } from '../../domain';
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
import { failedPhotosMessage, uploadAll } from './photo-upload';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { openForm } from '../shared/form-drawer';
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
  private readonly drawer = inject(DrawerService);

  /** Staff who log or run jobs add photos; after the work is done they're of the finished work. */
  protected readonly canAddPhotos = computed(() => (this.session.can('Maintenance.Log') || this.session.can('Maintenance.Manage')) && !this.session.readOnly());
  protected readonly uploading = signal(false);

  protected photoUrl(ref: string, photo: Photo): string | undefined {
    return this.jobs.photoUrl(ref, photo);
  }

  /** Staff with the job in hand, until it's closed or cancelled. */
  protected readonly canChangePriority = computed(() => {
    const d = this.detail();
    return !!d && this.session.can('Maintenance.Manage') && !this.session.readOnly() && d.job.stage !== 'closed' && d.job.stage !== 'cancelled';
  });

  protected quoteStatus(q: Quote): string {
    switch (q.status) {
      case 'received':
        return 'Received ' + formatDate(q.receivedAt, true);
      case 'requested':
        return 'Requested';
      case 'revision-requested':
        return 'Revision requested';
      case 'rejected':
        return 'Rejected';
      default:
        return 'Declined';
    }
  }

  /** D41: the amount before the latest one, if it has changed or been revised. */
  protected previous(q: Quote): number | undefined {
    const v = q.versions ?? [];
    return v.length > 1 ? v[v.length - 2].amount : undefined;
  }

  /** D41: every amount the quote has had, for its tooltip. */
  protected history(q: Quote): string {
    return (q.versions ?? []).map((v) => `${formatRand(v.amount)}${v.reason ? ` — ${v.reason}` : ''}${v.by ? ` (${v.by})` : ''}`).join('\n');
  }

  /** D41: while collecting quotes, any received one; once recommended or approved, that one, until the work order. */
  protected canCorrect(job: Job, q: Quote): boolean {
    if (!this.canChangePriority() || job.emergency || q.status !== 'received') return false;
    return job.stage === 'quoting' || ((job.stage === 'approval' || job.stage === 'approved') && !!q.recommended);
  }

  protected correctQuote(job: Job, q: Quote): void {
    const after =
      job.stage === 'approval' ? ' It’s waiting for approval: changing it withdraws that, and it’s sent again.'
      : job.stage === 'approved' ? ' It’s approved: a lower price stands and the approver is told; a higher one reopens quotes, to be approved again.'
      : '';
    openForm(this.drawer, {
      eyebrow: `${job.ref} · ${formatRand(q.amount)}`,
      title: 'Correct the quote',
      intro: `The amount changes with your reason, and the job’s history keeps every amount.${after}`,
      fields: [
        { key: 'amount', label: 'Correct amount (R)', type: 'number', required: true, half: true },
        { key: 'reason', label: 'Why', type: 'textarea', required: true, placeholder: 'e.g. Typing error, or the supplier’s revised price' },
      ],
      submitLabel: 'Correct the quote',
      submit: (f) => this.jobs.act(job.ref, { type: 'correct-quote', quoteId: q.id, amount: Number(f['amount']), reason: f['reason'] }, job.version),
      success: () => 'Quote corrected.',
      failure: 'The quote wasn’t corrected',
    });
  }

  /** D41: ask the same supplier again, e.g. after a rejection. */
  protected askRevision(job: Job, q: Quote): void {
    openForm(this.drawer, {
      eyebrow: `${job.ref} · ${formatRand(q.amount)}`,
      title: 'Ask for a revised quote',
      intro: 'The quote shows “Revision requested” until you record the new amount. The earlier amount stays in its history.',
      fields: [{ key: 'reason', label: 'What to revise', type: 'textarea', required: true, placeholder: q.rejectedReason ?? 'e.g. The board asks for a lower price' }],
      submitLabel: 'Ask for a revision',
      submit: (f) => this.jobs.act(job.ref, { type: 'request-revision', quoteId: q.id, reason: f['reason'] }, job.version),
      success: () => 'Revision asked for. Record the new amount when it comes in.',
      failure: 'It wasn’t saved',
    });
  }

  /** A job can become more (or less) pressing at any stage; the reason goes in its history. */
  protected changePriority(): void {
    const job = this.detail()!.job;
    openForm(this.drawer, {
      eyebrow: job.ref,
      title: 'Change priority',
      intro: `Now ${PRIORITY_LABEL[job.priority].toLowerCase()}. The change and its reason are recorded on the job. Only an urgent job can go ahead above the scheme’s limit in an emergency.`,
      fields: [
        { key: 'priority', label: 'Priority', type: 'select', required: true, half: true, options: (Object.keys(PRIORITY_LABEL) as Priority[]).filter((p) => p !== job.priority).map((p) => ({ value: p, label: PRIORITY_LABEL[p] })) },
        { key: 'reason', label: 'Why', type: 'textarea', required: true, placeholder: 'e.g. The leak has spread to Unit 4' },
      ],
      submitLabel: 'Change priority',
      submit: (f) => this.jobs.act(job.ref, { type: 'change-priority', priority: f['priority'] as Priority, reason: f['reason'] }, job.version),
      success: () => 'Priority changed.',
      failure: 'The priority wasn’t changed',
    });
  }

  /** Added by mistake: asked first, because the file goes too. */
  protected removePhoto(ref: string, photo: Photo): void {
    openForm(this.drawer, {
      eyebrow: ref,
      title: 'Remove this photo?',
      intro: `“${photo.caption}” is removed from the job and deleted, which frees its storage. This can’t be undone.`,
      fields: [],
      initial: {},
      submitLabel: 'Remove photo',
      submit: () => this.jobs.removePhoto(ref, photo.id),
      success: () => 'Photo removed.',
      failure: 'The photo wasn’t removed',
    });
  }

  protected addPhotos(ref: string, stage: JobStage, e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    const after: JobStage[] = ['completed', 'verified', 'invoiced', 'paid', 'closed'];
    const photoStage: Photo['stage'] = after.includes(stage) && this.session.can('Maintenance.Manage') ? 'completion' : 'report';
    this.uploading.set(true);
    uploadAll(files, (f) => this.jobs.addPhoto(ref, f, photoStage)).subscribe((failed) => {
      this.uploading.set(false);
      if (failed.length === 0) this.feedback.success(files.length === 1 ? 'Photo added' : `${files.length} photos added`);
      else this.feedback.error(failedPhotosMessage(failed, files.length));
    });
  }
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
      j.assigneeId
        ? { label: 'Assigned to', value: d.assigneeName }
        : { label: 'Assigned to', value: AGENCY_QUEUE, hint: d.scheme.portfolioManager ? 'waiting to be picked up' : 'this scheme has no portfolio manager', tone: 'warning' },
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
