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
import { HttpCommunicationsDataSource, HttpInboxDataSource, HttpNoticeDataSource } from './http-communications';
import { HttpJobDataSource, HttpSupplierDataSource } from './http-maintenance';
import { HttpAuditDataSource, HttpSecurityDataSource } from './http-audit-security';
import { HttpBoardDataSource } from './http-board';
import { HttpAccountDataSource, HttpBillingDataSource, HttpCollectionDataSource, HttpLevyDataSource, HttpMeterDataSource, HttpReceiptDataSource, HttpWorkItemDataSource } from './http-finance';
import { HttpCatalogueDataSource, HttpCommercialDataSource, HttpNudgeDataSource, HttpPlanDataSource, HttpPlatformDataSource } from './http-commercial';
import { HttpAccountRequestDataSource, HttpHumoTeamDataSource, HttpNotificationDataSource } from './http-platform';
import { HttpOrganisationDataSource, HttpPersonDataSource, HttpSchemeDataSource, HttpStepUpAuthenticator, HttpUnitDataSource } from './http-portfolio';
import { HttpSessionDataSource } from './http-session-data-source';
import { HttpLibraryDataSource } from './http-library';
import { HttpDocumentTemplateDataSource, HttpSettingsDataSource } from './http-settings';
import { notConnected } from './not-connected';

/** Ports whose HTTP adapters come with later backend slices. Remove each from this list as its adapter lands. */
const NOT_YET: [abstract new (...args: never[]) => object, string][] = [
  [TimelineDataSource, 'TimelineDataSource'],
  [PayablesDataSource, 'PayablesDataSource'],
  [PaymentGateway, 'PaymentGateway'],
  [PlatformTemplateDataSource, 'PlatformTemplateDataSource'],
  [MeetingDataSource, 'MeetingDataSource'],
  [ResolutionDataSource, 'ResolutionDataSource'],
  [ComplianceDataSource, 'ComplianceDataSource'],
  [ReportDataSource, 'ReportDataSource'],
  [OpsDataSource, 'OpsDataSource'],
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
 * organisations, new customer accounts, notifications, the Humo team, schemes, units, people,
 * the trustee board, users & access, impersonation, the audit log and Settings › Security.
 * Commercial (docs/23): the catalogue, customers and subscriptions, Plan & features, pricing and agreements.
 * Slice 2: levy accounts, receipts, billing runs, meter readings, My work, settings, document templates, statements and credit control.
 * The other ports answer "not connected yet" until their slice lands.
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
    { provide: HumoTeamDataSource, useClass: HttpHumoTeamDataSource },
    { provide: AuditDataSource, useClass: HttpAuditDataSource },
    { provide: SecurityDataSource, useClass: HttpSecurityDataSource },
    { provide: LibraryDataSource, useClass: HttpLibraryDataSource },
    { provide: CatalogueDataSource, useClass: HttpCatalogueDataSource },
    { provide: PlatformDataSource, useClass: HttpPlatformDataSource },
    { provide: PlanDataSource, useClass: HttpPlanDataSource },
    { provide: CommercialDataSource, useClass: HttpCommercialDataSource },
    { provide: NudgeDataSource, useClass: HttpNudgeDataSource },
    // Slice 2: levy accounts and receipts (2a); billing runs, meter readings, levy settings and My work (2b).
    { provide: AccountDataSource, useClass: HttpAccountDataSource },
    { provide: ReceiptDataSource, useClass: HttpReceiptDataSource },
    { provide: BillingDataSource, useClass: HttpBillingDataSource },
    { provide: MeterDataSource, useClass: HttpMeterDataSource },
    { provide: LevyDataSource, useClass: HttpLevyDataSource },
    { provide: WorkItemDataSource, useClass: HttpWorkItemDataSource },
    // Slice 2c: settings, document templates and statements.
    { provide: SettingsDataSource, useClass: HttpSettingsDataSource },
    { provide: DocumentTemplateDataSource, useClass: HttpDocumentTemplateDataSource },
    // Slice 2d: credit control.
    { provide: CollectionDataSource, useClass: HttpCollectionDataSource },
    // R-5: Communications: Sent with delivery results, Compose, templates and notices.
    { provide: CommunicationsDataSource, useClass: HttpCommunicationsDataSource },
    { provide: NoticeDataSource, useClass: HttpNoticeDataSource },
    { provide: InboxDataSource, useClass: HttpInboxDataSource },
    // Slice 3a: maintenance jobs and suppliers. Payables (payment batches) follow.
    { provide: JobDataSource, useClass: HttpJobDataSource },
    { provide: SupplierDataSource, useClass: HttpSupplierDataSource },
    ...pending,
  ]);
}
