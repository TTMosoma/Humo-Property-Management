import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { IonIcon } from '@ionic/angular/standalone';
import {
  CATEGORY_LABELS,
  DocumentVisibility,
  LibraryCategory,
  LibraryDataSource,
  LibraryDocument,
  RECORD_KIND_LABELS,
  Scheme,
  RecordKind,
  VISIBILITY_LABELS,
  expiryState,
  formatBytes,
} from '../../domain';
import { loadable } from '../../core/data/loadable';
import { ScopeNotice } from '../../core/scope/scope-notice';
import { ScopeService } from '../../core/scope/scope.service';
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
import { expiryLabel, fileIcon } from './library-view';
import { uploadForm } from './library-forms';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { SessionService } from '../../core/session/session.service';

/**
 * Documents (review finding F20): a search over every document uploaded on a
 * record, with facets. Documents are added on their record (Attachments
 * panel), so the library has no upload button of its own.
 */
@Component({
  selector: 'app-library-page',
  imports: [PageHeader, ScopeNotice, ViewTabs, FilterBar, DataTable, CellDef, StatusPill, EmptyState, ErrorState, Skeleton, IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!fixedScheme()) {
      <ui-page-header eyebrow="Records" title="Documents" subtitle="Every document uploaded on a scheme, unit, person, supplier, job or meeting. Add documents on the record they belong to." />
      <app-scope-notice />
    } @else if (canUpload()) {
      <div class="tab-actions">
        <button type="button" class="btn btn-primary btn-sm" (click)="upload()"><ion-icon name="cloud-upload-outline" aria-hidden="true" /> Upload to {{ fixedScheme()!.name }}</button>
      </div>
    }

    <ui-view-tabs label="Document views" [tabs]="tabs()" [active]="state().view ?? 'all'" (activeChange)="patch({ view: $event })" />
    <ui-filter-bar
      searchLabel="Title, file name, record…"
      [filters]="filters()"
      [values]="{ category: state().category, kind: state().kind, visibility: state().visibility, scheme: state().scheme }"
      (valuesChange)="patch({ category: $event['category'] ?? null, kind: $event['kind'] ?? null, visibility: $event['visibility'] ?? null, scheme: $event['scheme'] ?? null })"
      [search]="state().q ?? ''"
      (searchChange)="patch({ q: $event })"
    />
    @if (recordFilter(); as rf) {
      <div class="record-filter">
        Showing documents on <strong>{{ rf }}</strong>
        <button type="button" class="link" (click)="patch({ record: null })">Show all</button>
      </div>
    }

    @if (result.loading()) {
      <ui-skeleton [count]="8" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load the library" (retry)="result.retry()" /></div>
    } @else if (rows().length === 0) {
      <div class="surface">
        @if (all().length === 0) {
          <ui-empty-state kind="first-use" illustration="empty-tray" title="No documents yet" message="Upload documents on the scheme, unit, supplier, job or meeting they belong to. They appear here with their links already set." />
        } @else {
          <ui-empty-state title="No documents match" message="Try another search or clear the filters." />
        }
      </div>
    } @else {
      <ui-data-table caption="Documents" [rows]="rows()" [columns]="columns" [rowId]="rowId" (rowClick)="open($event)" [muted]="isArchived">
        <ng-template uiCell="doc" let-d>
          <div class="doc">
            <ion-icon [name]="icon(d)" aria-hidden="true" />
            <div>
              <div class="title">{{ d.title }}</div>
              <div class="muted">{{ d.fileName }} · {{ size(d) }}</div>
            </div>
          </div>
        </ng-template>
        <ng-template uiCell="record" let-d>
          <div>{{ d.links[0]?.label }}</div>
          <div class="muted">{{ kindLabel(d) }}</div>
        </ng-template>
        <ng-template uiCell="category" let-d>{{ category(d) }}</ng-template>
        <ng-template uiCell="visibility" let-d><span class="muted">{{ visibility(d) }}</span></ng-template>
        <ng-template uiCell="expiry" let-d>
          @if (d.archived) {
            <ui-status-pill label="Archived" tone="neutral" />
          } @else if (expiry(d); as e) {
            <ui-status-pill [label]="e.label" [tone]="e.tone" />
          }
        </ng-template>
        <ng-template uiCell="uploaded" let-d>
          <div>{{ formatDate(d.uploadedAt, true) }}</div>
          <div class="muted">{{ d.uploadedBy }}</div>
        </ng-template>
      </ui-data-table>
    }
  `,
  styles: `
    :host { display: block; }
    .tab-actions { display: flex; justify-content: flex-end; margin-bottom: var(--s-3); }
    .doc { display: flex; gap: var(--s-2); align-items: flex-start; }
    .doc ion-icon { flex: none; margin-top: 2px; font-size: 18px; color: var(--c-text-muted); }
    .title { font-weight: var(--fw-medium); }
    .muted { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .record-filter { margin: 0 0 var(--s-3); font-size: var(--fs-sm); }
    .link { margin-left: var(--s-2); padding: 0; font: inherit; color: var(--c-primary-text); background: none; border: 0; cursor: pointer; }
  `,
})
export class LibraryPage {
  private readonly router = inject(Router);
  private readonly data = inject(LibraryDataSource);
  private readonly scope = inject(ScopeService);
  private readonly route = inject(ActivatedRoute);
  private readonly drawer = inject(DrawerService);
  private readonly session = inject(SessionService);

  /** As a scheme's Documents tab, the route passes the scheme. */
  protected readonly fixedScheme = toSignal(this.route.data.pipe(map((d) => d['scheme'] as Scheme | undefined)), {
    initialValue: this.route.snapshot.data['scheme'] as Scheme | undefined,
  });
  protected readonly canUpload = computed(() => this.session.can('Documents.Manage') && this.session.hasFeature('documents') && !this.session.readOnly());

  protected readonly state = urlState({ view: 'all', q: '', category: null, kind: null, visibility: null, scheme: null, record: null });

  protected readonly result = loadable(() => this.data.list(this.fixedScheme() ? [this.fixedScheme()!.id] : this.scope.effectiveIds()));
  protected readonly all = computed(() => [...(this.result.value() ?? [])].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)));

  protected readonly tabs = computed(() => {
    const docs = this.all();
    return [
      { id: 'all', label: 'Current', count: docs.filter((d) => !d.archived).length },
      { id: 'expiring', label: 'Expiring or expired', count: docs.filter((d) => !d.archived && ['expiring', 'expired'].includes(expiryState(d))).length },
      { id: 'archived', label: 'Archived', count: docs.filter((d) => d.archived).length },
    ];
  });

  protected readonly filters = computed<FilterDef[]>(() => {
    const docs = this.all();
    const present = <T extends string>(values: T[]) => [...new Set(values)];
    const schemes = this.scope.accessible().filter((s) => docs.some((d) => d.schemeIds.includes(s.id)));
    const out: FilterDef[] = [
      { key: 'category', label: 'Category', options: present(docs.map((d) => d.category)).map((c) => ({ value: c, label: CATEGORY_LABELS[c as LibraryCategory] })) },
      { key: 'kind', label: 'Record', options: present(docs.flatMap((d) => d.links.map((l) => l.kind))).map((k) => ({ value: k, label: RECORD_KIND_LABELS[k as RecordKind] })) },
      { key: 'visibility', label: 'Visible to', options: (Object.keys(VISIBILITY_LABELS) as DocumentVisibility[]).map((v) => ({ value: v, label: VISIBILITY_LABELS[v] })) },
    ];
    if (schemes.length > 1 && !this.fixedScheme()) out.push({ key: 'scheme', label: 'Scheme', options: schemes.map((s) => ({ value: s.id, label: s.name })) });
    return out;
  });

  /** "?record=scheme:kingfisher-court" from a record's "Open in the library". */
  protected readonly recordFilter = computed(() => {
    const r = this.state().record;
    if (!r) return null;
    const [kind, id] = r.split(':');
    return this.all().flatMap((d) => d.links).find((l) => l.kind === kind && l.id === id)?.label ?? id;
  });

  protected readonly rows = computed(() => {
    const s = this.state();
    const q = (s.q ?? '').trim().toLowerCase();
    const [rk, rid] = (s.record ?? '').split(':');
    return this.all().filter((d) => {
      if (s.view === 'archived' ? !d.archived : d.archived) return false;
      if (s.view === 'expiring' && !['expiring', 'expired'].includes(expiryState(d))) return false;
      if (s.category && d.category !== s.category) return false;
      if (s.kind && !d.links.some((l) => l.kind === s.kind)) return false;
      if (s.visibility && d.visibility !== s.visibility) return false;
      if (s.scheme && !d.schemeIds.includes(s.scheme)) return false;
      if (s.record && !d.links.some((l) => l.kind === rk && l.id === rid)) return false;
      if (q && !`${d.title} ${d.fileName} ${d.links.map((l) => l.label).join(' ')} ${d.notes ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  protected readonly columns: ColumnDef<LibraryDocument>[] = [
    { key: 'doc', header: 'Document', mobile: 'title', sort: (d) => d.title },
    { key: 'record', header: 'On', width: '22%', mobile: 'meta', sort: (d) => d.links[0]?.label ?? '' },
    { key: 'category', header: 'Category', width: '130px', sort: (d) => d.category },
    { key: 'visibility', header: 'Visible to', width: '150px', mobile: 'hidden' },
    { key: 'expiry', header: 'Expiry', width: '170px', sort: (d) => d.expiresAt ?? '9999' },
    { key: 'uploaded', header: 'Uploaded', width: '150px', sort: (d) => d.uploadedAt },
  ];

  protected readonly rowId = (d: LibraryDocument) => d.id;
  protected readonly isArchived = (d: LibraryDocument) => !!d.archived;
  protected readonly icon = fileIcon;
  protected readonly expiry = expiryLabel;
  protected readonly size = (d: LibraryDocument) => formatBytes(d.sizeBytes);
  protected readonly category = (d: LibraryDocument) => CATEGORY_LABELS[d.category];
  protected readonly visibility = (d: LibraryDocument) => VISIBILITY_LABELS[d.visibility];
  protected readonly kindLabel = (d: LibraryDocument) => (d.links[0] ? RECORD_KIND_LABELS[d.links[0].kind] : '');
  protected readonly formatDate = formatDate;

  protected patch(change: Partial<Record<'view' | 'q' | 'category' | 'kind' | 'visibility' | 'scheme' | 'record', string | null>>): void {
    this.state.update((s) => ({ ...s, ...change }));
  }

  protected upload(): void {
    const s = this.fixedScheme()!;
    uploadForm(this.drawer, this.data, { kind: 'scheme', id: s.id, label: s.name });
  }

  protected open(d: LibraryDocument): void {
    void this.router.navigate(['/documents', d.id]);
  }
}
