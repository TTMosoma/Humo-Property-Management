import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import {
  DocumentTemplate,
  DocumentTemplateDataSource,
  DocumentTemplateRef,
  DocumentType,
  OrganisationDocumentSettings,
  ResolvedBranding,
  TemplateAvailability,
  TemplateDesign,
  TemplateVersion,
  resolveBranding,
  templateVersion,
  templatesFor,
} from '../../domain';
import { SessionService } from '../session/session.service';

/** A template at one version, ready to render. */
export interface ResolvedTemplate {
  template: DocumentTemplate;
  version: TemplateVersion;
}

/**
 * The document template registry, client side. One question for every
 * document screen: "which templates can this organisation use for this type,
 * and which is its default?" — answered from the templates the API returns and
 * the organisation's entitlements, never from its package name.
 */
@Injectable({ providedIn: 'root' })
export class DocumentTemplatesService {
  private readonly data = inject(DocumentTemplateDataSource);
  private readonly session = inject(SessionService);

  readonly templates = toSignal(this.data.templates().pipe(catchError(() => of([] as DocumentTemplate[]))), { initialValue: [] as DocumentTemplate[] });
  readonly settings = toSignal(this.data.settings().pipe(catchError(() => of(undefined))), { initialValue: undefined as OrganisationDocumentSettings | undefined });
  readonly loaded = computed(() => this.templates().length > 0 && !!this.settings());

  /** Every template of a type with its availability (available / locked / planned / deprecated). */
  forType(type: DocumentType): TemplateAvailability[] {
    return templatesFor(type, this.templates(), this.session.entitlements());
  }

  get(id: string): DocumentTemplate | undefined {
    return this.templates().find((t) => t.id === id);
  }

  /** The organisation's default for a type if it may still use it; otherwise Humo's default. */
  defaultFor(type: DocumentType): DocumentTemplate | undefined {
    const choices = this.forType(type);
    const chosen = this.settings()?.defaults[type];
    return choices.find((a) => a.template.id === chosen && a.state === 'available')?.template ?? choices.find((a) => a.template.isDefault)?.template;
  }

  /** A template at a specific version (a generated document's), or its current one. */
  resolve(ref: DocumentTemplateRef | { templateId: string; version?: number }): ResolvedTemplate | undefined {
    const template = this.get(ref.templateId);
    const version = template && templateVersion(template, ref.version ?? template.currentVersion);
    return template && version ? { template, version } : undefined;
  }

  /** Humo defaults → agency branding → the template's own design. */
  brandingFor(design: TemplateDesign): ResolvedBranding {
    return resolveBranding(design, this.settings(), this.session.entitlements());
  }
}
