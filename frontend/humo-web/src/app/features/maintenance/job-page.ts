import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { AGENCY_QUEUE, JobDataSource, JobEvent, JobStage, PRIORITY_LABEL, Photo, TimelineEvent, TimelineKind, supplierCompliance } from '../../domain';
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
