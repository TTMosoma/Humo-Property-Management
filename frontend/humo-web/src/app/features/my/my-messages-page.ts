import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { RouterLink } from '@angular/router';
import { CONVERSATION_STATUS_LABELS, ConversationView, InboxDataSource, describeFailure, fieldErrorsOf } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';

/** Resident portal › Messages: write to the managing agent, and see their replies. */
@Component({
  selector: 'app-my-messages-page',
  imports: [PageHeader, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Messages" subtitle="Write to your managing agent. They usually reply within one working day." />

    <section class="surface panel">
      <h2 class="section-title">{{ replyingTo() ? 'Reply' : 'New message' }}</h2>
      @if (replyingTo(); as r) {
        <p class="muted">To “{{ r.conversation.subject }}” <button type="button" class="link" (click)="replyingTo.set(null)">Start a new one instead</button></p>
      } @else {
        <label class="field">
          <span>About</span>
          <input type="text" [value]="subject()" (input)="subject.set($any($event.target).value)" placeholder="e.g. Clearance figures for my sale" />
          @if (errors()['subject']; as m) { <span class="err">{{ m }}</span> }
        </label>
      }
      <label class="field">
        <span>Message</span>
        <textarea rows="4" [value]="body()" (input)="body.set($any($event.target).value)"></textarea>
        @if (errors()['body']; as m) { <span class="err">{{ m }}</span> }
      </label>
      <p class="muted">For a problem in your unit or the building, <a routerLink="/my/requests/new">report it as a request</a> so it can be tracked to the fix.</p>
      <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="send()"><ion-icon name="send-outline" aria-hidden="true" /> {{ busy() ? 'Sending…' : 'Send' }}</button>
    </section>

    @if (result.loading()) {
      <ui-skeleton [count]="3" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load your messages" (retry)="result.retry()" /></div>
    } @else {
      @for (v of result.value() ?? []; track v.conversation.id) {
        <article class="surface panel conv">
          <header>
            <h2>{{ v.conversation.subject }}</h2>
            <span class="muted">{{ status(v) }}</span>
          </header>
          <ol class="messages">
            @for (m of v.conversation.messages; track m.id) {
              <li [class.us]="m.from === 'them'">
                <div class="bubble">{{ m.body }}</div>
                <div class="muted">{{ m.from === 'them' ? 'You' : m.by + ', ' + agency() }} · {{ formatDate(m.at, true) }}</div>
              </li>
            }
          </ol>
          @if (v.conversation.status !== 'closed') {
            <button type="button" class="btn btn-ghost btn-sm" (click)="replyingTo.set(v); scrollUp()">Reply</button>
          }
        </article>
      } @empty {
        <div class="surface"><ui-empty-state illustration="empty-tray" title="No messages yet" message="Questions about your levies, your unit or the scheme: write above." /></div>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-3); max-width: 760px; }
    .panel { display: flex; flex-direction: column; gap: var(--s-3); padding: var(--s-4) var(--s-5); }
    .section-title { margin: 0; font-size: var(--fs-md); }
    .field { display: flex; flex-direction: column; gap: 6px; font-size: var(--fs-sm); }
    .field > span:first-child { font-weight: var(--fw-medium); color: var(--c-text-2); }
    .muted { margin: 0; font-size: var(--fs-xs); color: var(--c-text-muted); }
    .err { font-size: var(--fs-xs); color: var(--c-danger); }
    .link { padding: 0; font: inherit; color: var(--c-primary-text); background: none; border: 0; cursor: pointer; }
    .btn-primary { align-self: flex-start; }
    .conv header { display: flex; justify-content: space-between; gap: var(--s-2); align-items: baseline; }
    .conv h2 { margin: 0; font-size: var(--fs-md); }
    .messages { display: flex; flex-direction: column; gap: var(--s-2); margin: 0; padding: 0; list-style: none; }
    .messages li { max-width: 85%; }
    .messages li.us { align-self: flex-end; text-align: right; }
    .bubble { padding: var(--s-2) var(--s-3); font-size: var(--fs-sm); text-align: left; white-space: pre-line; background: var(--c-surface-sunken); border-radius: var(--r-lg); }
    .us .bubble { background: var(--c-primary-soft); }
  `,
})
export class MyMessagesPage {
  private readonly data = inject(InboxDataSource);
  private readonly feedback = inject(FeedbackService);

  protected readonly result = loadable(() => this.data.mine());
  protected readonly replyingTo = signal<ConversationView | null>(null);
  protected readonly subject = signal('');
  protected readonly body = signal('');
  protected readonly busy = signal(false);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly formatDate = formatDate;
  protected readonly agency = computed(() => 'your managing agent');
  protected readonly status = (v: ConversationView) => (v.conversation.status === 'open' ? 'With the managing agent' : v.conversation.status === 'waiting' ? 'Replied' : CONVERSATION_STATUS_LABELS.closed);

  protected scrollUp(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected send(): void {
    this.busy.set(true);
    this.data.write({ subject: this.subject(), body: this.body(), conversationId: this.replyingTo()?.conversation.id }).subscribe({
      next: () => {
        this.busy.set(false);
        this.subject.set('');
        this.body.set('');
        this.errors.set({});
        this.replyingTo.set(null);
        this.feedback.success('Sent. Your managing agent will reply here.');
      },
      error: (e) => {
        this.busy.set(false);
        this.errors.set(fieldErrorsOf(e));
        this.feedback.error(describeFailure(e, 'Your message wasn’t sent'));
      },
    });
  }
}
