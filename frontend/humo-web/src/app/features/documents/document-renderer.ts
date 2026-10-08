import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DocumentType, MeetingDetail, OrganisationDocumentSettings, StatementView } from '../../domain';
import { DocumentTemplatesService, ResolvedTemplate } from '../../core/documents/document-templates.service';
import { LevyStatementDocument } from './levy-statement/levy-statement-document';
import { MeetingMinutesDocument } from './meeting/meeting-minutes-document';
import { MeetingNoticeDocument } from './meeting/meeting-notice-document';

/** A document's data, by type. New document types add a case here and a layout component. */
export type DocumentData =
  | { type: 'levy-statement'; view: StatementView }
  | { type: 'meeting-notice'; detail: MeetingDetail }
  | { type: 'meeting-minutes'; detail: MeetingDetail };

const RENDERED: DocumentType[] = ['levy-statement', 'meeting-notice', 'meeting-minutes'];

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
  imports: [LevyStatementDocument, MeetingNoticeDocument, MeetingMinutesDocument],
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
      @case ('meeting-notice') {
        <app-meeting-notice-document [detail]="d.detail" [design]="template().version.design" [branding]="branding()" [settings]="settings()" />
      }
      @case ('meeting-minutes') {
        <app-meeting-minutes-document [detail]="d.detail" [design]="template().version.design" [branding]="branding()" [settings]="settings()" />
      }
    }
  `,
})
export class DocumentRenderer {
  private readonly registry = inject(DocumentTemplatesService);

  readonly data = input.required<DocumentData>();
  readonly template = input.required<ResolvedTemplate>();
  readonly settings = input.required<OrganisationDocumentSettings>();
  /** The agency's name, for documents whose data doesn't carry it. */
  readonly organisationName = input('');

  protected readonly branding = computed(() => this.registry.brandingFor(this.template().version.design));

  /** For callers that need to know whether a type can be rendered at all. */
  static supports(type: DocumentType): boolean {
    return RENDERED.includes(type);
  }
}
