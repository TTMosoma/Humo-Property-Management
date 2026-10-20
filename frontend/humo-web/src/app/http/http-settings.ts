import { Injectable } from '@angular/core';
import { Observable, map, throwError } from 'rxjs';
import {
  AgencyDetails,
  AgencySettings,
  ApiError,
  BillingSettings,
  DocumentBrandingDetails,
  DocumentTemplate,
  DocumentTemplateDataSource,
  DocumentType,
  NotificationRule,
  OrganisationDocumentSettings,
  PersonalPreferences,
  SchemeTrustAccount,
  SettingsDataSource,
  TrustAccount,
  withDefaultRules,
} from '../domain';
import { HttpPort } from './http-port';

/**
 * Settings over HTTP (slice 2c): the agency's details, billing configuration and notification rules,
 * each scheme's trust account (a fresh passkey to change), and each person's own preferences.
 * Scheme compliance profiles arrive with compliance on the API.
 */
@Injectable()
export class HttpSettingsDataSource extends HttpPort implements SettingsDataSource {
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

  trustAccounts(schemeIds: string[]): Observable<SchemeTrustAccount[]> {
    return this.live<SchemeTrustAccount[]>('/settings/trust-accounts', ['settings', 'schemes'], { schemeIds });
  }

  updateTrustAccount(schemeId: string, account: TrustAccount): Observable<void> {
    return this.command('PUT', `/settings/trust-accounts/${schemeId}`, account, ['settings', 'accounts']);
  }

  updateComplianceProfile(): Observable<void> {
    return throwError(() => new ApiError('server', 'Compliance profiles aren’t on Humo’s API yet'));
  }

  preferences(): Observable<PersonalPreferences> {
    return this.live<PersonalPreferences>('/me/preferences', ['settings', 'session']);
  }

  updatePreferences(prefs: Omit<PersonalPreferences, 'identityId' | 'version'>, expectedVersion?: number): Observable<void> {
    return this.command('PUT', '/me/preferences', { ...prefs, expectedVersion }, ['settings']);
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
