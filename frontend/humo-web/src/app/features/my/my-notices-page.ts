import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { NOTICE_CATEGORY_LABELS, NoticeDataSource, NoticeView } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';

const ICON: Record<string, string> = { general: 'megaphone-outline', maintenance: 'construct-outline', meeting: 'people-outline', finance: 'wallet-outline', security: 'shield-checkmark-outline', rules: 'document-text-outline' };

/** Resident portal › Notices: what the managing agent and trustees have announced, pinned ones first. */
@Component({
  selector: 'app-my-notices-page',
  imports: [PageHeader, EmptyState, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Notices" subtitle="Announcements from your managing agent and trustees." />
    @if (result.loading()) {
      <ui-skeleton [count]="4" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load notices" (retry)="result.retry()" /></div>
    } @else {
      @for (v of result.value() ?? []; track v.notice.id) {
        <article class="surface notice" [class.pinned]="v.notice.pinned">
          <header>
            <ion-icon [name]="icon(v)" aria-hidden="true" />
            <div>
              <h2>{{ v.notice.title }}</h2>
              <div class="meta">
                @if (v.notice.pinned) { <span class="pin">Pinned · </span> }
                {{ category(v) }} · {{ formatDate(v.notice.publishedAt) }} · {{ v.notice.publishedBy }}
              </div>
            </div>
          </header>
          <p>{{ v.notice.body }}</p>
          @if (v.notice.expiresAt) { <p class="until">Until {{ formatDate(v.notice.expiresAt) }}</p> }
        </article>
      } @empty {
        <div class="surface"><ui-empty-state illustration="empty-tray" title="No notices right now" message="When your managing agent or trustees post a notice, it appears here and we’ll let you know." /></div>
      }
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-3); max-width: 760px; }
    .notice { padding: var(--s-4) var(--s-5); }
    .notice.pinned { border-left: 4px solid var(--c-primary); }
    header { display: flex; gap: var(--s-3); align-items: flex-start; }
    header ion-icon { flex: none; margin-top: 2px; font-size: 20px; color: var(--c-primary); }
    h2 { margin: 0; font-size: var(--fs-md); }
    .meta { margin-top: 2px; font-size: var(--fs-xs); color: var(--c-text-muted); }
    .pin { font-weight: var(--fw-semibold); color: var(--c-primary-text); }
    p { margin: var(--s-3) 0 0; line-height: 1.55; }
    .until { font-size: var(--fs-xs); color: var(--c-text-muted); }
  `,
})
export class MyNoticesPage {
  private readonly data = inject(NoticeDataSource);
  protected readonly result = loadable(() => this.data.mine());
  protected readonly formatDate = formatDate;
  protected readonly icon = (v: NoticeView) => ICON[v.notice.category] ?? 'megaphone-outline';
  protected readonly category = (v: NoticeView) => NOTICE_CATEGORY_LABELS[v.notice.category];
}
