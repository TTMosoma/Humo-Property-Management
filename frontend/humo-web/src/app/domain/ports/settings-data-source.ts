import { Observable } from 'rxjs';
import { TrustAccount } from '../models/account';
import { AgencyDetails, AgencySettings, BillingSettings, NotificationRule, PersonalPreferences, SchemeTrustAccount } from '../models/settings';
import { ComplianceProfile } from '../models/compliance';
import { ReportDef, ReportId, ReportParams, ReportResult } from '../models/report';

/**
 * Settings:
 *   GET   /settings/agency                         the caller's organisation's settings
 *   PUT   /settings/agency/details                 Organisation.Manage
 *   PUT   /settings/agency/billing                 Billing.Run
 *   PUT   /settings/agency/notifications           Notifications.Configure
 *   GET   /settings/trust-accounts?schemeIds=…
 *   PUT   /settings/trust-accounts/{schemeId}      Organisation.Manage + step-up (bank details)
 *   PUT   /compliance/profiles/{schemeId}          Compliance.Manage (financial year-end, lifts)
 *   GET   /me/preferences   PUT /me/preferences
 */
export abstract class SettingsDataSource {
  abstract agency(): Observable<AgencySettings>;
  abstract updateDetails(details: AgencyDetails, expectedVersion?: number): Observable<void>;
  abstract updateBilling(billing: BillingSettings, expectedVersion?: number): Observable<void>;
  abstract updateNotifications(rules: NotificationRule[], expectedVersion?: number): Observable<void>;
  abstract trustAccounts(schemeIds: string[]): Observable<SchemeTrustAccount[]>;
  abstract updateTrustAccount(schemeId: string, account: TrustAccount): Observable<void>;
  abstract updateComplianceProfile(profile: ComplianceProfile): Observable<void>;
  abstract preferences(): Observable<PersonalPreferences>;
  abstract updatePreferences(prefs: Omit<PersonalPreferences, 'identityId' | 'version'>, expectedVersion?: number): Observable<void>;
}

/**
 * Reports:
 *   GET   /reports                      the catalogue the caller may run (permission and plan)
 *   GET   /reports/{id}?schemeIds=…&months=…   the report, worked out from live records
 *   GET   /reports/{id}.csv?…           the same as CSV (the prototype builds the CSV in the browser)
 */
export abstract class ReportDataSource {
  abstract catalogue(): Observable<ReportDef[]>;
  abstract run(id: ReportId, params: ReportParams): Observable<ReportResult | undefined>;
}
