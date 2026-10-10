import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { CATEGORY_LABELS, LibraryDataSource, LibraryDocument, RecordKind, VISIBILITY_LABELS } from '../../domain';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatDate } from '../../ui/format/money';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { UploadPreset, uploadForm } from './library-forms';
import { expiryLabel, fileIcon } from './library-view';

/**
 * Attachments panel (pattern P5): a record's documents, uploaded in context.
 * Everything here is also in the library, with this record already linked.
 *
 *   <app-attachments kind="scheme" [recordId]="scheme.id" [label]="scheme.name" />
 */
@Component({
  selector: 'app-attachments',
  imports: [StatusPill, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h2 class="section-title">{{ heading() }}</h2>
      @if (canUpload()) {
        <button type="button" class="btn btn-ghost btn-sm" (click)="upload()"><ion-icon name="cloud-upload-outline" aria-hidden="true" /> Upload</button>
      }
    </div>
    @if (result.loading()) {
      <p class="muted">Loading…</p>
    } @else if (result.failed()) {
      <p class="muted">Documents couldn’t be loaded. <button type="button" class="link" (click)="result.retry()">Try again</button></p>
    } @else {
      <ul class="docs">
        @for (d of current(); track d.id) {
          <li>
            <ion-icon [name]="icon(d)" aria-hidden="true" />
            <div class="d-main">
              <a [routerLink]="['/documents', d.id]">{{ d.title }}</a>
              <div class="muted">{{ category(d) }} · {{ visibility(d) }} · {{ formatDate(d.uploadedAt, true) }}</div>
            </div>
            @if (expiry(d); as e) {
              <ui-status-pill [label]="e.label" [tone]="e.tone" />
            }
          </li>
        } @empty {
          <li class="muted empty">No documents yet.@if (canUpload()) { Upload insurance, certificates, plans or letters here. }</li>
        }
      </ul>
      @if (archived().length) {
        <button type="button" class="link" (click)="showArchived.set(!showArchived())">{{ showArchived() ? 'Hide' : 'Show' }} {{ archived().length }} archived</button>
        @if (showArchived()) {
          <ul class="docs archived">
            @for (d of archived(); track d.id) {
              <li>
                <ion-icon name="archive-outline" aria-hidden="true" />
                <div class="d-main">
                  <a [routerLink]="['/documents', d.id]">{{ d.title }}</a>
                  <div class="muted">{{ d.archived!.reason }}</div>
                </div>
              </li>
            }
          </ul>
        }
      }
      <a class="all" routerLink="/documents" [queryParams]="{ record: kind() + ':' + recordId() }">Open in the library</a>
    }
  `,
  styles: `
    :host { display: block; }
    .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--s-2); }
    .section-title { margin: 0; font-size: var(--fs-md); }
    .docs { margin: 0; padding: 0; list-style: none; }
    .docs li { display: flex; align-items: flex-start; gap: var(--s-2); padding: var(--s-2) 0; border-top: 1px solid var(--c-border); }
    .docs li > ion-icon { flex: none; margin-top: 2px; color: var(--c-text-muted); }
    .d-main { flex: 1; min-width: 0; }
    .d-main a { font-weight: var(--fw-medium); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .empty { display: block !important; }
    .archived { opacity: 0.75; }
    .link { padding: 0; font: inherit; font-size: var(--fs-xs); color: var(--c-primary-text); background: none; border: 0; cursor: pointer; }
    .all { display: inline-block; margin-top: var(--s-2); font-size: var(--fs-xs); }
  `,
})
export class AttachmentsPanel {
  readonly kind = input.required<RecordKind>();
  readonly recordId = input.required<string>();
  /** The record's name, for the upload drawer. */
  readonly label = input.required<string>();
  readonly heading = input('Documents');
  /** What uploads default to here (e.g. vetting documents on a supplier). */
  readonly preset = input<UploadPreset>({});

  private readonly data = inject(LibraryDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly session = inject(SessionService);

  protected readonly result = loadable(() => this.data.forRecord(this.kind(), this.recordId()));
  private readonly all = computed(() => [...(this.result.value() ?? [])].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)));
  protected readonly current = computed(() => this.all().filter((d) => !d.archived));
  protected readonly archived = computed(() => this.all().filter((d) => d.archived));
  protected readonly showArchived = signal(false);

  protected readonly canUpload = computed(() => this.session.can('Documents.Manage') && this.session.hasFeature('documents') && !this.session.readOnly());
  protected readonly formatDate = formatDate;
  protected readonly icon = fileIcon;
  protected readonly expiry = expiryLabel;
  protected readonly category = (d: LibraryDocument) => CATEGORY_LABELS[d.category];
  protected readonly visibility = (d: LibraryDocument) => VISIBILITY_LABELS[d.visibility];

  protected upload(): void {
    uploadForm(this.drawer, this.data, { kind: this.kind(), id: this.recordId(), label: this.label() }, this.preset());
  }
}
