import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { MeetingDataSource } from '../../domain';
import { DocumentTemplatesService } from '../../core/documents/document-templates.service';
import { loadable } from '../../core/data/loadable';
import { DocumentData, DocumentRenderer } from '../documents/document-renderer';
import { EmptyState } from '../../ui/states/empty-state';
import { ErrorState } from '../../ui/states/error-state';
import { Skeleton } from '../../ui/states/skeleton';

/**
 * A meeting's notice or minutes as the A4 document. Once issued (notice sent,
 * minutes approved) it renders with the template version it was issued with;
 * before that, with the organisation's current default, marked as a draft.
 */
@Component({
  selector: 'app-meeting-document-page',
  imports: [DocumentRenderer, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result.loading()) {
      <ui-skeleton [count]="10" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this document" (retry)="result.retry()" /></div>
    } @else if (!detail() || !doc()) {
      <div class="surface"><ui-empty-state illustration="not-found" title="No such document" message="Minutes exist once the meeting has been held." /></div>
    } @else {
      <div class="toolbar no-print">
        <a class="btn btn-ghost btn-sm" [routerLink]="['..']"><ion-icon name="chevron-back-outline" aria-hidden="true" /> {{ detail()!.meeting.title }}</a>
        <div class="right">
          @if (template(); as t) {
            <span class="muted">{{ t.template.name }} v{{ t.version.version }} · {{ issued() ? 'as issued' : 'draft, your current default' }}</span>
          }
          <button type="button" class="btn btn-primary" (click)="print()"><ion-icon name="print-outline" aria-hidden="true" /> Print or save PDF</button>
        </div>
      </div>
      @if (template(); as t) {
        @if (registry.settings(); as settings) {
          <app-document-renderer [data]="doc()!" [template]="t" [settings]="settings" />
        }
      } @else {
        <ui-skeleton [count]="10" />
      }
    }
  `,
  styles: `
    :host { display: block; }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-5); }
    .right { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); }
    .muted { font-size: var(--fs-sm); color: var(--c-text-muted); }
  `,
})
export class MeetingDocumentPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(MeetingDataSource);
  protected readonly registry = inject(DocumentTemplatesService);

  private readonly kind = (this.route.snapshot.data['document'] as 'meeting-notice' | 'meeting-minutes') ?? 'meeting-notice';
  private readonly id = toSignal(this.route.parent!.paramMap.pipe(map((p) => p.get('meetingId')!)), { initialValue: this.route.parent!.snapshot.paramMap.get('meetingId')! });

  protected readonly result = loadable(() => this.data.get(this.id()));
  protected readonly detail = computed(() => this.result.value());

  protected readonly doc = computed<DocumentData | undefined>(() => {
    const d = this.detail();
    if (!d) return undefined;
    if (this.kind === 'meeting-minutes' && !d.meeting.held) return undefined;
    return { type: this.kind, detail: d };
  });

  /** The issued template version, if the document has been issued. */
  private readonly issuedRef = computed(() => {
    const m = this.detail()?.meeting;
    return this.kind === 'meeting-notice' ? m?.notice?.document : m?.minutes?.document;
  });
  protected readonly issued = computed(() => !!this.issuedRef());

  protected readonly template = computed(() => {
    const ref = this.issuedRef();
    if (ref) return this.registry.resolve(ref);
    const def = this.registry.defaultFor(this.kind);
    return def ? this.registry.resolve({ templateId: def.id }) : undefined;
  });

  protected print(): void {
    window.print();
  }
}
