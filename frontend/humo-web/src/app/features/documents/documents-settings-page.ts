import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import {
  DOCUMENT_FONTS,
  DOCUMENT_TYPES,
  DocumentTemplate,
  DocumentTemplateDataSource,
  DocumentType,
  TEMPLATE_TIERS,
  TemplateVersion,
  periodOf,
} from '../../domain';
import { DocumentTemplatesService } from '../../core/documents/document-templates.service';
import { SessionService } from '../../core/session/session.service';
import { ScopeService } from '../../core/scope/scope.service';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { PageHeader } from '../../ui/page-header/page-header';
import { Skeleton } from '../../ui/states/skeleton';
import { StatusPill } from '../../ui/status-pill/status-pill';
import { formatDate } from '../../ui/format/money';
import { TemplatePicker } from './template-picker';
import { brandingForm, defaultTemplateForm } from './document-forms';

/**
 * Settings → Documents & templates. Which template each document type uses by
 * default, the contact details and branding printed on documents, and — with
 * the custom-templates entitlement — the organisation's own template and its
 * version history. Everything offered here is filtered by entitlements.
 */
@Component({
  selector: 'app-documents-settings-page',
  imports: [PageHeader, Skeleton, StatusPill, TemplatePicker, IonIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './documents-settings-page.html',
  styleUrl: './documents-settings-page.scss',
})
export class DocumentsSettingsPage {
  private readonly data = inject(DocumentTemplateDataSource);
  private readonly drawer = inject(DrawerService);
  private readonly router = inject(Router);
  private readonly scope = inject(ScopeService);
  protected readonly session = inject(SessionService);
  protected readonly registry = inject(DocumentTemplatesService);

  protected readonly formatDate = formatDate;
  protected readonly tierLabel = (t: DocumentTemplate) => TEMPLATE_TIERS[t.tier].label;
  protected readonly fontLabel = (f: keyof typeof DOCUMENT_FONTS) => DOCUMENT_FONTS[f].label;

  protected readonly canEdit = computed(() => this.session.can('Documents.Configure') && !this.session.readOnly());
  protected readonly branded = computed(() => this.session.hasFeature('document-branding'));
  protected readonly customEntitled = computed(() => this.session.hasFeature('document-templates-custom'));

  protected readonly rows = computed(() =>
    DOCUMENT_TYPES.map((d) => {
      const options = this.registry.forType(d.type);
      return {
        def: d,
        current: this.registry.defaultFor(d.type),
        choices: options.filter((o) => o.state === 'available').length,
        planned: options.filter((o) => o.state === 'planned').length,
      };
    }),
  );

  protected readonly statementTemplates = computed(() => this.registry.forType('levy-statement'));
  protected readonly custom = computed(() => this.registry.templates().find((t) => t.tier === 'custom' && t.documentType === 'levy-statement'));
  protected readonly history = computed<TemplateVersion[]>(() => [...(this.custom()?.versions ?? [])].sort((a, b) => b.version - a.version));
  protected readonly locked = computed(() => this.statementTemplates().filter((o) => o.state === 'locked'));

  /** A real statement to preview templates on: last month's, for unit 1 of the first scheme in scope. */
  private readonly sample = computed(() => {
    const scheme = this.scope.accessible()[0];
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return scheme ? `/schemes/${scheme.id}/units/1/account/statements/${periodOf(d.toISOString())}` : null;
  });

  protected preview(templateId: string, version?: number): void {
    const url = this.sample();
    if (url) void this.router.navigate([url], { queryParams: { template: templateId, ...(version ? { v: version } : {}) } });
  }

  protected changeDefault(type: DocumentType): void {
    const s = this.registry.settings();
    if (s) defaultTemplateForm(this.drawer, this.data, type, this.registry.forType(type), s, this.registry.defaultFor(type)?.id);
  }

  protected editBranding(): void {
    const s = this.registry.settings();
    if (s) brandingForm(this.drawer, this.data, s, this.branded());
  }

}
