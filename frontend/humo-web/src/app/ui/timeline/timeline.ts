import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { TimelineEvent, TimelineKind } from '../../domain';
import { RandPipe } from '../format/money';

const ICON: Record<TimelineKind, string> = {
  payment: 'cash-outline',
  charge: 'receipt-outline',
  message: 'chatbubbles-outline',
  call: 'call-outline',
  note: 'create-outline',
  maintenance: 'construct-outline',
  document: 'document-text-outline',
  statement: 'mail-outline',
  status: 'flag-outline',
};

const DAY = new Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Timeline (pattern P4): one chronological stream of money, messages,
 * maintenance, statements, notes and calls for any record. Grouped by day,
 * newest first, with links back to the source record.
 */
@Component({
  selector: 'ui-timeline',
  imports: [IonIcon, RouterLink, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (g of groups(); track g.day) {
      <div class="day">{{ g.day }}</div>
      <ol>
        @for (e of g.events; track e.id) {
          <li [class]="'k-' + e.kind">
            <span class="icon"><ion-icon [name]="icon[e.kind]" aria-hidden="true" /></span>
            <div class="body">
              <div class="line">
                @if (e.link) {
                  <a class="title" [routerLink]="e.link">{{ e.title }}</a>
                } @else {
                  <span class="title">{{ e.title }}</span>
                }
                @if (e.amount !== undefined) {
                  <span class="money amount" [class.credit]="e.kind === 'payment'">{{ e.kind === 'payment' ? '−' : '' }}{{ e.amount | rand }}</span>
                }
              </div>
              @if (e.detail) {
                <p class="detail">{{ e.detail }}</p>
              }
              <div class="meta">{{ time(e.at) }}@if (e.actor) { · {{ e.actor }} }</div>
            </div>
          </li>
        }
      </ol>
    } @empty {
      <p class="empty">Nothing has happened here yet.</p>
    }
    @if (events().length > limit()) {
      <button type="button" class="btn btn-ghost btn-sm more" (click)="shown.set(limit() + 15)">
        Show older ({{ events().length - limit() }})
      </button>
    }
  `,
  styles: `
    :host { display: block; }
    .day { margin: var(--s-4) 0 var(--s-2); font-family: var(--font-display); font-size: var(--fs-2xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--c-text-muted); }
    .day:first-child { margin-top: 0; }
    ol { position: relative; margin: 0; padding: 0; list-style: none; }
    ol::before { content: ''; position: absolute; left: 15px; top: 8px; bottom: 8px; width: 1px; background: var(--c-border); }
    li { position: relative; display: flex; gap: var(--s-3); padding: var(--s-2) 0; }
    .icon {
      position: relative; z-index: 1; display: grid; flex: none; place-items: center; width: 32px; height: 32px;
      font-size: 15px; color: var(--c-text-muted); background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 50%;
    }
    .k-payment .icon { color: var(--c-success); background: var(--c-success-soft); border-color: transparent; }
    .k-call .icon, .k-note .icon { color: var(--c-primary-text); background: var(--c-primary-soft); border-color: transparent; }
    .k-maintenance .icon { color: var(--c-warning); background: var(--c-warning-soft); border-color: transparent; }
    .body { flex: 1; min-width: 0; padding-top: 5px; }
    .line { display: flex; gap: var(--s-3); justify-content: space-between; align-items: baseline; }
    .title { font-weight: var(--fw-medium); color: var(--c-text); }
    a.title:hover { color: var(--c-primary-text); }
    .amount { flex: none; font-size: var(--fs-sm); color: var(--c-text-2); }
    .amount.credit { color: var(--c-success); }
    .detail { margin-top: 2px; font-size: var(--fs-sm); color: var(--c-text-2); white-space: pre-line; }
    .meta { margin-top: 2px; font-size: var(--fs-xs); color: var(--c-text-faint); }
    .empty { color: var(--c-text-muted); font-size: var(--fs-sm); }
    .more { margin-top: var(--s-2); }
  `,
})
export class Timeline {
  readonly events = input.required<TimelineEvent[]>();
  readonly initial = input(12);

  protected readonly icon = ICON;
  protected readonly shown = signal(0);

  protected readonly limit = computed(() => this.shown() || this.initial());

  protected readonly groups = computed(() => {
    const limit = this.limit();
    const out: { day: string; events: TimelineEvent[] }[] = [];
    for (const e of this.events().slice(0, limit)) {
      const day = this.dayLabel(e.at);
      const last = out.at(-1);
      if (last && last.day === day) last.events.push(e);
      else out.push({ day, events: [e] });
    }
    return out;
  });

  protected time(iso: string): string {
    return TIME.format(new Date(iso));
  }

  private dayLabel(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    if (d.getTime() >= start) return 'Today';
    if (d.getTime() >= start - 86_400_000) return 'Yesterday';
    return DAY.format(d);
  }
}
