import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import {
  CHANNEL_LABELS,
  NOTICE_AUDIENCE_LABELS,
  NOTICE_CATEGORY_LABELS,
  NoticeAudience,
  NoticeCategory,
  NoticeDataSource,
  NoticeView,
  Scheme,
} from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
import { SessionService } from '../../core/session/session.service';
import { CellDef, ColumnDef, DataTable } from '../../ui/data-table/data-table';
import { urlState } from '../../ui/data-table/url-state';
import { ViewTabs } from '../../ui/data-table/view-tabs';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { REASON_FIELD, openForm } from '../shared/form-drawer';

/**
 * Communications › Notices: announcements to a scheme's residents, owners or
 * trustees. Publishing sends them by the agency's notification rules and puts
 * them in the resident portal. Also each scheme's Communications tab.
 */
@Component({
  selector: 'app-notices-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!fixedScheme()) {
      <ui-page-header eyebrow="Communications" title="Notices" subtitle="Announcements to a scheme’s owners, tenants or trustees. They appear in the resident portal and go out by your notification rules.">
        @if (canPublish()) {
          <button type="button" class="btn btn-primary" (click)="publish()"><ion-icon name="megaphone-outline" aria-hidden="true" /> New notice</button>
        }
      </ui-page-header>
      <app-scope-notice />
    } @else if (canPublish()) {
      <div class="tab-actions">
        <button type="button" class="btn btn-primary btn-sm" (click)="publish()"><ion-icon name="megaphone-outline" aria-hidden="true" /> New notice</button>
      </div>
    }

    <ui-view-tabs label="Notice views" [tabs]="tabs()" [active]="state().view ?? 'current'" (activeChange)="state.update((s) => ({ ...s, view: $event }))" />

    @if (result.loading()) {
      <ui-skeleton [count]="5" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load notices" (retry)="result.retry()" /></div>
    } @else if (!rows().length) {
      <div class="surface"><ui-empty-state kind="first-use" illustration="empty-tray" title="No notices here" message="Post a notice to tell a scheme’s residents about water outages, meetings, rules and security." /></div>
    } @else {
      <ui-data-table caption="Notices" [rows]="rows()" [columns]="columns()" [rowId]="rowId">
        <ng-template uiCell="notice" let-v>
          <div class="title">@if (v.notice.pinned && v.current) { <ion-icon name="pin-outline" aria-label="Pinned" /> }{{ v.notice.title }}</div>
          <div class="body">{{ v.notice.body }}</div>
          <div class="muted">{{ v.notice.ref }} · {{ category(v) }} · {{ v.notice.publishedBy }}</div>
        </ng-template>
        <ng-template uiCell="scheme" let-v>{{ v.scheme.name }}</ng-template>
        <ng-template uiCell="audience" let-v>
          <div>{{ audience(v) }}</div>
          <div class="muted">{{ v.notice.recipients }} people · {{ channels(v) }}</div>
        </ng-template>
        <ng-template uiCell="published" let-v>
          <div>{{ formatDate(v.notice.publishedAt, true) }}</div>
          @if (v.notice.withdrawn) {
            <ui-status-pill label="Withdrawn" tone="neutral" />
          } @else if (!v.current) {
            <ui-status-pill label="Ended" tone="neutral" />
          } @else if (v.notice.expiresAt) {
            <div class="muted">until {{ formatDate(v.notice.expiresAt, true) }}</div>
          }
        </ng-template>
        <ng-template uiCell="actions" let-v>
          @if (canPublish() && v.current) {
            <div class="acts">
              <button type="button" class="btn btn-ghost btn-sm" (click)="togglePin(v)">{{ v.notice.pinned ? 'Unpin' : 'Pin' }}</button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="withdraw(v)">Withdraw</button>
            </div>
          }
        </ng-template>
      </ui-data-table>
    }
  `,
  styles: `
    :host { display: block; }
    .tab-actions { display: flex; justify-content: flex-end; margin-bottom: var(--s-3); }
    .title { display: flex; gap: 6px; align-items: center; font-weight: var(--fw-medium); }
    .title ion-icon { color: var(--c-primary); }
    .body { display: -webkit-box; overflow: hidden; margin: 2px 0; font-size: var(--fs-sm); color: var(--c-text-2); -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .acts { display: flex; gap: 4px; justify-content: flex-end; }
  `,
})
export class NoticesPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly data = inject(NoticeDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  private readonly scope = inject(ScopeService);
  private readonly session = inject(SessionService);

  protected readonly fixedScheme = toSignal(this.route.data.pipe(map((d) => d['scheme'] as Scheme | undefined)), {
    initialValue: this.route.snapshot.data['scheme'] as Scheme | undefined,
  });
  protected readonly state = urlState({ view: 'current' });
  protected readonly result = loadable(() => this.data.list(this.fixedScheme() ? [this.fixedScheme()!.id] : this.scope.effectiveIds()));
  private readonly all = computed(() => this.result.value() ?? []);

  protected readonly tabs = computed(() => [
    { id: 'current', label: 'Current', count: this.all().filter((v) => v.current).length },
    { id: 'past', label: 'Ended or withdrawn' },
  ]);
  protected readonly rows = computed(() => this.all().filter((v) => (this.state().view === 'past' ? !v.current : v.current)));
  protected readonly columns = computed<ColumnDef<NoticeView>[]>(() => {
    const cols: ColumnDef<NoticeView>[] = [{ key: 'notice', header: 'Notice', mobile: 'title' }];
    if (!this.fixedScheme()) cols.push({ key: 'scheme', header: 'Scheme', width: '16%', mobile: 'meta', sort: (v) => v.scheme.name });
    cols.push(
      { key: 'audience', header: 'To', width: '200px' },
      { key: 'published', header: 'Published', width: '130px', sort: (v) => v.notice.publishedAt },
      { key: 'actions', header: '', align: 'end', width: '150px' },
    );
    return cols;
  });

  protected readonly canPublish = computed(() => this.session.can('Messages.Reply') && this.session.hasFeature('communications') && !this.session.readOnly());
  protected readonly rowId = (v: NoticeView) => v.notice.id;
  protected readonly formatDate = formatDate;
  protected readonly category = (v: NoticeView) => NOTICE_CATEGORY_LABELS[v.notice.category];
  protected readonly audience = (v: NoticeView) => NOTICE_AUDIENCE_LABELS[v.notice.audience];
  protected readonly channels = (v: NoticeView) => v.notice.sentBy.map((c) => CHANNEL_LABELS[c]).join(', ');

  constructor() {
    // "New notice" from quick actions arrives as ?new=1.
    if (this.route.snapshot.queryParamMap.get('new') === '1') {
      queueMicrotask(() => {
        if (this.canPublish()) this.publish();
        this.router.navigate([], { relativeTo: this.route, queryParams: { new: null }, queryParamsHandling: 'merge', replaceUrl: true });
      });
    }
  }

  protected publish(): void {
    const schemes = this.fixedScheme() ? [this.fixedScheme()!] : this.scope.accessible();
    openForm(this.drawer, {
      eyebrow: 'Notices',
      title: 'New notice',
      intro: 'It appears in the resident portal straight away and goes out by the channels in Settings › Notifications.',
      fields: [
        { key: 'schemeId', label: 'Scheme', type: 'select', required: true, options: schemes.map((s) => ({ value: s.id, label: s.name })) },
        { key: 'audience', label: 'To', type: 'select', required: true, half: true, options: (Object.keys(NOTICE_AUDIENCE_LABELS) as NoticeAudience[]).map((a) => ({ value: a, label: NOTICE_AUDIENCE_LABELS[a] })) },
        { key: 'category', label: 'About', type: 'select', required: true, half: true, options: (Object.keys(NOTICE_CATEGORY_LABELS) as NoticeCategory[]).map((c) => ({ value: c, label: NOTICE_CATEGORY_LABELS[c] })) },
        { key: 'title', label: 'Headline', type: 'text', required: true, placeholder: 'e.g. Water off on Thursday, 09:00–13:00' },
        { key: 'body', label: 'Notice', type: 'textarea', required: true, placeholder: 'What’s happening, when, and what people should do.' },
        { key: 'pinned', label: 'Pin to the top', type: 'select', required: true, half: true, options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes, until it ends' }] },
        { key: 'expiresAt', label: 'Ends on', type: 'date', half: true, help: 'Optional. After this it leaves the portal.' },
      ],
      initial: { schemeId: this.fixedScheme()?.id ?? this.scope.scopeId() ?? schemes[0]?.id ?? '', audience: 'residents', category: 'general', pinned: 'no' },
      submitLabel: 'Publish notice',
      submit: (v) => this.data.publish({ schemeId: v['schemeId'], title: v['title'], body: v['body'], audience: v['audience'] as NoticeAudience, category: v['category'] as NoticeCategory, pinned: v['pinned'] === 'yes', expiresAt: v['expiresAt'] || undefined }),
      success: () => 'Notice published.',
      failure: 'The notice wasn’t published',
    });
  }

  protected togglePin(v: NoticeView): void {
    this.data.act(v.notice.id, { type: v.notice.pinned ? 'unpin' : 'pin' }, v.notice.version).subscribe({
      next: () => this.feedback.success(v.notice.pinned ? 'Unpinned.' : 'Pinned.'),
      error: () => this.feedback.error('That didn’t work. Try again.'),
    });
  }

  protected withdraw(v: NoticeView): void {
    openForm(this.drawer, {
      eyebrow: v.notice.ref,
      title: 'Withdraw notice',
      intro: 'It leaves the resident portal. People who already received it by email or message aren’t told.',
      fields: [REASON_FIELD],
      submitLabel: 'Withdraw',
      submit: (f) => this.data.act(v.notice.id, { type: 'withdraw', reason: f['reason'] }, v.notice.version),
      success: () => 'Withdrawn.',
      failure: 'The notice wasn’t withdrawn',
    });
  }
}
