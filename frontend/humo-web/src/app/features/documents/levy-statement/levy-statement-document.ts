import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  DOCUMENT_FONTS,
  OrganisationDocumentSettings,
  ResolvedBranding,
  StatementSection,
  StatementView,
  TemplateDesign,
  documentNumber,
  isBrandedLayout,
} from '../../../domain';
import { Logo } from '../../../ui/brand/logo';
import { RandPipe, formatDate } from '../../../ui/format/money';

/**
 * The levy statement layouts ("levy-statement/classic" and "/branded"): one A4
 * document drawn from statement data + a template design + resolved branding.
 * Everything a template may change arrives as data; text is bound (escaped),
 * never inserted as HTML. The rendering rules are in
 * docs/document-pdf-rendering-standard.md.
 */
@Component({
  selector: 'app-levy-statement-document',
  imports: [Logo, RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './levy-statement-document.html',
  styleUrls: ['../document-sheet.scss', './levy-statement-document.scss'],
})
export class LevyStatementDocument {
  readonly view = input.required<StatementView>();
  readonly design = input.required<TemplateDesign>();
  readonly branding = input.required<ResolvedBranding>();
  /** The agency's contact details and footer line. */
  readonly settings = input.required<OrganisationDocumentSettings>();
  readonly organisationName = input.required<string>();

  protected readonly formatDate = formatDate;

  protected readonly isBranded = computed(() => isBrandedLayout(this.design().layout));
  protected readonly title = computed(() => this.design().title?.trim() || 'Levy statement');
  protected readonly number = computed(() => documentNumber(this.design(), this.view().statement.period, this.view().account.accountNo));
  /** Humo's own font stays as the app sets it; anything else is set on the sheet. */
  protected readonly fontStack = computed(() => {
    const b = this.branding();
    return b.source === 'humo' || b.font === 'dm-sans' ? null : DOCUMENT_FONTS[b.font].stack;
  });

  protected shows(section: StatementSection): boolean {
    return this.design().sections.includes(section);
  }
}
