import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { CollectionDataSource, CollectionStep, CollectionView, TimelineEvent, TimelineKind } from '../../../domain';
import { DocumentTemplatesService } from '../../../core/documents/document-templates.service';
import { FeedbackService } from '../../../core/feedback/feedback.service';
import { loadable } from '../../../core/data/loadable';
import { SessionService } from '../../../core/session/session.service';
import { AgeingBar } from '../../../ui/ageing/ageing-bar';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { RandPipe, formatDate, formatRand } from '../../../ui/format/money';
import { KeyFact, RecordHeader } from '../../../ui/record/record-header';
import { ChainLink } from '../../../ui/record/relationship-chain';
import { StageTracker } from '../../../ui/stage-tracker/stage-tracker';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { Timeline } from '../../../ui/timeline/timeline';
import { links } from '../../accounts/account-view';
import {
  arrangementForm,
  disputeForm,
  handOverForm,
  missedInstalmentForm,
  requestDemandApprovalForm,
  resolveDisputeForm,
  sendLetterForm,
} from './collection-forms';
import { COLLECTION_STAGE_TONE, COLLECTION_TRACKER, LETTER_LABELS, collectionStageLabel, nextLetter } from './collection-view';

/**
 * One account's collection case (Record page P1 + Workflow tracker P3):
 * where it is in the pipeline, the next action and when it's due, every
 * letter sent (each a document), and the side states — arrangement, dispute.
 */
@Component({
  selector: 'app-collection-page',
  imports: [RecordHeader, StageTracker, AgeingBar, Timeline, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './collection-page.html',
  styleUrl: '../billing/billing-run-page.scss',
})
export class CollectionPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(CollectionDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  private readonly registry = inject(DocumentTemplatesService);
  protected readonly session = inject(SessionService);

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('accountId')!)), { initialValue: this.route.snapshot.paramMap.get('accountId')! });

  /** undefined = loading; false = not found. */
  protected readonly result = loadable(() => this.data.get(this.id()).pipe(map((d) => d ?? (false as const))));
  protected readonly view = computed<CollectionView | undefined>(() => this.result.value() || undefined);

  protected readonly stages = COLLECTION_TRACKER;
  protected readonly formatDate = formatDate;
  protected readonly letterLabels = LETTER_LABELS;
  protected readonly note = signal('');

  protected readonly canManage = computed(() => this.session.can('Collections.Manage') && this.session.hasFeature('credit-control') && !this.session.readOnly());
  protected readonly stage = computed(() => this.view()?.case.stage);
  protected readonly letter = computed(() => (this.view() ? nextLetter(this.view()!) : undefined));
  /** Arrangement and dispute sit beside the pipeline: the tracker shows where the case was. */
  protected readonly trackerStage = computed(() => {
    const c = this.view()?.case;
    if (!c) return 'not-started';
    return c.stage === 'arrangement' || c.stage === 'disputed' ? (c.previousStage ?? 'not-started') : c.stage;
  });
  protected readonly accountLink = computed(() => (this.view() ? links.account(this.view()!.scheme, this.view()!.unit) : ''));

  protected readonly status = computed(() => {
    const s = this.stage();
    return s ? { label: collectionStageLabel(s), tone: COLLECTION_STAGE_TONE[s] } : null;
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const v = this.view();
    if (!v) return [];
    return [
      { label: 'Overdue', value: formatRand(v.overdueAmount), hint: `${v.daysInArrears}+ days`, tone: v.overdueAmount > 0 ? 'danger' : 'success' },
      { label: 'Balance', value: formatRand(v.account.balance), hint: 'including this month' },
      v.next ? { label: 'Next action', value: formatDate(v.next.dueAt, true), hint: v.next.label, tone: v.next.overdue ? 'danger' : 'default' } : { label: 'Next action', value: '—' },
      { label: 'With', value: v.assigneeName },
    ];
  });

  protected readonly chain = computed<ChainLink[]>(() => {
    const v = this.view();
    if (!v) return [];
    return [
      { kind: 'Scheme', label: v.scheme.name, route: links.scheme(v.scheme) },
      { kind: 'Unit', label: `Unit ${v.unit.number}`, route: links.unit(v.scheme, v.unit) },
      { kind: 'Owner', label: v.holder.displayName, route: links.person(v.holder) },
      { kind: 'Account', label: v.account.accountNo, route: links.account(v.scheme, v.unit) },
      { kind: 'Credit control', label: 'Collection' },
    ];
  });

  protected readonly letters = computed(() => (this.view()?.case.steps ?? []).filter((s) => s.letter));

  protected readonly events = computed<TimelineEvent[]>(() =>
    (this.view()?.case.steps ?? []).map((s) => ({ id: s.id, at: s.at, kind: (s.letter ? 'document' : 'status') as TimelineKind, title: s.text, actor: s.by })),
  );

  protected templateOf(s: CollectionStep): string {
    const r = s.letter ? this.registry.resolve(s.letter.template) : undefined;
    return r ? `${r.template.name} v${r.version.version}` : '';
  }

  // ---- Commands

  private v(): CollectionView {
    return this.view()!;
  }

  protected send(): void {
    const kind = this.letter();
    if (kind) sendLetterForm(this.drawer, this.data, this.v(), kind);
  }

  protected askTrustees(): void {
    requestDemandApprovalForm(this.drawer, this.data, this.v());
  }

  protected handOver(): void {
    handOverForm(this.drawer, this.data, this.v());
  }

  protected arrangement(): void {
    arrangementForm(this.drawer, this.data, this.v());
  }

  protected missed(): void {
    missedInstalmentForm(this.drawer, this.data, this.v());
  }

  protected dispute(): void {
    disputeForm(this.drawer, this.data, this.v());
  }

  protected resolve(): void {
    resolveDisputeForm(this.drawer, this.data, this.v());
  }

  protected addNote(): void {
    const text = this.note().trim();
    const v = this.view();
    if (!text || !v) return;
    this.data.act(v.account.id, { type: 'note', text }, v.case.version).subscribe({
      next: () => {
        this.note.set('');
        this.feedback.success('Note added');
      },
      error: () => this.feedback.error('Couldn’t add the note — your text is still here.'),
    });
  }
}
