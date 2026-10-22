import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { CATEGORY_LABELS, LibraryDataSource, LibraryDocument, formatBytes } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { formatDate } from '../../ui/format/money';
import { PageHeader } from '../../ui/page-header/page-header';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { fileIcon } from '../library/library-view';
import { openDocumentFile } from '../library/open-document';

/**
 * Resident portal › Documents: what the agency has shared — the scheme's rules,
 * notices and minutes with owners, and documents about the resident's own unit.
 * Staff-only and trustee documents never reach here (the API filters by visibility).
 */
@Component({
  selector: 'app-my-documents-page',
  imports: [PageHeader, EmptyState, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header title="Documents" [subtitle]="isOwner() ? 'Your scheme’s rules and papers, and documents about your unit.' : 'Documents about your unit.'" />
    @if (result.loading()) {
      <ui-skeleton [count]="5" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load your documents" (retry)="result.retry()" /></div>
    } @else if (!(result.value() ?? []).length) {
      <div class="surface"><ui-empty-state illustration="empty-tray" title="Nothing shared yet" message="When your managing agent shares a document with you, it appears here." /></div>
    } @else {
      @for (g of groups(); track g.label) {
        @if (g.docs.length) {
          <section class="surface panel">
            <h2 class="section-title">{{ g.label }}</h2>
            <ul>
              @for (d of g.docs; track d.id) {
                <li>
                  <ion-icon [name]="icon(d)" aria-hidden="true" />
                  <div class="d-main">
                    <button type="button" class="btn btn-ghost btn-sm" (click)="openFile(d)">{{ d.title }}</button>
                    <div class="muted">{{ category(d) }} · {{ formatDate(d.uploadedAt) }} · {{ size(d) }}</div>
                  </div>
                </li>
              }
            </ul>
          </section>
        }
      }
      <p class="note">Need a copy of something you don’t see here? Ask your managing agent.</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-3); max-width: 760px; }
    .panel { padding: var(--s-4) var(--s-5); }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    ul { margin: 0; padding: 0; list-style: none; }
    li { display: flex; gap: var(--s-3); align-items: flex-start; padding: var(--s-3) 0; border-top: 1px solid var(--c-border); }
    li ion-icon { flex: none; margin-top: 2px; font-size: 20px; color: var(--c-text-muted); }
    .d-main { flex: 1; min-width: 0; }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .note { margin: 0; font-size: var(--fs-sm); color: var(--c-text-muted); }
  `,
})
export class MyDocumentsPage {
  private readonly data = inject(LibraryDataSource);
  private readonly session = inject(SessionService);

  protected readonly result = loadable(() => this.data.mine());
  protected readonly isOwner = computed(() => this.session.role() === 'owner');
  protected readonly groups = computed(() => {
    const docs = this.result.value() ?? [];
    return [
      { label: 'My unit', docs: docs.filter((d) => d.visibility === 'unit') },
      { label: 'The scheme', docs: docs.filter((d) => d.visibility === 'owners') },
    ];
  });
  protected readonly formatDate = formatDate;
  protected readonly icon = fileIcon;
  protected openFile(d: LibraryDocument): void {
    openDocumentFile(this.data, d.id);
  }
  protected readonly category = (d: LibraryDocument) => CATEGORY_LABELS[d.category];
  protected readonly size = (d: LibraryDocument) => formatBytes(d.sizeBytes);
}
