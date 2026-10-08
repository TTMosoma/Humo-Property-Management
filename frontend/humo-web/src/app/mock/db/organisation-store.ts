import { Injectable, effect, signal, untracked } from '@angular/core';
import { Organisation } from '../../domain';
import { ORGANISATIONS } from '../fixtures/organisations';
import { simulationStorage } from '../simulation/simulation-storage';

/**
 * The simulated backend's organisations table. Seeded from the fixtures; every
 * change is kept in this browser (development / simulation only).
 */
@Injectable({ providedIn: 'root' })
export class OrganisationStore {
  readonly all = signal<Organisation[]>(simulationStorage.load<Organisation[]>('organisations') ?? structuredClone(ORGANISATIONS));

  constructor() {
    effect(() => {
      const snapshot = this.all();
      untracked(() => simulationStorage.save('organisations', () => snapshot));
    });
  }

  get(id: string | null | undefined): Organisation | undefined {
    return id ? this.all().find((o) => o.id === id) : undefined;
  }

  add(org: Organisation): void {
    this.all.update((all) => [...all, org]);
  }

  /** Applies a change and bumps the version. */
  change(id: string, apply: (o: Organisation) => Organisation): void {
    this.all.update((all) => all.map((o) => (o.id === id ? { ...apply(o), version: o.version + 1 } : o)));
  }
}
