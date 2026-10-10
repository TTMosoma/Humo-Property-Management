import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { CHANNEL_LABELS, CommunicationsDataSource, SENT_KIND_LABELS, SentKind, SentView } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { FilterBar, FilterDef } from '../../ui/data-table/filter-bar';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { deliverySummary, displaySubject } from './comms-view';

/**
 * Communications › Sent: prove what was sent, to whom, when, and whether it
 * arrived. Composed messages, notices, collection letters, statements,
 * reminders and inbox replies, each with its deliveries.
 */
@Component({
  selector: 'app-sent-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, FilterBar, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header eyebrow="Communications" title="Sent" subtitle="Everything Humo Property Management sent to owners, tenants and trustees, and whether it arrived.">
      @if (canSend()) {
        <a class="btn btn-primary" routerLink="/communications/compose"><ion-icon name="create-outline" aria-hidden="true" /> Compose</a>
      }
    </ui-page-header>
    <app-scope-notice />

    <ui-view-tabs label="Sent views" [tabs]="tabs()" [active]="state().view ?? 'all'" (activeChange)="state.update((s) => ({ ...s, view: $event }))" />
    <ui-filter-bar searchLabel="Subject, reference, recipient…" [filters]="filters" [values]="{ kind: state().kind }" (valuesChange)="state.update((s) => ({ ...s, kind: $event['kind'] ?? null }))" [search]="state().q ?? ''" (searchChange)="state.update((s) => ({ ...s, q: $event }))" />

    @if (result.loading()) {
      <ui-skeleton [count]="8" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load what was sent" (retry)="result.retry()" /></div>
    } @else if (!rows().length) {
      <div class="surface"><ui-empty-state illustration="empty-tray" title="Nothing here" message="Messages, notices, letters and statements appear here once they’re sent." /></div>
    } @else {
      <ui-data-table caption="Sent" [rows]="rows()" [columns]="columns" [rowId]="rowId" (rowClick)="open($event)">
        <ng-template uiCell="message" let-v>
          <div class="title">{{ subject(v) }}</div>
          <div class="muted">{{ v.message.ref }} · {{ kind(v) }} · {{ v.message.audienceLabel }}</div>
        </ng-template>
        <ng-template uiCell="channels" let-v><span class="muted">{{ channels(v) }}</span></ng-template>
        <ng-template uiCell="when" let-v>
          <div>{{ formatDate(v.message.sendAt, true) }}</div>
          <div class="muted">{{ v.message.sentBy }}</div>
        </ng-template>
        <ng-template uiCell="delivery" let-v>
          @let d = summary(v);
          <ui-status-pill [label]="d.label" [tone]="d.tone" />
          <div class="muted">{{ d.detail }}</div>
        </ng-template>
      </ui-data-table>
    }
  `,
  styles: `
    :host { display: block; }
    .title { font-weight: var(--fw-medium); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
  `,
})
export class SentPage {
  private readonly router = inject(Router);
  private readonly data = inject(CommunicationsDataSource);
  private readonly scope = inject(ScopeService);
  private readonly session = inject(SessionService);

  protected readonly state = urlState({ view: 'all', kind: null, q: '' });
  protected readonly result = loadable(() => this.data.sent(this.scope.effectiveIds()));
  private readonly all = computed(() => this.result.value() ?? []);

  protected readonly tabs = computed(() => [
    { id: 'all', label: 'All', count: this.all().length },
    { id: 'problems', label: 'Not delivered', count: this.all().filter((v) => v.counts.failed + v.counts.bounced > 0).length },
    { id: 'scheduled', label: 'Scheduled', count: this.all().filter((v) => v.state === 'scheduled').length },
  ]);
  protected readonly filters: FilterDef[] = [{ key: 'kind', label: 'Kind', options: (Object.keys(SENT_KIND_LABELS) as SentKind[]).map((k) => ({ value: k, label: SENT_KIND_LABELS[k] })) }];

  protected readonly rows = computed(() => {
    const s = this.state();
    const q = (s.q ?? '').trim().toLowerCase();
    return this.all().filter((v) => {
      if (s.view === 'problems' && v.counts.failed + v.counts.bounced === 0) return false;
      if (s.view === 'scheduled' && v.state !== 'scheduled') return false;
      if (s.kind && v.message.kind !== s.kind) return false;
      if (q && !`${v.message.subject} ${v.message.ref} ${v.message.audienceLabel} ${v.message.deliveries.map((d) => d.name).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  protected readonly columns: ColumnDef<SentView>[] = [
    { key: 'message', header: 'Message', mobile: 'title', sort: (v) => v.message.subject },
    { key: 'channels', header: 'By', width: '170px', mobile: 'hidden' },
    { key: 'when', header: 'Sent', width: '150px', sort: (v) => v.message.sendAt },
    { key: 'delivery', header: 'Delivery', width: '200px', sort: (v) => v.counts.failed + v.counts.bounced },
  ];
  protected readonly rowId = (v: SentView) => v.message.id;
  protected readonly formatDate = formatDate;
  protected readonly kind = (v: SentView) => SENT_KIND_LABELS[v.message.kind];
  protected readonly channels = (v: SentView) => [...new Set(v.message.deliveries.map((d) => d.channel))].map((c) => CHANNEL_LABELS[c]).join(', ') || v.message.channels.map((c) => CHANNEL_LABELS[c]).join(', ');
  protected readonly summary = deliverySummary;
  protected readonly subject = displaySubject;
  protected readonly canSend = computed(() => this.session.can('Messages.Reply') && this.session.hasFeature('communications'));

  protected open(v: SentView): void {
    void this.router.navigate(['/communications/sent', v.message.id]);
  }
}
