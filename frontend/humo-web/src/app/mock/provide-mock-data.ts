import { EnvironmentProviders, inject, makeEnvironmentProviders, provideAppInitializer } from '@angular/core';
import {
  AccessDataSource,
  AccountDataSource,
  AuditDataSource,
  CatalogueDataSource,
  DocumentTemplateDataSource,
  MeetingDataSource,
  BillingDataSource,
  CollectionDataSource,
  ComplianceDataSource,
  LibraryDataSource,
  SettingsDataSource,
  ReportDataSource,
  NoticeDataSource,
  OpsDataSource,
  ResolutionDataSource,
  PlatformTemplateDataSource,
  NotificationDataSource,
  NudgeDataSource,
  OrganisationDataSource,
  PlanDataSource,
  PlatformDataSource,
  SecurityDataSource,
  StepUpAuthenticator,
  JobDataSource,
  PayablesDataSource,
  PersonDataSource,
  SupplierDataSource,
  ReceiptDataSource,
  SchemeDataSource,
  SessionDataSource,
  TimelineDataSource,
  UnitDataSource,
  WorkItemDataSource,
} from '../domain';
import {
  InMemoryAccountDataSource,
  InMemoryPersonDataSource,
  InMemoryReceiptDataSource,
  InMemoryTimelineDataSource,
  InMemoryUnitDataSource,
} from './data-sources/in-memory-portfolio-data-sources';
import {
  InMemoryJobDataSource,
  InMemoryPayablesDataSource,
  InMemorySupplierDataSource,
} from './data-sources/in-memory-maintenance-data-sources';
import {
  InMemoryAccessDataSource,
  InMemoryAuditDataSource,
  InMemorySecurityDataSource,
  InMemorySessionDataSource,
  InMemoryStepUpAuthenticator,
} from './data-sources/in-memory-access-data-sources';
import { InMemoryNotificationDataSource, InMemoryOrganisationDataSource } from './data-sources/in-memory-organisation-data-sources';
import { ContractorNetwork, ContractorPortal } from '../domain/contractor';
import { InMemoryContractorNetwork, InMemoryContractorPortal } from './contractor/in-memory-contractor';
import { InMemoryCatalogueDataSource, InMemoryNudgeDataSource, InMemoryPlanDataSource, InMemoryPlatformDataSource } from './data-sources/in-memory-platform-data-sources';
import { InMemorySchemeDataSource } from './data-sources/in-memory-scheme-data-source';
import { InMemoryDocumentTemplateDataSource, InMemoryPlatformTemplateDataSource } from './data-sources/in-memory-document-data-sources';
import { InMemoryMeetingDataSource, InMemoryResolutionDataSource } from './data-sources/in-memory-governance-data-sources';
import { GovernanceStore } from './db/governance-store';
import { InMemoryBillingDataSource, InMemoryCollectionDataSource } from './data-sources/in-memory-finance-data-sources';
import { BillingStore } from './db/billing-store';
import { CollectionsStore } from './db/collections-store';
import { InMemoryComplianceDataSource, InMemoryLibraryDataSource, InMemoryNoticeDataSource } from './data-sources/in-memory-records-data-sources';
import { ComplianceStore } from './db/compliance-store';
import { InMemorySettingsDataSource } from './data-sources/in-memory-settings-data-source';
import { InMemoryReportDataSource } from './data-sources/in-memory-report-data-source';
import { InMemoryOpsDataSource } from './data-sources/in-memory-ops-data-source';
import { PrototypeControls } from '../core/prototype/prototype-controls';
import { MaintenanceStore } from './db/maintenance-store';
import { MockPrototypeControls } from './prototype/mock-prototype-controls';
import { InMemoryWorkItemDataSource } from './data-sources/in-memory-work-item-data-source';

/**
 * Binds every data-source port to its in-memory implementation.
 * When the .NET API exists, replace this with provideHttpData() in app.config.ts.
 */
export function provideMockData(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: SessionDataSource, useClass: InMemorySessionDataSource },
    { provide: OrganisationDataSource, useClass: InMemoryOrganisationDataSource },
    { provide: NotificationDataSource, useClass: InMemoryNotificationDataSource },
    { provide: SchemeDataSource, useClass: InMemorySchemeDataSource },
    { provide: WorkItemDataSource, useClass: InMemoryWorkItemDataSource },
    { provide: UnitDataSource, useClass: InMemoryUnitDataSource },
    { provide: PersonDataSource, useClass: InMemoryPersonDataSource },
    { provide: AccountDataSource, useClass: InMemoryAccountDataSource },
    { provide: ReceiptDataSource, useClass: InMemoryReceiptDataSource },
    { provide: TimelineDataSource, useClass: InMemoryTimelineDataSource },
    { provide: JobDataSource, useClass: InMemoryJobDataSource },
    { provide: SupplierDataSource, useClass: InMemorySupplierDataSource },
    { provide: PayablesDataSource, useClass: InMemoryPayablesDataSource },
    { provide: AccessDataSource, useClass: InMemoryAccessDataSource },
    { provide: AuditDataSource, useClass: InMemoryAuditDataSource },
    { provide: SecurityDataSource, useClass: InMemorySecurityDataSource },
    { provide: StepUpAuthenticator, useClass: InMemoryStepUpAuthenticator },
    { provide: PlatformDataSource, useClass: InMemoryPlatformDataSource },
    { provide: PlanDataSource, useClass: InMemoryPlanDataSource },
    { provide: NudgeDataSource, useClass: InMemoryNudgeDataSource },
    { provide: CatalogueDataSource, useClass: InMemoryCatalogueDataSource },
    { provide: DocumentTemplateDataSource, useClass: InMemoryDocumentTemplateDataSource },
    { provide: PlatformTemplateDataSource, useClass: InMemoryPlatformTemplateDataSource },
    { provide: MeetingDataSource, useClass: InMemoryMeetingDataSource },
    { provide: ResolutionDataSource, useClass: InMemoryResolutionDataSource },
    { provide: BillingDataSource, useClass: InMemoryBillingDataSource },
    { provide: CollectionDataSource, useClass: InMemoryCollectionDataSource },
    { provide: LibraryDataSource, useClass: InMemoryLibraryDataSource },
    { provide: ComplianceDataSource, useClass: InMemoryComplianceDataSource },
    { provide: SettingsDataSource, useClass: InMemorySettingsDataSource },
    { provide: ReportDataSource, useClass: InMemoryReportDataSource },
    { provide: NoticeDataSource, useClass: InMemoryNoticeDataSource },
    { provide: OpsDataSource, useClass: InMemoryOpsDataSource },
    // Humo Contractor — a separate product's capabilities, consumed by Humo PM.
    { provide: ContractorNetwork, useClass: InMemoryContractorNetwork },
    { provide: ContractorPortal, useClass: InMemoryContractorPortal },
    // Prototype-only review tools (toolbar, "sign in as"). Not provided by the HTTP data layer.
    { provide: PrototypeControls, useClass: MockPrototypeControls },
    // Start the maintenance store eagerly so approvals decided anywhere update their jobs.
    provideAppInitializer(() => void inject(MaintenanceStore)),
    // …and the governance store, so meeting actions completed in Tasks and minutes approved in Approvals update their meetings.
    provideAppInitializer(() => void inject(GovernanceStore)),
    // …billing (runs approved in Approvals move on) and credit control (letters of demand approved there).
    provideAppInitializer(() => void inject(BillingStore)),
    provideAppInitializer(() => void inject(CollectionsStore)),
    // …and compliance, which keeps a Task open for every item that's due soon or overdue.
    provideAppInitializer(() => void inject(ComplianceStore)),
  ]);
}
