import { EnvironmentProviders, inject, makeEnvironmentProviders, provideAppInitializer } from '@angular/core';
import {
  AccountDataSource,
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
    // Start the maintenance store eagerly so approvals decided anywhere update their jobs.
    provideAppInitializer(() => void inject(MaintenanceStore)),
  ]);
}
