import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { CHANNEL_LABELS, CommunicationsDataSource, DELIVERY_STATUS_LABELS, Delivery, SENT_KIND_LABELS, SentView, renderMerge } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { formatDate } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { ChainLink } from '../../ui/record/relationship-chain';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { DELIVERY_TONE, deliverySummary, displaySubject } from './comms-view';

/** One sent message: what it said (as each person got it), to whom, by which channel, and whether it arrived. */
@Component({
  selector: 'app-sent-message-page',
  imports: [RecordHeader, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="4" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this message" (retry)="result.retry()" /></div>
    } @else if (!view()) {
      <div class="surface"><ui-empty-state illustration="not-found" title="We couldn’t find that message"><a class="btn btn-primary" routerLink="/communications/sent">Sent</a></ui-empty-state></div>
    } @else {
      @let v = view()!;
      <ui-record-header [eyebrow]="v.message.ref + ' · ' + kind()" [title]="subject(v)" [subtitle]="v.message.audienceLabel" [status]="status()" [facts]="facts()" [chain]="chain()">
        <ng-container recordActions>
          @if (canSend()) {
            @if (v.state === 'scheduled') {
              <button type="button" class="btn btn-secondary" (click)="cancel()">Cancel sending</button>
            }
            @if (v.counts.failed + v.counts.bounced) {
              <button type="button" class="btn btn-primary" (click)="retry()"><ion-icon name="refresh-outline" aria-hidden="true" /> Retry {{ v.counts.failed + v.counts.bounced }} not delivered</button>
            }
          }
        </ng-container>
      </ui-record-header>

      <div class="grid">
        <section class="surface panel">
          <h2 class="section-title">The message</h2>
          <p class="muted">@if (selected(); as d) { As {{ d.name }} got it, by {{ channel(d) }}. } @else { As sent. } Choose a recipient below to see theirs.</p>
          <div class="msg">
            @if (v.message.subject) { <div class="msg-subject">{{ render(v.message.subject) }}</div> }
            <div class="msg-body">{{ render(v.message.body) }}</div>
          </div>
          @if (v.message.source; as s) {
            <p class="muted">From <a [routerLink]="s.route">{{ s.label }}</a>.</p>
          }
        </section>
        @if (v.message.skipped.length) {
          <section class="surface panel">
            <h2 class="section-title">Couldn’t be reached ({{ v.message.skipped.length }})</h2>
            <ul class="skipped">
              @for (s of v.message.skipped; track s.personId + (s.unitLabel ?? '')) {
                <li><strong>{{ s.name }}</strong>@if (s.unitLabel) { · {{ s.unitLabel }} } <span class="muted">— {{ s.reason }}</span></li>
              }
            </ul>
          </section>
        }
      </div>

      <section class="surface panel">
        <h2 class="section-title">Deliveries</h2>
        <ui-data-table caption="Deliveries" [rows]="v.message.deliveries" [columns]="columns" [rowId]="rowId" [activeId]="selectedId()" (rowClick)="selectedId.set($event.id)">
          <ng-template uiCell="person" let-d>
            <div class="title">{{ d.name }}</div>
            @if (d.unitLabel) { <div class="muted">{{ d.unitLabel }}</div> }
          </ng-template>
          <ng-template uiCell="channel" let-d>
            <div>{{ channel(d) }}</div>
            <div class="muted">{{ d.address }}</div>
          </ng-template>
          <ng-template uiCell="status" let-d>
            <ui-status-pill [label]="statusLabel(d)" [tone]="tone(d)" />
            @if (d.error) { <div class="err">{{ d.error }}</div> }
          </ng-template>
          <ng-template uiCell="at" let-d>{{ formatDate(d.at, true) }} {{ time(d.at) }}</ng-template>
        </ui-data-table>
        @if (selected(); as d) {
          @if (d.hasLink) {
            <p class="muted small">
              The statement link sent to {{ d.name }} works for anyone holding it.
              <button type="button" class="btn btn-secondary btn-sm" (click)="revokeLink(d.id)"><ion-icon name="ban-outline" aria-hidden="true" /> Revoke the link</button>
            </p>
          }
        }
      </section>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 340px); gap: var(--s-4); align-items: start; }
    .panel { padding: var(--s-4) var(--s-5); }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .err { font-size: var(--fs-xs); color: var(--c-danger); }
    .title { font-weight: var(--fw-medium); }
    .msg { margin: var(--s-2) 0; padding: var(--s-3); background: var(--c-surface-sunken); border-radius: var(--r); }
    .msg-subject { margin-bottom: var(--s-2); font-weight: var(--fw-semibold); }
    .msg-body { font-size: var(--fs-sm); white-space: pre-line; }
    .skipped { margin: 0; padding: 0; list-style: none; font-size: var(--fs-sm); }
    .skipped li { padding: 4px 0; border-top: 1px solid var(--c-border); }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class SentMessagePage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(CommunicationsDataSource);
  private readonly feedback = inject(FeedbackService);
  private readonly session = inject(SessionService);

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('messageId')!)), { initialValue: this.route.snapshot.paramMap.get('messageId')! });
  protected readonly result = loadable(() => this.data.message(this.id()));
  protected readonly view = computed<SentView | undefined>(() => this.result.value());
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed(() => {
    const ds = this.view()?.message.deliveries ?? [];
    return ds.find((d) => d.id === this.selectedId()) ?? ds[0];
  });

  protected readonly kind = computed(() => (this.view() ? SENT_KIND_LABELS[this.view()!.message.kind] : ''));
  protected readonly status = computed(() => {
    const v = this.view();
    if (!v) return null;
    const s = deliverySummary(v);
    return { label: s.label, tone: s.tone };
  });
  protected readonly facts = computed<KeyFact[]>(() => {
    const v = this.view();
    if (!v) return [];
    const total = v.message.deliveries.length;
    return [
      { label: v.state === 'scheduled' ? 'Sends' : 'Sent', value: formatDate(v.message.sendAt, true), hint: v.message.sentBy },
      { label: 'Recipients', value: String(total), hint: v.message.skipped.length ? `${v.message.skipped.length} unreachable` : undefined },
      { label: 'Arrived', value: String(v.counts.delivered + v.counts.read), tone: 'success' },
      { label: 'Not delivered', value: String(v.counts.failed + v.counts.bounced), tone: v.counts.failed + v.counts.bounced ? 'danger' : 'default' },
    ];
  });
  protected readonly chain = computed<ChainLink[]>(() => {
    const v = this.view();
    return v ? [{ kind: 'Scheme', label: v.scheme.name, route: `/schemes/${v.scheme.id}/overview` }, { kind: 'Sent', label: 'Sent', route: '/communications/sent' }, { kind: 'Message', label: v.message.ref }] : [];
  });

  protected readonly columns: ColumnDef<Delivery>[] = [
    { key: 'person', header: 'To', mobile: 'title', sort: (d) => d.name },
    { key: 'channel', header: 'By', width: '220px' },
    { key: 'status', header: 'Status', width: '200px', sort: (d) => d.status },
    { key: 'at', header: 'At', width: '150px', sort: (d) => d.at },
  ];
  protected readonly rowId = (d: Delivery) => d.id;
  protected readonly formatDate = formatDate;
  protected readonly subject = displaySubject;
  protected readonly time = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });
  protected readonly channel = (d: Delivery) => CHANNEL_LABELS[d.channel];
  protected readonly statusLabel = (d: Delivery) => DELIVERY_STATUS_LABELS[d.status];
  protected readonly tone = (d: Delivery) => DELIVERY_TONE[d.status];
  protected readonly render = (text: string) => renderMerge(text, this.selected()?.values ?? {});
  protected readonly canSend = computed(() => this.session.can('Messages.Reply') && this.session.hasFeature('communications') && !this.session.readOnly());

  protected retry(): void {
    this.data.retry(this.view()!.message.id).subscribe({ next: () => this.feedback.success('Retried.'), error: () => this.feedback.error('The retry didn’t go out.') });
  }

  protected revokeLink(deliveryId: string): void {
    this.data.revokeLink(this.view()!.message.id, deliveryId).subscribe({ next: () => this.feedback.success('The link is revoked. It no longer opens the statement.'), error: () => this.feedback.error('The link wasn’t revoked.') });
  }

  protected cancel(): void {
    this.data.cancel(this.view()!.message.id).subscribe({ next: () => this.feedback.success('Cancelled: nothing will be sent.'), error: () => this.feedback.error('It wasn’t cancelled.') });
  }
}
