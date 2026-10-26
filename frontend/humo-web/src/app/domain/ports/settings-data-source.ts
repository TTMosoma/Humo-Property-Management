import { Observable } from 'rxjs';
import { TrustAccount } from '../models/account';
import { AgencyDetails, AgencySettings, BillingSettings, NewTrusteePermission, NotificationRule, PersonalPreferences, SchemeAuthority, SchemeTrustAccount } from '../models/settings';
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
 *   GET   /trustee-permissions                     Organisation.Manage (D24)
 *   POST  /trustee-permissions                     Organisation.Manage + step-up, multipart with the PDF
 *   POST  /trustee-permissions/{id}/withdraw       Organisation.Manage
 *   PUT   /compliance/profiles/{schemeId}          Compliance.Manage (financial year-end, lifts)
 *   GET   /me/preferences   PUT /me/preferences
 */
export abstract class SettingsDataSource {
  abstract agency(): Observable<AgencySettings>;
  abstract updateDetails(details: AgencyDetails, expectedVersion?: number): Observable<void>;
  abstract updateBilling(billing: BillingSettings, expectedVersion?: number): Observable<void>;
  abstract updateNotifications(rules: NotificationRule[], expectedVersion?: number): Observable<void>;
  /** The agency's email signature (Organisation.Manage). */
  abstract updateEmailSignature(signature: string, expectedVersion?: number): Observable<void>;
  abstract trustAccounts(schemeIds: string[]): Observable<SchemeTrustAccount[]>;
  /** D24: each scheme's trustees on Humo and the trustees' permission to approve alone. */
  abstract trusteePermissions(): Observable<SchemeAuthority[]>;
  /** Uploads the trustees' signed permission (PDF). Needs a fresh passkey. */
  abstract addTrusteePermission(input: NewTrusteePermission, file?: File): Observable<string>;
  abstract withdrawTrusteePermission(id: string, reason: string): Observable<void>;
  abstract updateTrustAccount(schemeId: string, account: TrustAccount): Observable<void>;
  abstract updateComplianceProfile(profile: ComplianceProfile): Observable<void>;
  abstract preferences(): Observable<PersonalPreferences>;
  abstract updatePreferences(prefs: Omit<PersonalPreferences, 'identityId' | 'version' | 'emailSignOff'>, expectedVersion?: number): Observable<void>;
  /** The signed-in person's own email sign-off. */
  abstract updateSignOff(signOff: string, expectedVersion?: number): Observable<void>;
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
