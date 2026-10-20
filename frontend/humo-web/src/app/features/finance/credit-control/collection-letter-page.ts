import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { map } from 'rxjs';
import { CollectionDataSource } from '../../../domain';
import { DocumentTemplatesService } from '../../../core/documents/document-templates.service';
import { loadable } from '../../../core/data/loadable';
import { formatDate } from '../../../ui/format/money';
import { EmptyState } from '../../../ui/states/empty-state';
import { ErrorState } from '../../../ui/states/error-state';
import { Skeleton } from '../../../ui/states/skeleton';
import { DocumentData, DocumentRenderer } from '../../documents/document-renderer';
import { LETTER_LABELS } from './collection-view';

/** A collection letter as sent: the A4 payment notice, rendered with the template version it was issued with. */
@Component({
  selector: 'app-collection-letter-page',
  imports: [DocumentRenderer, EmptyState, ErrorState, Skeleton, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result.loading()) {
      <ui-skeleton [count]="10" />
    } @else if (result.failed()) {
      <div class="surface"><ui-error-state title="We couldn’t load this letter" (retry)="result.retry()" /></div>
    } @else if (!doc()) {
      <div class="surface"><ui-empty-state illustration="not-found" title="No such letter" message="Letters appear on the account’s collection page once they’re sent." /></div>
    } @else {
      <div class="toolbar no-print">
        <a class="btn btn-ghost btn-sm" [routerLink]="['../..']"><ion-icon name="chevron-back-outline" aria-hidden="true" /> Unit {{ view()!.unit.number }} · collection</a>
        <div class="right">
          <span class="muted">{{ title() }} · sent {{ sentOn() }}@if (template(); as t) { · {{ t.template.name }} v{{ t.version.version }}, as issued }</span>
          @if (pdf(); as href) {
            <a class="btn btn-primary" [href]="href" download><ion-icon name="download-outline" aria-hidden="true" /> Download PDF</a>
          } @else {
            <button type="button" class="btn btn-primary" (click)="print()"><ion-icon name="print-outline" aria-hidden="true" /> Print or save PDF</button>
          }
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
export class CollectionLetterPage {
  private readonly route = inject(ActivatedRoute);
  private readonly data = inject(CollectionDataSource);
  protected readonly registry = inject(DocumentTemplatesService);

  private readonly params = toSignal(this.route.paramMap.pipe(map((p) => ({ accountId: p.get('accountId')!, stepId: p.get('stepId')! }))), {
    initialValue: { accountId: this.route.snapshot.paramMap.get('accountId')!, stepId: this.route.snapshot.paramMap.get('stepId')! },
  });

  protected readonly result = loadable(() => this.data.get(this.params().accountId));
  protected readonly view = computed(() => this.result.value());
  private readonly step = computed(() => this.view()?.case.steps.find((s) => s.id === this.params().stepId && s.letter));

  protected readonly doc = computed<DocumentData | undefined>(() => {
    const v = this.view();
    const s = this.step();
    return v && s ? { type: 'payment-notice', view: v, step: s } : undefined;
  });

  protected readonly template = computed(() => {
    const ref = this.step()?.letter?.template;
    return ref ? this.registry.resolve(ref) : undefined;
  });
  protected readonly title = computed(() => (this.step()?.letter ? LETTER_LABELS[this.step()!.letter!.kind] : ''));
  /** The stored PDF: exactly what was sent (D7). For letters by post, what the agency prints. */
  protected readonly pdf = computed(() => (this.step() ? this.data.pdfUrl(this.params().accountId, this.params().stepId) : undefined));
  protected readonly sentOn = computed(() => (this.step() ? formatDate(this.step()!.at) : ''));

  protected print(): void {
    window.print();
  }
}
