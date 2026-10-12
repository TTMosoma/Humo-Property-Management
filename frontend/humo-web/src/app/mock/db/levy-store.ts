import { Injectable, effect, signal, untracked } from '@angular/core';
import { LevySetting } from '../../domain';
import { simulationStorage } from '../simulation/simulation-storage';

/** DEVELOPMENT / SIMULATION ONLY. Each scheme's levy method (D13); manual unless set. */
@Injectable({ providedIn: 'root' })
export class LevyStore {
  readonly settings = signal<LevySetting[]>(simulationStorage.load<LevySetting[]>('levy-settings') ?? []);

  constructor() {
    effect(() => {
      const all = this.settings();
      untracked(() => simulationStorage.save('levy-settings', () => all));
    });
  }

  setting(schemeId: string): LevySetting {
    return this.settings().find((s) => s.schemeId === schemeId) ?? { schemeId, method: 'manual', version: 0 };
  }

  change(schemeId: string, apply: (s: LevySetting) => Omit<LevySetting, 'version'>): void {
    const current = this.setting(schemeId);
    const next = { ...apply(current), version: current.version + 1 };
    this.settings.update((all) => [...all.filter((s) => s.schemeId !== schemeId), next]);
  }
}
