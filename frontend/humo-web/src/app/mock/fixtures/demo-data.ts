import { CommercialAddOn, CommercialAgreement, CommercialPackage, CommercialSettings, HumoInvoice, PaymentRecord, StorageMeasurement } from '../../domain';
import agreements from '../../../../../../demo-data/commercial/agreements.json';
import catalogue from '../../../../../../demo-data/commercial/catalogue.json';
import invoices from '../../../../../../demo-data/commercial/invoices.json';
import payments from '../../../../../../demo-data/commercial/payments.json';
import settings from '../../../../../../demo-data/commercial/settings.json';
import storage from '../../../../../../demo-data/commercial/storage-usage.json';
import accountManagers from '../../../../../../demo-data/platform/account-managers.json';
import manifest from '../../../../../../demo-data/manifest.json';

/**
 * DEVELOPMENT / SIMULATION ONLY. The canonical demo dataset (`/demo-data`,
 * docs/demo/demo-data-strategy.md), typed for the mock stores. The same JSON is
 * what the .NET demo seeder will read, so the frontend and the backend start
 * from one baseline. Stores copy what they need (`structuredClone`): the
 * fixtures themselves never change at runtime.
 */
export const DEMO_DATA = {
  manifest: manifest as { dataset: string; version: string; baselineDate: string },
  catalogue: catalogue as unknown as { packages: CommercialPackage[]; addOns: CommercialAddOn[] },
  settings: settings as unknown as CommercialSettings,
  agreements: (agreements as unknown as { agreements: CommercialAgreement[] }).agreements,
  storage: (storage as unknown as { measurements: StorageMeasurement[] }).measurements,
  invoices: (invoices as unknown as { invoices: HumoInvoice[] }).invoices,
  payments: (payments as unknown as { payments: PaymentRecord[] }).payments,
  accountManagers: accountManagers as { assignments: { organisationId: string; accountManagerId: string }[]; rotation: string[] },
};
