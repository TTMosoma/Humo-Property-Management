import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import {
  AgencyDetails,
  AgencySettings,
  BillingSettings,
  ComplianceProfile,
  FieldErrors,
  NotificationRule,
  PersonalPreferences,
  SchemeTrustAccount,
  SettingsDataSource,
  TrustAccount,
} from '../../domain';
import { ComplianceStore } from '../db/compliance-store';
import { MockDb } from '../db/mock-db';
import { SettingsStore } from '../db/settings-store';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

@Injectable()
export class InMemorySettingsDataSource extends SettingsDataSource {
  private readonly store = inject(SettingsStore);
  private readonly compliance = inject(ComplianceStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  private get orgId(): string {
    return this.auth.current.organisation?.id ?? '';
  }

  agency(): Observable<AgencySettings> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.agency(this.orgId))));
  }

  updateDetails(details: AgencyDetails, expectedVersion?: number): Observable<void> {
    return this.gateway
      .command(
        {
          action: 'Updated the agency’s details',
          resource: 'Organisation',
          resourceId: this.orgId,
          permission: 'Organisation.Manage',
          version: { expected: expectedVersion, current: this.store.agency(this.orgId).version },
          validate: () => this.store.checkDetails(details),
        },
        () => this.store.updateDetails(this.orgId, details),
      )
      .pipe(map(() => undefined));
  }

  updateBilling(billing: BillingSettings, expectedVersion?: number): Observable<void> {
    const before = this.store.billing(this.orgId);
    const changes = (Object.keys(billing) as (keyof BillingSettings)[]).filter((k) => billing[k] !== before[k]).map((k) => `${k} ${before[k]} → ${billing[k]}`);
    return this.gateway
      .command(
        {
          action: `Changed billing configuration${changes.length ? `: ${changes.join(', ')}` : ''}`,
          resource: 'Organisation',
          resourceId: this.orgId,
          permission: 'Billing.Run',
          feature: 'billing',
          version: { expected: expectedVersion, current: this.store.agency(this.orgId).version },
          validate: () => this.store.checkBilling(billing),
        },
        () => this.store.updateBilling(this.orgId, billing),
      )
      .pipe(map(() => undefined));
  }

  updateNotifications(rules: NotificationRule[], expectedVersion?: number): Observable<void> {
    return this.gateway
      .command(
        {
          action: 'Changed the agency’s notification rules',
          resource: 'Organisation',
          resourceId: this.orgId,
          permission: 'Notifications.Configure',
          version: { expected: expectedVersion, current: this.store.agency(this.orgId).version },
          validate: () => this.store.checkRules(rules),
        },
        () => this.store.updateRules(this.orgId, rules),
      )
      .pipe(map(() => undefined));
  }

  trustAccounts(schemeIds: string[]): Observable<SchemeTrustAccount[]> {
    return this.db.changes$.pipe(
      switchMap(() =>
        this.respond(
          schemeIds
            .map((id) => this.db.schemes.get(id))
            .filter((s) => !!s)
            .map((scheme) => ({ scheme, ...this.db.trustAccount(scheme) })),
        ),
      ),
    );
  }

  /** Bank details that owners pay into: a fresh step-up, always, and the change is audited. */
  updateTrustAccount(schemeId: string, account: TrustAccount): Observable<void> {
    const scheme = this.db.schemes.get(schemeId);
    return this.gateway
      .command(
        {
          action: `Changed the trust account for ${scheme?.name ?? schemeId} to ${account.bank} ····${account.accountNumber.replace(/\s/g, '').slice(-4)}`,
          resource: 'Scheme',
          resourceId: schemeId,
          schemeId,
          permission: 'Organisation.Manage',
          stepUp: true,
          category: 'security',
          validate: () => (scheme ? this.store.checkTrustAccount(account) : { schemeId: 'No such scheme.' }),
        },
        () => this.db.setTrustAccount(schemeId, { bank: account.bank.trim(), accountName: account.accountName.trim(), accountNumber: account.accountNumber.trim(), branchCode: account.branchCode.trim() }),
      )
      .pipe(map(() => undefined));
  }

  updateComplianceProfile(profile: ComplianceProfile): Observable<void> {
    const scheme = this.db.schemes.get(profile.schemeId);
    return this.gateway
      .command(
        {
          action: `Set ${scheme?.name ?? profile.schemeId}’s financial year-end to ${MONTHS[profile.financialYearEnd - 1] ?? '?'}${profile.hasLifts ? ', with lifts' : ''}`,
          resource: 'Scheme',
          resourceId: profile.schemeId,
          schemeId: profile.schemeId,
          permission: 'Compliance.Manage',
          validate: () => this.compliance.checkProfile(profile),
        },
        () => this.compliance.updateProfile(profile),
      )
      .pipe(map(() => undefined));
  }

  preferences(): Observable<PersonalPreferences> {
    return this.db.changes$.pipe(switchMap(() => this.respond(this.store.preferencesOf(this.auth.current.identity.id))));
  }

  updatePreferences(prefs: Omit<PersonalPreferences, 'identityId' | 'version'>, expectedVersion?: number): Observable<void> {
    const id = this.auth.current.identity.id;
    return this.gateway
      .command(
        {
          action: 'Changed own notification preferences',
          resource: 'Identity',
          resourceId: id,
          permission: 'Security.ManageOwn',
          stepUp: false,
          version: { expected: expectedVersion, current: this.store.preferencesOf(id).version },
          validate: (): FieldErrors | null => {
            const e: FieldErrors = {};
            if (prefs.quietFrom && !/^\d{2}:\d{2}$/.test(prefs.quietFrom)) e['quietFrom'] = 'A time like 21:00.';
            if (prefs.quietTo && !/^\d{2}:\d{2}$/.test(prefs.quietTo)) e['quietTo'] = 'A time like 07:00.';
            if (!prefs.work.length) e['work'] = 'Choose at least one way to hear about your work.';
            return Object.keys(e).length ? e : null;
          },
        },
        () => this.store.updatePreferences(id, prefs),
      )
      .pipe(map(() => undefined));
  }
}
