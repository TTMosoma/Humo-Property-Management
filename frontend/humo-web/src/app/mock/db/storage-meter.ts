import { Injectable, inject } from '@angular/core';
import { FieldErrors, GB, StorageSummary, isoDay, storageSummary } from '../../domain';
import { CommercialStore } from './commercial-store';
import { LibraryStore } from './library-store';

/** The organisation whose records the mock library holds (the demo agency). */
const LIBRARY_ORGANISATION = 'acacia';

/**
 * DEVELOPMENT / SIMULATION ONLY. A customer's storage: the demo measurement
 * plus anything uploaded to the library since it was taken. The real figure
 * comes from the storage service, and only the API can refuse an upload over
 * quota (docs/23 §5); this stands in for that check in the simulation.
 */
@Injectable({ providedIn: 'root' })
export class StorageMeter {
  private readonly commercial = inject(CommercialStore);
  private readonly library = inject(LibraryStore);

  summary(organisationId: string): StorageSummary | undefined {
    const agreement = this.commercial.agreement(organisationId);
    const base = this.commercial.measurement(organisationId);
    if (!agreement || !base) return undefined;
    // Seeded documents are in the demo measurement already; uploads made in this simulation are added.
    const since = Date.parse(this.commercial.startedAt);
    const uploaded =
      organisationId === LIBRARY_ORGANISATION ? this.library.documents.filter((d) => Date.parse(d.uploadedAt) > since).reduce((n, d) => n + d.sizeBytes, 0) : 0;
    const m = { ...base, documentsBytes: base.documentsBytes + uploaded };
    return storageSummary(agreement, this.commercial.catalogue(), m, isoDay(new Date()));
  }

  /** The simulated API's quota check before it accepts an upload. */
  checkUpload(organisationId: string | undefined, sizeBytes: number): FieldErrors | null {
    const s = organisationId ? this.summary(organisationId) : undefined;
    if (!s || s.totalGb === null) return null;
    if (s.usedBytes + sizeBytes > s.totalGb * GB) {
      return { file: 'Your organisation’s storage is full. Ask your Humo account manager for more storage, or archive files you no longer need.' };
    }
    return null;
  }
}
