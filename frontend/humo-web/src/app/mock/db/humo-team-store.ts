import { Injectable, effect, signal, untracked } from '@angular/core';
import { PendingHumoGrant } from '../../domain';
import { simulationStorage } from '../simulation/simulation-storage';

/**
 * DEVELOPMENT / SIMULATION ONLY. System Administrator grants waiting for a
 * second System Administrator. Everything else about the Humo team lives on
 * the identities in AccessStore.
 */
@Injectable({ providedIn: 'root' })
export class HumoTeamStore {
  readonly pending = signal<PendingHumoGrant[]>(simulationStorage.load<{ pending: PendingHumoGrant[] }>('humo-team')?.pending ?? []);
  private seq = 1;

  constructor() {
    effect(() => {
      const pending = this.pending();
      untracked(() => simulationStorage.save('humo-team', () => ({ pending })));
    });
  }

  add(g: Omit<PendingHumoGrant, 'id'>): PendingHumoGrant {
    const grant = { ...g, id: `hg-${Date.now()}-${this.seq++}` };
    this.pending.update((all) => [...all, grant]);
    return grant;
  }

  remove(id: string): void {
    this.pending.update((all) => all.filter((g) => g.id !== id));
  }
}
