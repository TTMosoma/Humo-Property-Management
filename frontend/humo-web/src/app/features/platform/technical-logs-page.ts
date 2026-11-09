import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { TechnicalLogDataSource, TechnicalLogEntry, TechnicalLogResult, describeFailure, saDate } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { StepUpService } from '../../core/security/step-up.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { StatusPill, Tone } from '../../ui/status-pill/status-pill';

const TIME = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const TONE: Record<string, Tone> = { Error: 'danger', Fatal: 'danger', Warning: 'warning', Information: 'neutral' };

/** Platform › Technical logs: what the API wrote, for Humo's System Administrators. Reading and downloading are both audited. */
@Component({
  selector: 'app-technical-logs-page',
  imports: [PageHeader, StatusPill, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Platform" title="Technical logs" subtitle="What the API recorded, kept for 30 days. For who did what, use the audit log.">
      <button type="button" class="btn btn-secondary" [disabled]="downloading()" (click)="download()">
        <ion-icon name="download-outline" aria-hidden="true" /> Download this day
      </button>
    </ui-page-header>

    <form class="filters" (submit)="$event.preventDefault(); load()">
      <label>Day <input type="date" [value]="date()" [max]="today" (change)="date.set($any($event.target).value); load()" /></label>
      <label>Level
        <select [value]="level()" (change)="level.set($any($event.target).value); load()">
          <option value="all">Everything</option>
          <option value="warning">Warnings and errors</option>
          <option value="error">Errors only</option>
        </select>
      </label>
      <label class="grow">Text or reference
        <input type="search" placeholder="e.g. Only PDF, /api/jobs, or a trace ID" [value]="search()" (input)="search.set($any($event.target).value)" />
      </label>
      <button type="submit" class="btn btn-primary">Search</button>
    </form>

    @if (failed()) {
      <p class="muted" role="alert">{{ failed() }}</p>
    } @else if (result(); as r) {
      <p class="muted small">
        @if (r.matched > r.entries.length) { Showing the newest {{ r.entries.length }} of {{ r.matched }}. Narrow the search, or download the day. }
        @else { {{ r.matched }} {{ r.matched === 1 ? 'entry' : 'entries' }}. }
      </p>
      <ul class="entries">
        @for (e of r.entries; track $index) {
          <li>
            <button type="button" class="line" [attr.aria-expanded]="open() === $index" (click)="open.set(open() === $index ? null : $index)">
              <span class="time">{{ time(e) }}</span>
              <ui-status-pill [label]="e.level" [tone]="tone(e)" />
              <span class="message">{{ e.message }}@if (e.refusal) { <span class="refusal">{{ e.refusal }}</span> }</span>
            </button>
            @if (open() === $index) { <pre>{{ pretty(e) }}</pre> }
          </li>
        } @empty {
          <li class="muted">Nothing for that day and search.</li>
        }
      </ul>
    } @else {
      <p class="muted">Loading…</p>
    }
  `,
  styles: `
    .filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--s-3); margin-bottom: var(--s-4); }
    .filters label { display: grid; gap: var(--s-1); font-size: var(--fs-sm); color: var(--c-text-muted); }
    .filters .grow { flex: 1 1 240px; }
    .entries { display: grid; gap: 2px; padding: 0; margin: 0; list-style: none; }
    .line { display: flex; align-items: baseline; gap: var(--s-3); width: 100%; padding: var(--s-2); text-align: left; background: none; border: 0; border-bottom: 1px solid var(--c-border); color: inherit; cursor: pointer; }
    .time { flex: none; font-family: monospace; font-size: var(--fs-xs); color: var(--c-text-muted); }
    .message { min-width: 0; font-family: monospace; font-size: var(--fs-xs); overflow-wrap: anywhere; }
    .refusal { display: block; margin-top: 2px; color: var(--c-text-2); }
    pre { padding: var(--s-3); margin: 0; overflow-x: auto; font-size: var(--fs-xs); white-space: pre-wrap; overflow-wrap: anywhere; background: var(--c-surface-2, rgba(127, 127, 127, 0.1)); }
  `,
})
export class TechnicalLogsPage {
  private readonly data = inject(TechnicalLogDataSource);
  private readonly stepUp = inject(StepUpService);
  private readonly feedback = inject(FeedbackService);

  protected readonly today = saDate(new Date());
  protected readonly date = signal(this.today);
  protected readonly level = signal('all');
  protected readonly search = signal('');
  protected readonly result = signal<TechnicalLogResult | null>(null);
  protected readonly failed = signal<string | null>(null);
  protected readonly open = signal<number | null>(null);
  protected readonly downloading = signal(false);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.open.set(null);
    this.failed.set(null);
    this.data.query({ date: this.date(), level: this.level(), search: this.search() }).subscribe({
      next: (r) => this.result.set(r),
      error: (e: unknown) => this.failed.set(describeFailure(e, 'The log couldn’t be read')),
    });
  }

  protected download(): void {
    const date = this.date();
    this.downloading.set(true);
    this.stepUp.guard({ action: 'export-data', detail: `Download the technical log for ${date}` }, () => this.data.download(date)).subscribe({
      next: (file) => this.feedback.success(`Downloaded ${file}. It’s recorded in the audit log.`),
      error: (e: unknown) => {
        this.downloading.set(false);
        this.feedback.error(describeFailure(e, 'The log wasn’t downloaded'));
      },
      complete: () => this.downloading.set(false),
    });
  }

  protected time(e: TechnicalLogEntry): string {
    return e.at ? TIME.format(new Date(e.at)) : '';
  }

  protected tone(e: TechnicalLogEntry): Tone {
    return TONE[e.level] ?? 'neutral';
  }

  protected pretty(e: TechnicalLogEntry): string {
    return JSON.stringify(JSON.parse(e.raw), null, 2);
  }
}
