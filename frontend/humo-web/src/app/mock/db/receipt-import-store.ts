import { Injectable, effect, signal, untracked } from '@angular/core';
import { StatementImportBatch, StatementMapping } from '../../domain';
import { simulationStorage } from '../simulation/simulation-storage';

interface Snapshot {
  mappings: [string, StatementMapping][];
  batches: StatementImportBatch[];
  seq: number;
}

/**
 * DEVELOPMENT / SIMULATION ONLY. Bank-statement column mappings (one per
 * scheme's trust account) and the record of each import (docs/22 §1).
 */
@Injectable({ providedIn: 'root' })
export class ReceiptImportStore {
  private readonly saved = simulationStorage.load<Snapshot>('receipt-imports');
  readonly mappings = signal(new Map<string, StatementMapping>(this.saved?.mappings ?? []));
  readonly batches = signal<StatementImportBatch[]>(this.saved?.batches ?? []);
  private seq = this.saved?.seq ?? 1;

  constructor() {
    effect(() => {
      const snapshot = { mappings: [...this.mappings()], batches: this.batches() };
      untracked(() => simulationStorage.save('receipt-imports', (): Snapshot => ({ ...snapshot, seq: this.seq })));
    });
  }

  remember(schemeId: string, mapping: StatementMapping): void {
    this.mappings.update((m) => new Map(m).set(schemeId, mapping));
  }

  record(batch: Omit<StatementImportBatch, 'id'>): string {
    const id = `imp-${this.seq++}`;
    this.batches.update((all) => [{ ...batch, id }, ...all]);
    return id;
  }
}
