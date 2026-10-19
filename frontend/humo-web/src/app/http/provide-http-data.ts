import { provideHttpClient, withFetch } from '@angular/common/http';
import { EnvironmentProviders, Provider, makeEnvironmentProviders } from '@angular/core';
import {
  AccessDataSource,
  AccountDataSource,
  AccountRequestDataSource,
  AuditDataSource,
  BillingDataSource,
  BoardDataSource,
  BudgetDataSource,
  CatalogueDataSource,
  CollectionDataSource,
  CommercialDataSource,
  CommunicationsDataSource,
  ComplianceDataSource,
  DocumentTemplateDataSource,
  HumoTeamDataSource,
  InboxDataSource,
  JobDataSource,
  LevyDataSource,
  LibraryDataSource,
  MeetingDataSource,
  MeterDataSource,
  NoticeDataSource,
  NotificationDataSource,
  NudgeDataSource,
  OpsDataSource,
  OrganisationDataSource,
  PayablesDataSource,
  PaymentGateway,
  PersonDataSource,
  PlanDataSource,
  PlatformDataSource,
  PlatformTemplateDataSource,
  ReceiptDataSource,
  ReportDataSource,
  ResolutionDataSource,
  RulesDataSource,
  SchemeDataSource,
  SecurityDataSource,
  SessionDataSource,
  SettingsDataSource,
  StaffDataSource,
  StepUpAuthenticator,
  SupplierDataSource,
  TimelineDataSource,
  UnitDataSource,
  WorkItemDataSource,
} from '../domain';
import { ContractorNetwork } from '../domain/contractor';
import { HttpAccessDataSource } from './http-access';
import { HttpBoardDataSource } from './http-board';
import { HttpAccountRequestDataSource, HttpNotificationDataSource } from './http-platform';
import { HttpOrganisationDataSource, HttpPersonDataSource, HttpSchemeDataSource, HttpStepUpAuthenticator, HttpUnitDataSource } from './http-portfolio';
import { HttpSessionDataSource } from './http-session-data-source';
import { notConnected } from './not-connected';

/** Ports whose HTTP adapters come with later backend slices. Remove each from this list as its adapter lands. */
const NOT_YET: [abstract new (...args: never[]) => object, string][] = [
  [WorkItemDataSource, 'WorkItemDataSource'],
  [AccountDataSource, 'AccountDataSource'],
  [ReceiptDataSource, 'ReceiptDataSource'],
  [TimelineDataSource, 'TimelineDataSource'],
  [JobDataSource, 'JobDataSource'],
  [SupplierDataSource, 'SupplierDataSource'],
  [PayablesDataSource, 'PayablesDataSource'],
  [HumoTeamDataSource, 'HumoTeamDataSource'],
  [AuditDataSource, 'AuditDataSource'],
  [SecurityDataSource, 'SecurityDataSource'],
  [PlatformDataSource, 'PlatformDataSource'],
  [PlanDataSource, 'PlanDataSource'],
  [NudgeDataSource, 'NudgeDataSource'],
  [CatalogueDataSource, 'CatalogueDataSource'],
  [CommercialDataSource, 'CommercialDataSource'],
  [PaymentGateway, 'PaymentGateway'],
  [DocumentTemplateDataSource, 'DocumentTemplateDataSource'],
  [PlatformTemplateDataSource, 'PlatformTemplateDataSource'],
  [MeetingDataSource, 'MeetingDataSource'],
  [ResolutionDataSource, 'ResolutionDataSource'],
  [BillingDataSource, 'BillingDataSource'],
  [MeterDataSource, 'MeterDataSource'],
  [LevyDataSource, 'LevyDataSource'],
  [CollectionDataSource, 'CollectionDataSource'],
  [LibraryDataSource, 'LibraryDataSource'],
  [ComplianceDataSource, 'ComplianceDataSource'],
  [SettingsDataSource, 'SettingsDataSource'],
  [ReportDataSource, 'ReportDataSource'],
  [NoticeDataSource, 'NoticeDataSource'],
  [OpsDataSource, 'OpsDataSource'],
  [CommunicationsDataSource, 'CommunicationsDataSource'],
  [InboxDataSource, 'InboxDataSource'],
  [StaffDataSource, 'StaffDataSource'],
  [BudgetDataSource, 'BudgetDataSource'],
  [RulesDataSource, 'RulesDataSource'],
  [ContractorNetwork, 'ContractorNetwork'],
];

/**
 * The production data layer (docs/18 R-6, P1-2): the Humo API over HTTP, and
 * nothing simulated. No mock stores, demo data, persona switcher or prototype
 * controls are in a production bundle: `PrototypeControls` isn't provided, so
 * every prototype control disappears.
 *
 * Connected so far (slice 1): the session (GET /me, passkey and email-link
 * sign-in, passkey registration), sign out and switch role, step-up,
 * organisations, new customer accounts, notifications, schemes, units, people,
 * the trustee board and users & access. The other ports answer "not connected yet" until their slice lands.
 */
export function provideHttpData(): EnvironmentProviders {
  const pending: Provider[] = NOT_YET.map(([port, name]) => ({ provide: port, useFactory: () => notConnected(name) }));
  return makeEnvironmentProviders([
    provideHttpClient(withFetch()),
    { provide: SessionDataSource, useClass: HttpSessionDataSource }, { provide: AccessDataSource, useClass: HttpAccessDataSource },
    { provide: OrganisationDataSource, useClass: HttpOrganisationDataSource },
    { provide: SchemeDataSource, useClass: HttpSchemeDataSource },
    { provide: StepUpAuthenticator, useClass: HttpStepUpAuthenticator },
    { provide: UnitDataSource, useClass: HttpUnitDataSource },
    { provide: PersonDataSource, useClass: HttpPersonDataSource },
    { provide: BoardDataSource, useClass: HttpBoardDataSource },
    { provide: AccountRequestDataSource, useClass: HttpAccountRequestDataSource },
    { provide: NotificationDataSource, useClass: HttpNotificationDataSource },
    ...pending,
  ]);
}
