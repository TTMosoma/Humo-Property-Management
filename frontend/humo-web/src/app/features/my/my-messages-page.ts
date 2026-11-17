import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { InboxDataSource, ResidentConversation, describeFailure, fieldErrorsOf } from '../../domain';
import { byDay } from './message-days';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { relativeTime } from '../../ui/format/relative-time';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill, Tone } from '../../ui/status-pill/status-pill';

const TIME = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Resident portal › Messages: their conversations with the managing agent, as an inbox. The list on the left; the open
 * conversation on the right, read top to bottom, with the reply box under it. On a phone, one at a time. Only what the API
 * sends residents: their messages, the agency's replies, and the requests made from them.
 */
@Component({
  selector: 'app-my-messages-page',
  imports: [PageHeader, EmptyState, ErrorState, Skeleton, StatusPill, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Messages" [subtitle]="'Write to ' + agency() + '. They usually reply within one working day.'">
      @if (!composing() && conversations().length) {
        <a class="btn btn-primary" routerLink="/my/messages/new"><ion-icon name="create-outline" aria-hidden="true" /> New message</a>
      }
    </ui-page-header>

    @if (result.loading()) {
      <ui-skeleton [count]="3" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load your messages" (retry)="result.retry()" /></div>
    } @else {
      <div class="inbox" [class.open]="composing() || !!selectedId()">
        @if (conversations().length) {
          <nav class="list surface" aria-label="Your conversations">
            @for (c of conversations(); track c.id) {
              @let last = c.messages.at(-1);
              <a class="item" [routerLink]="['/my/messages', c.id]" [class.active]="c.id === selected()?.id" [attr.aria-current]="c.id === selected()?.id ? 'page' : null"
                [class.replied]="c.status === 'waiting'">
                <span class="item-top">
                  <span class="subject">{{ c.subject }}</span>
                  <span class="time">{{ relativeTime(c.lastAt) }}</span>
                </span>
                @if (last) {
                  <span class="snippet">{{ last.from === 'us' ? agency() + ': ' : 'You: ' }}{{ last.body }}</span>
                }
                <span class="item-foot">
                  <ui-status-pill [label]="statusLabel(c)" [tone]="statusTone(c)" />
                  @for (r of c.requests; track r.ref) { <span class="tag"><ion-icon name="construct-outline" aria-hidden="true" /> {{ r.ref }}</span> }
                </span>
              </a>
            }
          </nav>
        }

        <section class="pane surface" [attr.aria-label]="composing() ? 'New message' : (selected()?.subject ?? null)">
          @if (composing() || !conversations().length) {
            @if (conversations().length) {
              <a class="back" routerLink="/my/messages"><ion-icon name="chevron-back-outline" aria-hidden="true" /> All messages</a>
            }
            <div class="compose">
              <header>
                <h2>{{ conversations().length ? 'New message' : 'Write to ' + agency() }}</h2>
                <p class="muted">Questions about your levies, your account, your unit or the scheme. Your messages and their replies stay here.</p>
              </header>
              <label class="field">
                <span>About</span>
                <input type="text" [value]="subject()" (input)="subject.set($any($event.target).value)" placeholder="e.g. Clearance figures for my sale" />
                @if (errors()['subject']; as m) { <span class="err" role="alert">{{ m }}</span> }
              </label>
              <label class="field">
                <span>Message</span>
                <textarea rows="6" [value]="draft()" (input)="draft.set($any($event.target).value)"></textarea>
                @if (errors()['body']; as m) { <span class="err" role="alert">{{ m }}</span> }
              </label>
              <aside class="hint">
                <ion-icon name="construct-outline" aria-hidden="true" />
                <span>Something broken or leaking? <a routerLink="/my/requests/new">Report it as a request</a>: it’s tracked to the fix, and you see each step.</span>
              </aside>
              <div class="actions">
                <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="start()"><ion-icon name="send-outline" aria-hidden="true" /> {{ busy() ? 'Sending…' : 'Send' }}</button>
                @if (conversations().length) {
                  <a class="btn btn-ghost" routerLink="/my/messages">Cancel</a>
                }
              </div>
            </div>
          } @else if (selected(); as c) {
            <a class="back" routerLink="/my/messages"><ion-icon name="chevron-back-outline" aria-hidden="true" /> All messages</a>
            <header class="thread-head">
              <div>
                <p class="eyebrow">{{ c.ref }}</p>
                <h2>{{ c.subject }}</h2>
              </div>
              <ui-status-pill [label]="statusLabel(c)" [tone]="statusTone(c)" />
            </header>
            @if (c.requests.length) {
              <p class="linked" role="note">
                <ion-icon name="construct-outline" aria-hidden="true" />
                <span>
                  {{ agency() }} logged this as
                  @for (r of c.requests; track r.ref; let lastOne = $last) {
                    <a [routerLink]="['/my/requests', r.ref]">request {{ r.ref }}</a>{{ lastOne ? '' : ' and ' }}
                  }: follow the fix there.
                </span>
              </p>
            }
            <div #thread class="thread" tabindex="0" aria-label="Messages in this conversation">
              @for (day of days(); track day.label) {
                <div class="day"><span>{{ day.label }}</span></div>
                <ol class="messages">
                  @for (m of day.messages; track m.id) {
                    <li [class.mine]="m.from === 'them'">
                      <span class="who">{{ m.from === 'them' ? 'You' : m.by + ' · ' + agency() }}</span>
                      <div class="bubble">{{ m.body }}</div>
                      <span class="when">{{ time(m.at) }}</span>
                    </li>
                  }
                </ol>
              }
            </div>
            @if (c.status === 'closed') {
              <p class="closed" role="note">
                {{ agency() }} closed this conversation. Need more help? <a routerLink="/my/messages/new" [queryParams]="{ about: c.subject }">Write a new message</a>.
              </p>
            } @else {
              <div class="composer">
                <label class="sr-only" for="reply">Reply to {{ agency() }}</label>
                <textarea id="reply" rows="3" [placeholder]="'Reply to ' + agency() + '…'" [value]="reply()" (input)="reply.set($any($event.target).value)"
                  (keydown.control.enter)="answer(c)" (keydown.meta.enter)="answer(c)"></textarea>
                @if (errors()['body']; as m) { <span class="err" role="alert">{{ m }}</span> }
                <div class="composer-foot">
                  <span class="muted">{{ c.status === 'waiting' ? agency() + ' replied. Answer here if you need to.' : 'Waiting for ' + agency() + '. Add anything they should know.' }}</span>
                  <button type="button" class="btn btn-primary btn-sm" [disabled]="busy()" (click)="answer(c)"><ion-icon name="send-outline" aria-hidden="true" /> {{ busy() ? 'Sending…' : 'Send' }}</button>
                </div>
              </div>
            }
          } @else if (selectedId()) {
            <ui-empty-state illustration="not-found" title="We can’t find this conversation" message="It may belong to a unit you no longer live in.">
              <a class="btn btn-primary" routerLink="/my/messages">All messages</a>
            </ui-empty-state>
          } @else {
            <div class="pick">
              <ion-icon name="chatbubbles-outline" aria-hidden="true" />
              <p>Choose a conversation, or <a routerLink="/my/messages/new">write a new message</a>.</p>
            </div>
          }
        </section>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-3); max-width: 1120px; }
    .inbox { display: grid; grid-template-columns: minmax(260px, 340px) 1fr; gap: var(--s-3); align-items: start; }
    .inbox:not(:has(.list)) { grid-template-columns: 1fr; max-width: 760px; }

    .list { display: flex; flex-direction: column; overflow: hidden; }
    .item { display: flex; flex-direction: column; gap: 4px; padding: var(--s-3) var(--s-4); color: inherit; text-decoration: none; border-bottom: 1px solid var(--c-border); border-left: 3px solid transparent; }
    .item:last-child { border-bottom: 0; }
    .item:hover { background: var(--c-surface-hover); }
    .item:focus-visible { outline: 2px solid var(--c-primary); outline-offset: -2px; }
    .item.active { background: var(--c-primary-soft); border-left-color: var(--c-primary); }
    .item-top { display: flex; gap: var(--s-2); justify-content: space-between; align-items: baseline; }
    .subject { overflow: hidden; font-size: var(--fs-sm); font-weight: var(--fw-medium); text-overflow: ellipsis; white-space: nowrap; }
    .replied .subject { font-weight: var(--fw-semibold); }
    .time { flex: none; font-size: var(--fs-xs); color: var(--c-text-faint); }
    .snippet { display: -webkit-box; overflow: hidden; font-size: var(--fs-xs); color: var(--c-text-muted); -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .item-foot { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; margin-top: 2px; }
    .tag { display: inline-flex; gap: 4px; align-items: center; font-size: var(--fs-2xs); color: var(--c-text-muted); }

    .pane { display: flex; flex-direction: column; gap: var(--s-3); min-height: 420px; padding: var(--s-4) var(--s-5); }
    .back { display: none; gap: 4px; align-items: center; font-size: var(--fs-sm); color: var(--c-primary-text); text-decoration: none; }
    .thread-head { display: flex; gap: var(--s-3); justify-content: space-between; align-items: flex-start; padding-bottom: var(--s-3); border-bottom: 1px solid var(--c-border); }
    .eyebrow { margin: 0 0 2px; font-size: var(--fs-2xs); font-weight: var(--fw-medium); letter-spacing: 0.04em; color: var(--c-text-faint); text-transform: uppercase; }
    h2 { margin: 0; font-size: var(--fs-lg); }
    .linked { display: flex; gap: var(--s-2); align-items: flex-start; margin: 0; padding: var(--s-2) var(--s-3); font-size: var(--fs-sm); background: var(--c-surface-sunken); border-radius: var(--r); }
    .linked ion-icon { flex: none; margin-top: 3px; color: var(--c-primary-text); }

    .thread { display: flex; flex-direction: column; gap: var(--s-2); max-height: min(60vh, 560px); padding-right: var(--s-1); overflow-y: auto; }
    .thread:focus-visible { outline: 2px solid var(--c-primary); outline-offset: 2px; border-radius: var(--r); }
    .day { display: flex; gap: var(--s-3); align-items: center; margin: var(--s-2) 0; font-size: var(--fs-2xs); color: var(--c-text-faint); }
    .day::before, .day::after { content: ''; flex: 1; height: 1px; background: var(--c-border); }
    .messages { display: flex; flex-direction: column; gap: var(--s-3); margin: 0; padding: 0; list-style: none; }
    .messages li { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; max-width: 80%; }
    .messages li.mine { align-self: flex-end; align-items: flex-end; }
    .who { font-size: var(--fs-2xs); font-weight: var(--fw-medium); color: var(--c-text-muted); }
    .bubble { padding: var(--s-2) var(--s-3); font-size: var(--fs-sm); line-height: 1.5; white-space: pre-line; background: var(--c-surface-sunken); border-radius: var(--r-lg); border-top-left-radius: 4px; }
    .mine .bubble { color: var(--c-text); background: var(--c-primary-soft); border-top-left-radius: var(--r-lg); border-top-right-radius: 4px; }
    .when { font-size: var(--fs-2xs); color: var(--c-text-faint); }

    .composer { display: flex; flex-direction: column; gap: var(--s-2); margin-top: auto; padding-top: var(--s-3); border-top: 1px solid var(--c-border); }
    /* The same fields as Report a problem. */
    .composer textarea, .field input, .field textarea {
      width: 100%; padding: var(--s-2) var(--s-3); font: inherit; color: var(--c-text); background: var(--c-surface);
      border: 1px solid var(--c-border-strong); border-radius: var(--r); resize: vertical;
    }
    .field input { height: 40px; padding-block: 0; }
    .composer textarea:focus, .field input:focus, .field textarea:focus { border-color: var(--c-focus); outline: none; box-shadow: 0 0 0 3px var(--c-accent-soft); }
    .composer-foot { display: flex; gap: var(--s-3); justify-content: space-between; align-items: center; }
    .closed { margin: auto 0 0; padding: var(--s-3); font-size: var(--fs-sm); color: var(--c-text-muted); background: var(--c-surface-sunken); border-radius: var(--r); }

    .compose { display: flex; flex-direction: column; gap: var(--s-3); }
    .compose header p { margin: 4px 0 0; }
    .field { display: flex; flex-direction: column; gap: 6px; font-size: var(--fs-sm); }
    .field > span:first-child { font-weight: var(--fw-medium); color: var(--c-text-2); }
    .hint { display: flex; gap: var(--s-2); align-items: flex-start; padding: var(--s-2) var(--s-3); font-size: var(--fs-sm); background: var(--c-surface-sunken); border-radius: var(--r); }
    .hint ion-icon { flex: none; margin-top: 3px; color: var(--c-primary-text); }
    .actions { display: flex; gap: var(--s-2); }

    .pick { display: flex; flex: 1; flex-direction: column; gap: var(--s-2); place-content: center; align-items: center; color: var(--c-text-muted); text-align: center; }
    .pick ion-icon { font-size: 36px; color: var(--c-text-faint); }
    .muted { margin: 0; font-size: var(--fs-xs); color: var(--c-text-muted); }
    .err { font-size: var(--fs-xs); color: var(--c-danger); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

    /* A phone: the list, or one conversation, at a time. */
    @media (max-width: 900px) {
      .inbox { grid-template-columns: 1fr; }
      .inbox.open .list { display: none; }
      .inbox:not(.open) .pane:has(.pick) { display: none; }
      .back { display: inline-flex; }
      .pane { min-height: 0; padding: var(--s-4); }
      .messages li { max-width: 90%; }
      .thread { max-height: none; overflow: visible; }
      .thread-head { flex-direction: column; gap: var(--s-2); }
      .composer-foot { flex-wrap: wrap; }
    }
  `,
})
export class MyMessagesPage {
  private readonly data = inject(InboxDataSource);
  private readonly feedback = inject(FeedbackService);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  private readonly route = inject(ActivatedRoute);

  protected readonly result = loadable(() => this.data.mine());
  protected readonly conversations = computed(() => this.result.value() ?? []);
  /** The managing agent by name, as residents know them. */
  protected readonly agency = computed(() => this.session.organisation()?.shortName ?? 'your managing agent');

  private readonly params = toSignal(this.route.paramMap.pipe(map((p) => p.get('id'))), { initialValue: null });
  private readonly about = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('about'))), { initialValue: null });
  protected readonly composing = computed(() => this.route.snapshot.routeConfig?.path === 'messages/new');
  protected readonly selectedId = computed(() => (this.composing() ? null : this.params()));
  /** The open conversation: the one in the address, or on a wide screen the newest. */
  protected readonly selected = computed(() => {
    if (this.composing()) return undefined;
    const all = this.conversations();
    const id = this.selectedId();
    if (id) return all.find((c) => c.id === id || c.ref === id);
    return this.wide ? all[0] : undefined;
  });
  protected readonly days = computed(() => byDay(this.selected()?.messages ?? []));

  protected readonly subject = signal('');
  protected readonly draft = signal('');
  protected readonly reply = signal('');
  protected readonly busy = signal(false);
  protected readonly errors = signal<Record<string, string>>({});
  protected readonly relativeTime = relativeTime;
  protected readonly time = (iso: string) => TIME.format(new Date(iso));

  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');
  private readonly wide = typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 901px)').matches;

  constructor() {
    // "Write a new message" after a closed one starts from its subject.
    effect(() => {
      const about = this.about();
      if (this.composing() && about) this.subject.set(about.startsWith('Re: ') ? about : `Re: ${about}`);
    });
    // A different conversation: a fresh reply box, and the newest message in view.
    effect(() => {
      const id = this.selected()?.id;
      void this.selected()?.messages.length;
      const el = this.thread()?.nativeElement;
      if (!id || !el) return;
      queueMicrotask(() => (el.scrollTop = el.scrollHeight));
    });
    effect(() => {
      this.selectedId();
      this.reply.set('');
      this.errors.set({});
    });
  }

  protected statusLabel(c: ResidentConversation): string {
    return c.status === 'waiting' ? `${this.agency()} replied` : c.status === 'closed' ? 'Closed' : `Waiting for ${this.agency()}`;
  }

  protected statusTone(c: ResidentConversation): Tone {
    return c.status === 'waiting' ? 'accent' : c.status === 'closed' ? 'neutral' : 'info';
  }

  protected start(): void {
    this.send({ subject: this.subject(), body: this.draft() }, (id) => {
      this.subject.set('');
      this.draft.set('');
      void this.router.navigate(['/my/messages', id]);
    }, `Sent. ${this.agency()} will reply here.`);
  }

  protected answer(c: ResidentConversation): void {
    if (this.busy()) return;
    this.send({ subject: '', body: this.reply(), conversationId: c.id }, () => this.reply.set(''), 'Sent.');
  }

  private send(message: { subject: string; body: string; conversationId?: string }, done: (id: string) => void, confirmation: string): void {
    this.busy.set(true);
    this.data.write(message).subscribe({
      next: (id) => {
        this.busy.set(false);
        this.errors.set({});
        done(id);
        void this.feedback.success(confirmation);
      },
      error: (e) => {
        this.busy.set(false);
        this.errors.set(fieldErrorsOf(e));
        void this.feedback.error(describeFailure(e, 'Your message wasn’t sent'));
      },
    });
  }
}
