import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import {
  AccountDataSource,
  PersonDataSource,
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
import { InMemorySchemeDataSource } from './data-sources/in-memory-scheme-data-source';
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
  ]);
}
