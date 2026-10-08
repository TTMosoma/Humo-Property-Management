import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import {
  MEETING_TYPE_LABELS,
  MeetingDataSource,
  MeetingDetail,
  MeetingEvent,
  NOTICE_DAYS,
  TimelineEvent,
  TimelineKind,
  earliestMeetingDate,
} from '../../domain';
import { DocumentTemplatesService } from '../../core/documents/document-templates.service';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatDate } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { ChainLink } from '../../ui/record/relationship-chain';
import { StageTracker } from '../../ui/stage-tracker/stage-tracker';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { Timeline } from '../../ui/timeline/timeline';
import { openForm } from '../shared/form-drawer';
import { agendaItemForm, attendanceForm, cancelMeetingForm, minuteForm, packForm, rescheduleForm, resolutionForm } from './meeting-forms';
import { MEETING_STAGE_TONE, MEETING_TRACKER, PROGRESS_TONE, progressLabel, stageLabel, when } from './meeting-view';

const EVENT_KIND: Record<MeetingEvent['kind'], TimelineKind> = {
  stage: 'status',
  comment: 'note',
  notice: 'message',
  resolution: 'status',
  document: 'document',
  action: 'status',
};

/**
 * A meeting (Record page P1 + Workflow tracker P3): agenda → notice → pack →
 * held → minutes → approved, with the resolutions taken and the actions they
 * created. Every stage's next step lives on this page.
 */
@Component({
  selector: 'app-meeting-page',
  imports: [RecordHeader, StageTracker, StatusPill, Timeline, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './meeting-page.html',
  styleUrl: './meeting-page.scss',
})
export class MeetingPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(MeetingDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  private readonly registry = inject(DocumentTemplatesService);
  protected readonly session = inject(SessionService);

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('meetingId')!)), { initialValue: this.route.snapshot.paramMap.get('meetingId')! });

  /** undefined = loading; false = not found. */
  protected readonly result = loadable(() => this.data.get(this.id()).pipe(map((d) => d ?? (false as const))));
  protected readonly detail = computed(() => this.result.value() || undefined);

  protected readonly stages = MEETING_TRACKER;
  protected readonly tone = MEETING_STAGE_TONE;
  protected readonly progressTone = PROGRESS_TONE;
  protected readonly progressLabel = progressLabel;
  protected readonly stageLabel = stageLabel;
  protected readonly formatDate = formatDate;
  protected readonly when = when;
  protected readonly comment = signal('');

  protected readonly canManage = computed(() => this.session.can('Meetings.Manage') && !this.session.readOnly());
  protected readonly stage = computed(() => this.detail()?.meeting.stage);
  protected readonly minuting = computed(() => this.stage() === 'held' || this.stage() === 'minutes-draft');
  protected readonly minutesPending = computed(() => {
    const m = this.detail()?.meeting;
    return !!m?.minutes?.approvalWorkItemId && !m.minutes.approvedAt;
  });

  protected readonly status = computed(() => {
    const m = this.detail()?.meeting;
    return m ? { label: stageLabel(m.stage), tone: MEETING_STAGE_TONE[m.stage] } : null;
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const m = d.meeting;
    return [
      { label: 'When', value: when(m.scheduledFor), hint: m.venue },
      m.notice
        ? { label: 'Notice', value: `Sent ${formatDate(m.notice.sentAt, true)}`, hint: `${m.notice.recipients} recipients` }
        : { label: 'Notice', value: 'Not sent', hint: `${NOTICE_DAYS[m.type]} days needed`, tone: m.stage === 'draft' && new Date(m.scheduledFor) < earliestMeetingDate(m.type) ? 'danger' : 'default' },
      { label: 'Attendance', value: m.held ? `${m.held.present} of ${m.held.voters}` : '—', hint: m.held ? `quorum ${m.held.required}` : undefined },
      { label: 'Resolutions', value: String(d.resolutions), hint: d.openActions ? `${d.openActions} open action${d.openActions === 1 ? '' : 's'}` : undefined, tone: d.openActions ? 'warning' : 'default' },
    ];
  });

  protected readonly chain = computed<ChainLink[]>(() => {
    const d = this.detail();
    if (!d) return [];
    return [
      { kind: 'Scheme', label: d.scheme.name, route: `/schemes/${d.scheme.id}` },
      { kind: 'Meetings', label: 'Meetings', route: '/governance/meetings' },
      { kind: 'Meeting', label: d.meeting.ref },
    ];
  });

  protected readonly typeLabel = computed(() => (this.detail() ? MEETING_TYPE_LABELS[this.detail()!.meeting.type] : ''));
  protected readonly noticeDays = computed(() => (this.detail() ? NOTICE_DAYS[this.detail()!.meeting.type] : 0));
  protected readonly earliest = computed(() => (this.detail() ? formatDate(earliestMeetingDate(this.detail()!.meeting.type).toISOString()) : ''));

  protected readonly events = computed<TimelineEvent[]>(() =>
    (this.detail()?.meeting.events ?? []).map((e) => ({ id: e.id, at: e.at, kind: EVENT_KIND[e.kind], title: e.text, actor: e.by })),
  );

  /** What each document is (or will be) rendered with. */
  protected readonly noticeTemplate = computed(() => this.templateLabel(this.detail()?.meeting.notice?.document, 'meeting-notice'));
  protected readonly minutesTemplate = computed(() => this.templateLabel(this.detail()?.meeting.minutes?.document, 'meeting-minutes'));

  private templateLabel(ref: { templateId: string; version: number } | undefined, type: 'meeting-notice' | 'meeting-minutes'): string {
    const r = ref ? this.registry.resolve(ref) : undefined;
    if (r) return `${r.template.name} v${r.version.version}, as issued`;
    const def = this.registry.defaultFor(type);
    return def ? `${def.name} (your default)` : '';
  }

  // ---- Commands

  private d(): MeetingDetail {
    return this.detail()!;
  }

  protected addItem(): void {
    agendaItemForm(this.drawer, this.data, this.d());
  }

  protected removeItem(itemId: string): void {
    const m = this.d().meeting;
    this.data.act(m.id, { type: 'remove-agenda-item', itemId }, m.version).subscribe({ error: () => this.feedback.error('The item wasn’t removed.') });
  }

  protected reschedule(): void {
    rescheduleForm(this.drawer, this.data, this.d());
  }

  protected sendNotice(): void {
    const d = this.d();
    const m = d.meeting;
    const recipients = m.type === 'trustee' ? `the ${m.attendees.filter((a) => a.role !== 'agent').length} trustees` : `all ${d.scheme.unitCount} owners`;
    openForm(this.drawer, {
      eyebrow: m.title,
      title: 'Send notice',
      intro: `The notice (${this.noticeTemplate()}) goes to ${recipients} by email and the portal, with the ${m.agenda.length}-item agenda. ${MEETING_TYPE_LABELS[m.type]}s need ${NOTICE_DAYS[m.type]} days’ notice. After this the agenda is fixed.`,
      fields: [],
      submitLabel: 'Send notice',
      submit: () => this.data.act(m.id, { type: 'send-notice' }, m.version),
      success: () => 'Notice sent.',
      failure: 'The notice wasn’t sent',
    });
  }

  protected pack(): void {
    packForm(this.drawer, this.data, this.d());
  }

  protected attendance(): void {
    attendanceForm(this.drawer, this.data, this.d());
  }

  protected minute(itemId: string): void {
    minuteForm(this.drawer, this.data, this.d(), itemId);
  }

  protected resolution(itemId?: string): void {
    resolutionForm(this.drawer, this.data, this.d(), itemId);
  }

  protected sendMinutes(): void {
    const m = this.d().meeting;
    openForm(this.drawer, {
      eyebrow: m.title,
      title: 'Send minutes for approval',
      intro: `The trustees approve them in Approvals. Once approved, the minutes are final (${this.minutesTemplate()}) and can be shared with owners.`,
      fields: [],
      submitLabel: 'Send to the trustees',
      submit: () => this.data.act(m.id, { type: 'send-minutes-for-approval' }, m.version),
      success: () => 'Minutes sent to the trustees.',
      failure: 'The minutes weren’t sent',
    });
  }

  protected cancel(): void {
    cancelMeetingForm(this.drawer, this.data, this.d());
  }

  protected addComment(): void {
    const text = this.comment().trim();
    const m = this.detail()?.meeting;
    if (!text || !m) return;
    this.data.act(m.id, { type: 'comment', text }, m.version).subscribe({
      next: () => {
        this.comment.set('');
        this.feedback.success('Comment added');
      },
      error: () => this.feedback.error('Couldn’t add the comment — your text is still here.'),
    });
  }
}
