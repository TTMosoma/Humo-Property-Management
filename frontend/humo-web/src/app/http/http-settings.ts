import { Injectable, inject } from '@angular/core';
import { Observable, map, throwError } from 'rxjs';
import {
  AgencyDetails,
  AgencySettings,
  ApiError,
  BillingSettings,
  ClientApproval,
  ComplianceProfile,
  DocumentBrandingDetails,
  DocumentTemplate,
  DocumentTemplateDataSource,
  DocumentType,
  NewTrusteePermission,
  NotificationRule,
  OrganisationDocumentSettings,
  PayfastMerchantDetails,
  PersonalPreferences,
  PlatformTemplateDataSource,
  SchemeAuthority,
  SchemeTrustAccount,
  SettingsDataSource,
  TemplateAdoption,
  TemplateDesign,
  TemplateStatus,
  TrustAccount,
  withDefaultRules,
} from '../domain';
import { HttpComplianceProfiles } from './http-budgets';
import { HttpPort } from './http-port';

/**
 * Settings over HTTP (slice 2c): the agency's details, billing configuration and notification rules,
 * each scheme's trust account (a fresh passkey to change), and each person's own preferences.
 * Scheme compliance profiles arrive with compliance on the API.
 */
@Injectable()
export class HttpSettingsDataSource extends HttpPort implements SettingsDataSource {
  private readonly profiles = inject(HttpComplianceProfiles);

  /** The API stores only the rules an agency changed; the rest are Humo's defaults. */
  agency(): Observable<AgencySettings> {
    return this.live<AgencySettings>('/settings/agency', ['settings', 'organisations']).pipe(map((a) => ({ ...a, notifications: withDefaultRules(a.notifications) })));
  }

  updateDetails(details: AgencyDetails, expectedVersion?: number): Observable<void> {
    return this.command('PUT', '/settings/agency/details', { details, expectedVersion }, ['settings', 'organisations', 'session', 'documents']);
  }

  updateBilling(billing: BillingSettings, expectedVersion?: number): Observable<void> {
    return this.command('PUT', '/settings/agency/billing', { billing, expectedVersion }, ['settings', 'billing']);
  }

  updateNotifications(rules: NotificationRule[], expectedVersion?: number): Observable<void> {
    return this.command('PUT', '/settings/agency/notifications', { rules, expectedVersion }, ['settings']);
  }

  updateEmailSignature(signature: string, expectedVersion?: number): Observable<void> {
    return this.command('PUT', '/settings/agency/email-signature', { signature, expectedVersion }, ['settings']);
  }

  trustAccounts(schemeIds: string[]): Observable<SchemeTrustAccount[]> {
    return this.live<SchemeTrustAccount[]>('/settings/trust-accounts', ['settings', 'schemes'], { schemeIds });
  }

  trusteePermissions(): Observable<SchemeAuthority[]> {
    return this.live<SchemeAuthority[]>('/trustee-permissions', ['settings', 'schemes', 'work-items']);
  }

  addTrusteePermission(input: NewTrusteePermission, file?: File): Observable<string> {
    if (!file) return throwError(() => new ApiError('validation', 'Attach the signed permission as a PDF.', { file: 'Attach the signed permission as a PDF.' }));
    const form = new FormData();
    form.append('schemeId', input.schemeId);
    form.append('summary', input.summary);
    form.append('grantedOn', input.grantedOn);
    if (input.until) form.append('until', input.until);
    form.append('file', file, file.name);
    return this.createId('/trustee-permissions', form, ['settings', 'work-items']);
  }

  setDelegatedLimit(schemeId: string, limit: number): Observable<void> {
    return this.command('POST', `/schemes/${schemeId}/delegated-limit`, { limit }, ['settings', 'schemes', 'jobs']);
  }

  withdrawTrusteePermission(id: string, reason: string): Observable<void> {
    return this.command('POST', `/trustee-permissions/${id}/withdraw`, { reason }, ['settings', 'work-items']);
  }

  updateTrustAccount(schemeId: string, account: TrustAccount): Observable<void> {
    return this.command('PUT', `/settings/trust-accounts/${schemeId}`, account, ['settings', 'accounts']);
  }

  linkPayfast(schemeId: string, merchant: PayfastMerchantDetails): Observable<void> {
    return this.command('PUT', `/settings/trust-accounts/${schemeId}/payfast`, merchant, ['settings', 'accounts']);
  }

  unlinkPayfast(schemeId: string, reason: string): Observable<void> {
    return this.command('POST', `/settings/trust-accounts/${schemeId}/payfast/remove`, { reason }, ['settings', 'accounts']);
  }

  updateComplianceProfile(profile: ComplianceProfile): Observable<void> {
    return this.profiles.update(profile);
  }

  preferences(): Observable<PersonalPreferences> {
    return this.live<PersonalPreferences>('/me/preferences', ['settings', 'session']);
  }

  updatePreferences(prefs: Omit<PersonalPreferences, 'identityId' | 'version' | 'emailSignOff'>, expectedVersion?: number): Observable<void> {
    return this.command('PUT', '/me/preferences', { ...prefs, expectedVersion }, ['settings']);
  }

  updateSignOff(signOff: string, expectedVersion?: number): Observable<void> {
    return this.command('PUT', '/me/email-sign-off', { signOff, expectedVersion }, ['settings']);
  }
}

/** The document template registry over HTTP (D12): Humo's catalogue and the organisation's defaults, contact details, branding and statement delivery (D9). */
@Injectable()
export class HttpDocumentTemplateDataSource extends HttpPort implements DocumentTemplateDataSource {
  templates(): Observable<DocumentTemplate[]> {
    return this.live<DocumentTemplate[]>('/documents/templates', ['documents', 'session']);
  }

  settings(): Observable<OrganisationDocumentSettings> {
    return this.live<OrganisationDocumentSettings>('/documents/settings', ['documents', 'session']);
  }

  setDefault(type: DocumentType, templateId: string, expectedVersion: number): Observable<void> {
    return this.command('PUT', `/documents/settings/defaults/${type}`, { templateId, expectedVersion }, ['documents']);
  }

  updateBranding(details: DocumentBrandingDetails, expectedVersion: number): Observable<void> {
    return this.command('PUT', '/documents/settings/branding', { ...details, expectedVersion }, ['documents']);
  }
}

/**
 * Humo's side of the template registry over HTTP (D12, D23): every template with its adoption, Humo's own templates'
 * statuses, and Enterprise customers' custom templates, built by Humo and published once the client approves a proof.
 */
@Injectable()
export class HttpPlatformTemplateDataSource extends HttpPort implements PlatformTemplateDataSource {
  adoption(): Observable<TemplateAdoption> {
    return this.live<TemplateAdoption>('/platform/document-templates', ['documents', 'organisations', 'subscriptions']);
  }

  setStatus(templateId: string, status: TemplateStatus, reason: string, expectedVersion: number): Observable<void> {
    return this.command('PUT', `/platform/document-templates/${templateId}/status`, { status, reason, expectedVersion }, ['documents']);
  }

  createCustomTemplate(organisationId: string, documentType: DocumentType): Observable<string> {
    return this.createId(`/platform/customers/${organisationId}/document-templates`, { documentType }, ['documents']);
  }

  publishCustomVersion(templateId: string, design: TemplateDesign, notes: string, clientApproval: ClientApproval, expectedVersion: number): Observable<number> {
    return this.command<{ version: number }>('POST', `/platform/document-templates/${templateId}/versions`, { design, notes, clientApproval, expectedVersion }, ['documents']).pipe(
      map((r) => r.version),
    );
  }
}
