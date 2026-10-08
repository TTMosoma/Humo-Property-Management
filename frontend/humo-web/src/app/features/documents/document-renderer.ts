import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DocumentType, OrganisationDocumentSettings, StatementView } from '../../domain';
import { DocumentTemplatesService, ResolvedTemplate } from '../../core/documents/document-templates.service';
import { LevyStatementDocument } from './levy-statement/levy-statement-document';

/** A document's data, by type. New document types add a case here and a layout component. */
export type DocumentData = { type: 'levy-statement'; view: StatementView };

/**
 * Document type + template (at a version) + data + branding → the A4 document.
 *
 * This is the seam the backend renderer will mirror: the .NET document
 * service resolves the same template version and branding, renders the same
 * HTML/CSS with Chromium and returns PDF bytes. The screen then shows that PDF
 * instead of this component (docs/document-template-architecture.md).
 */
@Component({
  selector: 'app-document-renderer',
  imports: [LevyStatementDocument],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = data();
    @switch (d.type) {
      @case ('levy-statement') {
        <app-levy-statement-document
          [view]="d.view"
          [design]="template().version.design"
          [branding]="branding()"
          [settings]="settings()"
          [organisationName]="organisationName()"
        />
      }
    }
  `,
})
export class DocumentRenderer {
  private readonly registry = inject(DocumentTemplatesService);

  readonly data = input.required<DocumentData>();
  readonly template = input.required<ResolvedTemplate>();
  readonly settings = input.required<OrganisationDocumentSettings>();
  readonly organisationName = input.required<string>();

  protected readonly branding = computed(() => this.registry.brandingFor(this.template().version.design));

  /** For callers that need to know whether a type can be rendered at all. */
  static supports(type: DocumentType): boolean {
    return type === 'levy-statement';
  }
}
