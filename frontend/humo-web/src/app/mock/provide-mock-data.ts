import { EnvironmentProviders, inject, makeEnvironmentProviders, provideAppInitializer } from '@angular/core';
import {
  AccessDataSource,
  AccountDataSource,
  AuditDataSource,
  CatalogueDataSource,
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
    // Humo Contractor — a separate product's capabilities, consumed by Humo PM.
    { provide: ContractorNetwork, useClass: InMemoryContractorNetwork },
    { provide: ContractorPortal, useClass: InMemoryContractorPortal },
    // Prototype-only review tools (toolbar, "sign in as"). Not provided by the HTTP data layer.
    { provide: PrototypeControls, useClass: MockPrototypeControls },
    // Start the maintenance store eagerly so approvals decided anywhere update their jobs.
    provideAppInitializer(() => void inject(MaintenanceStore)),
  ]);
}
