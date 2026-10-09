import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { CATEGORY_LABELS, COMPLIANCE_TYPE, LibraryDataSource, LibraryDocument, RECORD_KIND_LABELS, VISIBILITY_LABELS, formatBytes } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { loadable } from '../../core/data/loadable';
import { SessionService } from '../../core/session/session.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { formatDate } from '../../ui/format/money';
import { KeyFact, RecordHeader } from '../../ui/record/record-header';
import { ChainLink } from '../../ui/record/relationship-chain';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';
import { archiveDocumentForm, editDocumentForm, uploadForm } from './library-forms';
import { expiryLabel, fileIcon } from './library-view';

/** One document: what it is, which records it belongs to, who can see it, and what it's evidence for. */
@Component({
  selector: 'app-document-page',
  imports: [RecordHeader, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result.loading()) {
      <ui-skeleton variant="tiles" [count]="4" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this document" (retry)="result.retry()" /></div>
    } @else if (result.value() === false) {
      <div class="surface">
        <ui-empty-state illustration="not-found" title="We couldn’t find that document">
          <a class="btn btn-primary" routerLink="/documents">All documents</a>
        </ui-empty-state>
      </div>
    } @else {
      @let d = doc()!;
      <ui-record-header [eyebrow]="category()" [title]="d.title" [subtitle]="d.fileName + ' · ' + size()" [status]="status()" [facts]="facts()" [chain]="chain()">
        <ng-container recordActions>
          @if (url(); as u) {
            <a class="btn btn-primary" [href]="u" target="_blank" rel="noopener"><ion-icon [name]="icon(d)" aria-hidden="true" /> Open file</a>
          }
          @if (canManage()) {
            @if (!d.archived) {
              @if (d.compliance || d.supplierDoc) {
                <button type="button" class="btn btn-secondary" (click)="replace()"><ion-icon name="cloud-upload-outline" aria-hidden="true" /> Upload a newer one</button>
              }
              <button type="button" class="btn btn-ghost" (click)="edit()">Edit details</button>
              <button type="button" class="btn btn-ghost" (click)="archive()">Archive</button>
            } @else {
              <button type="button" class="btn btn-secondary" (click)="restore()">Restore</button>
            }
          }
        </ng-container>
      </ui-record-header>

      @if (d.archived) {
        <div class="note surface" role="note"><ion-icon name="archive-outline" aria-hidden="true" /> Archived {{ formatDate(d.archived.at) }} by {{ d.archived.by }}: {{ d.archived.reason }}</div>
      }

      <div class="grid">
        <section class="surface panel">
          <h2 class="section-title">The file</h2>
          @if (url(); as u) {
            @if (d.mimeType.startsWith('image/')) {
              <img class="preview" [src]="u" [alt]="d.title" />
            } @else {
              <p>Uploaded in this session. <a [href]="u" target="_blank" rel="noopener">Open {{ d.fileName }}</a>.</p>
            }
          } @else {
            <div class="placeholder">
              <ion-icon [name]="icon(d)" aria-hidden="true" />
              <div>
                <strong>{{ d.fileName }}</strong>
                <p class="muted">The prototype keeps a document’s details, not its file: files chosen in this session open until the page reloads. The API will store and serve the file.</p>
              </div>
            </div>
          }
          @if (d.notes) {
            <h3 class="sub">Notes</h3>
            <p>{{ d.notes }}</p>
          }
        </section>

        <aside class="side">
          <section class="surface panel">
            <h2 class="section-title">Belongs to</h2>
            <ul class="links">
              @for (l of d.links; track l.kind + l.id) {
                <li><span class="muted">{{ kindLabel(l.kind) }}</span> <a [routerLink]="l.route">{{ l.label }}</a></li>
              }
            </ul>
          </section>
          @if (d.compliance || d.supplierDoc) {
            <section class="surface panel">
              <h2 class="section-title">Compliance</h2>
              @if (d.compliance) {
                <p>Evidence for <strong>{{ complianceLabel() }}</strong>. Compliance warns 30 days before it expires.</p>
                @for (s of d.schemeIds; track s) {
                  <a [routerLink]="['/compliance', s + '.' + d.compliance]">Open the compliance item</a>
                }
              } @else {
                <p>The supplier’s <strong>{{ d.supplierDoc }}</strong>. Expired vetting documents block new work orders and show on each scheme’s compliance.</p>
                <a [routerLink]="d.links[0].route">Open the supplier</a>
              }
            </section>
          }
        </aside>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: var(--s-4); }
    .grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: var(--s-4); align-items: start; }
    .side { display: flex; flex-direction: column; gap: var(--s-4); }
    .panel { padding: var(--s-4) var(--s-5); }
    .section-title { margin: 0 0 var(--s-2); font-size: var(--fs-md); }
    .sub { margin: var(--s-4) 0 var(--s-1); font-size: var(--fs-sm); }
    p { margin: 0 0 var(--s-2); }
    .muted { font-size: var(--fs-sm); color: var(--c-text-muted); }
    .placeholder { display: flex; gap: var(--s-3); padding: var(--s-4); background: var(--c-surface-sunken); border-radius: var(--r); }
    .placeholder ion-icon { flex: none; font-size: 32px; color: var(--c-text-muted); }
    .placeholder p { margin: var(--s-1) 0 0; }
    .preview { max-width: 100%; border-radius: var(--r); }
    .links { margin: 0; padding: 0; list-style: none; }
    .links li { padding: var(--s-1) 0; }
    .note { display: flex; gap: var(--s-2); align-items: center; padding: var(--s-3) var(--s-4); font-size: var(--fs-sm); }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  `,
})
export class DocumentPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(LibraryDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly feedback = inject(FeedbackService);
  private readonly session = inject(SessionService);

  private readonly id = toSignal(this.route.paramMap.pipe(map((p) => p.get('docId')!)), { initialValue: this.route.snapshot.paramMap.get('docId')! });
  protected readonly result = loadable(() => this.data.get(this.id()).pipe(map((d) => d ?? (false as const))));
  protected readonly doc = computed<LibraryDocument | undefined>(() => this.result.value() || undefined);

  protected readonly canManage = computed(() => this.session.can('Documents.Manage') && this.session.hasFeature('documents') && !this.session.readOnly());
  protected readonly url = computed(() => (this.doc() ? this.data.contentUrl(this.doc()!.id) : null));
  protected readonly category = computed(() => (this.doc() ? CATEGORY_LABELS[this.doc()!.category] : ''));
  protected readonly size = computed(() => (this.doc() ? formatBytes(this.doc()!.sizeBytes) : ''));
  protected readonly complianceLabel = computed(() => (this.doc()?.compliance ? COMPLIANCE_TYPE[this.doc()!.compliance!].label : ''));
  protected readonly status = computed(() => {
    const d = this.doc();
    if (!d) return null;
    if (d.archived) return { label: 'Archived', tone: 'neutral' as const };
    return expiryLabel(d);
  });

  protected readonly facts = computed<KeyFact[]>(() => {
    const d = this.doc();
    if (!d) return [];
    return [
      { label: 'Uploaded', value: formatDate(d.uploadedAt, true), hint: d.uploadedBy },
      { label: 'Visible to', value: VISIBILITY_LABELS[d.visibility] },
      { label: 'Expires', value: d.expiresAt ? formatDate(d.expiresAt) : 'Doesn’t expire', tone: d.archived ? 'default' : expiryLabel(d)?.tone === 'danger' ? 'danger' : expiryLabel(d)?.tone === 'warning' ? 'warning' : 'default' },
      { label: 'Size', value: formatBytes(d.sizeBytes) },
    ];
  });

  protected readonly chain = computed<ChainLink[]>(() => {
    const d = this.doc();
    if (!d) return [];
    const first = d.links[0];
    return [{ kind: 'Documents', label: 'Library', route: '/documents' }, ...(first ? [{ kind: RECORD_KIND_LABELS[first.kind], label: first.label, route: first.route }] : []), { kind: 'Document', label: d.title }];
  });

  protected readonly formatDate = formatDate;
  protected readonly icon = fileIcon;
  protected readonly kindLabel = (k: keyof typeof RECORD_KIND_LABELS) => RECORD_KIND_LABELS[k];

  protected edit(): void {
    editDocumentForm(this.drawer, this.data, this.doc()!);
  }

  protected archive(): void {
    archiveDocumentForm(this.drawer, this.data, this.doc()!);
  }

  protected replace(): void {
    const d = this.doc()!;
    const l = d.links[0];
    uploadForm(this.drawer, this.data, { kind: l.kind, id: l.id, label: l.label }, { category: d.category, compliance: d.compliance, supplierDoc: d.supplierDoc, title: d.title });
  }

  protected restore(): void {
    const d = this.doc()!;
    this.data.act(d.id, { type: 'restore' }, d.version).subscribe({
      next: () => this.feedback.success('Restored.'),
      error: () => this.feedback.error('The document wasn’t restored.'),
    });
  }
}
