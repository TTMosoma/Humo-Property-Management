import { EnvironmentProviders, inject, makeEnvironmentProviders, provideAppInitializer } from '@angular/core';
import {
  AccessDataSource,
  AccountDataSource,
  AuditDataSource,
  NudgeDataSource,
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
  InMemoryStepUpAuthenticator,
} from './data-sources/in-memory-access-data-sources';
import { ContractorNetwork, ContractorPortal } from '../domain/contractor';
import { InMemoryContractorNetwork, InMemoryContractorPortal } from './contractor/in-memory-contractor';
import { InMemoryNudgeDataSource, InMemoryPlanDataSource, InMemoryPlatformDataSource } from './data-sources/in-memory-platform-data-sources';
import { InMemorySchemeDataSource } from './data-sources/in-memory-scheme-data-source';
import { MaintenanceStore } from './db/maintenance-store';
import { InMemoryWorkItemDataSource } from './data-sources/in-memory-work-item-data-source';

/**
 * Binds every data-source port to its in-memory implementation.
 * When the .NET API exists, replace this with provideHttpData() in app.config.ts.
 */
export function provideMockData(): EnvironmentProviders {
  return makeEnvironmentProviders([
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
    // Humo Contractor — a separate product's capabilities, consumed by Humo PM.
    { provide: ContractorNetwork, useClass: InMemoryContractorNetwork },
    { provide: ContractorPortal, useClass: InMemoryContractorPortal },
    // Start the maintenance store eagerly so approvals decided anywhere update their jobs.
    provideAppInitializer(() => void inject(MaintenanceStore)),
  ]);
}
