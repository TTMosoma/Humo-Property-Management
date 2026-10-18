import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, of } from 'rxjs';
import {
  CHANNEL_LABELS,
  CONVERSATION_STATUS_LABELS,
  Channel,
  CommunicationsDataSource,
  ConversationView,
  InboxDataSource,
  describeFailure,
  overdueOf,
  renderMerge,
} from '../../domain';
import { toSignal } from '@angular/core/rxjs-interop';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { organisationTeam } from '../../core/session/team';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { RandPipe, formatDate } from '../../ui/format/money';
import { relativeTime } from '../../ui/format/relative-time';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill, Tone } from '../../ui/status-pill/status-pill';
import { openForm, today } from '../shared/form-drawer';

const STATUS_TONE: Record<string, Tone> = { open: 'warning', waiting: 'info', closed: 'neutral' };

/**
 * My work › Inbox: conversations with owners, tenants and trustees. The
 * reply is written next to the person's balance, open jobs and unit; a
 * message can become a job or a Task without retyping it.
 */
@Component({
  selector: 'app-inbox-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './inbox-page.html',
  styleUrl: './inbox-page.scss',
})
export class InboxPage {
  private readonly router = inject(Router);
  private readonly data = inject(InboxDataSource);
  private readonly comms = inject(CommunicationsDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  private readonly scope = inject(ScopeService);
  protected readonly session = inject(SessionService);
  private readonly team = organisationTeam();

  protected readonly state = urlState({ view: 'open', c: null, mine: null });
  protected readonly result = loadable(() => this.data.list(this.scope.effectiveIds()));
  private readonly all = computed(() => this.result.value() ?? []);
  private readonly me = computed(() => this.session.identity().staffId ?? this.session.identity().id);

  protected readonly tabs = computed(() => {
    const a = this.mineOnly(this.all());
    return [
      { id: 'open', label: 'Needs a reply', count: a.filter((v) => v.conversation.status === 'open').length },
      { id: 'waiting', label: 'Waiting for them', count: a.filter((v) => v.conversation.status === 'waiting').length },
      { id: 'closed', label: 'Closed' },
      { id: 'all', label: 'All' },
    ];
  });
  private mineOnly(list: ConversationView[]): ConversationView[] {
    return this.state().mine ? list.filter((v) => v.conversation.assigneeId === this.me()) : list;
  }
  protected readonly rows = computed(() => {
    const v = this.state().view ?? 'open';
    return this.mineOnly(this.all()).filter((x) => v === 'all' || x.conversation.status === v);
  });
  protected readonly selected = computed(() => {
    const id = this.state().c;
    return this.all().find((v) => v.conversation.id === id) ?? null;
  });

  protected readonly templates = toSignal(this.comms.templates().pipe(catchError(() => of([]))), { initialValue: [] });
  protected readonly reply = signal('');
  protected readonly closeAfter = signal(false);
  protected readonly busy = signal(false);
  protected readonly replyError = signal('');

  protected readonly canReply = computed(() => this.session.can('Messages.Reply') && !this.session.readOnly());
  protected readonly staff = this.team.staff;
  protected readonly statusLabel = (v: ConversationView) => CONVERSATION_STATUS_LABELS[v.conversation.status];
  protected readonly statusTone = (v: ConversationView) => STATUS_TONE[v.conversation.status];
  protected readonly channelLabel = (c: Channel) => CHANNEL_LABELS[c];
  protected readonly ago = (iso: string) => relativeTime(iso);
  protected readonly formatDate = formatDate;
  protected readonly time = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
  protected readonly overdue = (v: ConversationView) => (v.account ? overdueOf(v.account.ageing) : 0);
  protected readonly last = (v: ConversationView) => v.conversation.messages.at(-1);

  constructor() {
    // A fresh draft for each conversation.
    effect(() => {
      this.state();
      this.reply.set('');
      this.replyError.set('');
      this.closeAfter.set(false);
    });
  }

  protected open(v: ConversationView): void {
    this.state.update((s) => ({ ...s, c: v.conversation.id }));
  }

  protected back(): void {
    this.state.update((s) => ({ ...s, c: null }));
  }

  protected useTemplate(id: string): void {
    const t = this.templates().find((x) => x.id === id);
    const v = this.selected();
    if (!t || !v) return;
    const values: Record<string, string> = {
      'person.name': v.person.displayName,
      'person.firstName': v.person.firstName || v.person.displayName,
      'scheme.name': v.scheme.name,
      'unit.number': v.unit?.number ?? '',
      'account.number': v.account?.accountNo ?? '',
      'agency.name': this.session.organisation()?.shortName ?? '',
    };
    this.reply.set(renderMerge(t.body, values));
  }

  protected send(): void {
    const v = this.selected();
    if (!v || this.busy()) return;
    this.busy.set(true);
    this.data.act(v.conversation.id, { type: 'reply', body: this.reply(), close: this.closeAfter() }, v.conversation.version).subscribe({
      next: () => {
        this.busy.set(false);
        this.reply.set('');
        this.feedback.success(this.closeAfter() ? 'Replied and closed.' : `Replied by ${this.channelLabel(v.person.preferredChannel)}.`);
      },
      error: (e) => {
        this.busy.set(false);
        this.replyError.set(describeFailure(e, 'Your reply wasn’t sent'));
      },
    });
  }

  protected assign(assigneeId: string): void {
    const v = this.selected()!;
    this.data.act(v.conversation.id, { type: 'assign', assigneeId: assigneeId || null }, v.conversation.version).subscribe({
      next: () => this.feedback.success('Assigned.'),
      error: () => this.feedback.error('It wasn’t assigned.'),
    });
  }

  protected setStatus(type: 'close' | 'reopen'): void {
    const v = this.selected()!;
    this.data.act(v.conversation.id, { type }, v.conversation.version).subscribe({
      next: () => this.feedback.success(type === 'close' ? 'Closed.' : 'Reopened: it’s back in your queue.'),
      error: () => this.feedback.error('That didn’t work.'),
    });
  }

  protected toJob(): void {
    const v = this.selected()!;
    openForm(this.drawer, {
      eyebrow: v.conversation.ref,
      title: 'Turn into a maintenance job',
      intro: 'The job gets their message as its description and them as the reporter. It starts at triage.',
      fields: [
        { key: 'title', label: 'Problem', type: 'text', required: true },
        { key: 'location', label: 'Where', type: 'text', required: true },
      ],
      initial: { title: v.conversation.subject, location: v.unit ? `Unit ${v.unit.number}` : 'Common property' },
      submitLabel: 'Create job',
      submit: (f) => this.data.act(v.conversation.id, { type: 'to-job', title: f['title'], location: f['location'] }, v.conversation.version),
      success: (ref) => `Job ${ref} created.`,
      done: (ref) => this.router.navigate(['/maintenance', ref]),
      failure: 'The job wasn’t created',
    });
  }

  protected toTask(): void {
    const v = this.selected()!;
    openForm(this.drawer, {
      eyebrow: v.conversation.ref,
      title: 'Create a follow-up Task',
      fields: [
        { key: 'title', label: 'What has to be done', type: 'text', required: true, placeholder: 'e.g. Send levy clearance figures to the conveyancer' },
        { key: 'dueAt', label: 'Due', type: 'date', required: true },
      ],
      initial: { title: '', dueAt: today() },
      submitLabel: 'Create Task',
      submit: (f) => this.data.act(v.conversation.id, { type: 'to-task', title: f['title'], dueAt: f['dueAt'] }, v.conversation.version),
      success: () => 'Task created: it’s on your Tasks.',
      failure: 'The Task wasn’t created',
    });
  }
}
