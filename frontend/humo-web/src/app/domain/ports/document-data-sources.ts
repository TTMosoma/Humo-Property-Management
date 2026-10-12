import { Observable } from 'rxjs';
import {
  AgencyBranding,
  ClientApproval,
  DocumentContact,
  DocumentTemplate,
  DocumentType,
  OrganisationDocumentSettings,
  TemplateDesign,
  TemplateStatus,
} from '../models/document';

/** What an administrator can change about how the agency's documents read and look. */
export interface DocumentBrandingDetails {
  contact: DocumentContact;
  footerText?: string;
  /** Needs the document-branding entitlement; the API ignores it otherwise. */
  branding?: AgencyBranding;
}

/**
 * The document template registry, as the signed-in organisation sees it:
 *   GET   /documents/templates                  Humo's catalogue + this organisation's own custom templates
 *   GET   /documents/settings                   defaults, contact details, branding
 *   PUT   /documents/settings/defaults/{type}   choose the default template for a type
 *   PUT   /documents/settings/branding          contact details, footer, branding
 *
 * Custom templates are Humo-owned (D12): the organisation sees and chooses its
 * custom template, but only Humo publishes its versions (PlatformTemplateDataSource).
 *
 * The API never returns another organisation's custom template. It works out
 * availability with the same entitlement rule as `templateAvailability`, and
 * refuses to generate a document with a template the organisation can't use.
 */
export abstract class DocumentTemplateDataSource {
  abstract templates(): Observable<DocumentTemplate[]>;
  abstract settings(): Observable<OrganisationDocumentSettings>;
  abstract setDefault(type: DocumentType, templateId: string, expectedVersion: number): Observable<void>;
  abstract updateBranding(details: DocumentBrandingDetails, expectedVersion: number): Observable<void>;
}

/** A template across Humo's customers (platform console). */
export interface TemplateUsage {
  template: DocumentTemplate;
  /** Organisation name, for custom templates. */
  owner?: string;
  /** Customers whose default for the type is this template. */
  defaultFor: number;
  /** Customers entitled to use it. */
  entitledCustomers: number;
}

export interface TemplateAdoption {
  customers: number;
  /** Customers using a premium or custom template as a default. */
  premiumDefaults: number;
  customTemplates: number;
  usage: TemplateUsage[];
}

/**
 * Humo's side of the registry:
 *   GET   /platform/document-templates                   catalogue, every custom template, adoption
 *   PUT   /platform/document-templates/{id}/status       move a platform template through planned → preview → active → deprecated
 *   POST  /platform/customers/{id}/document-templates    set up a customer's custom template (from Humo's standard design)
 *   POST  /platform/document-templates/{id}/versions     publish a custom template's next version, with the client's proof approval (D12)
 */
export abstract class PlatformTemplateDataSource {
  abstract adoption(): Observable<TemplateAdoption>;
  abstract setStatus(templateId: string, status: TemplateStatus, reason: string, expectedVersion: number): Observable<void>;
  abstract createCustomTemplate(organisationId: string, documentType: DocumentType): Observable<string>;
  /**
   * D12: Humo builds and publishes custom templates, after the client approves a proof.
   * Publishes the design as the template's next version; earlier versions stay for the
   * documents that used them. Returns the new version number.
   */
  abstract publishCustomVersion(templateId: string, design: TemplateDesign, notes: string, clientApproval: ClientApproval, expectedVersion: number): Observable<number>;
}
