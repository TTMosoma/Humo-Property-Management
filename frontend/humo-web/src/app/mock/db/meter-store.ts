import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { MeterReading, UNUSUAL_FACTOR, WaterSetting } from '../../domain';
import { simulationStorage } from '../simulation/simulation-storage';
import { MockDb } from './mock-db';
import { round2, seeded } from './random';
import { SCHEME_CHARGES } from './seed-portfolio';

interface Snapshot {
  readings: MeterReading[];
  settings: WaterSetting[];
}

/** Rand per kilolitre until a scheme sets its own. */
export const DEFAULT_RATE_PER_KL = 42.5;

/** "2026-10" plus n months. */
export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * DEVELOPMENT / SIMULATION ONLY. Water meter readings and each scheme's rate
 * (docs/22 §2). Seeded with the last four months' readings for the schemes
 * that recover water, so next month has a previous reading and a usual
 * consumption to compare against.
 */
@Injectable({ providedIn: 'root' })
export class MeterStore {
  private readonly db = inject(MockDb);
  private readonly saved = simulationStorage.load<Snapshot>('meters');
  readonly readings = signal<MeterReading[]>(this.saved?.readings ?? this.seed());
  readonly settings = signal<WaterSetting[]>(this.saved?.settings ?? []);

  constructor() {
    effect(() => {
      const snapshot: Snapshot = { readings: this.readings(), settings: this.settings() };
      untracked(() => simulationStorage.save('meters', () => snapshot));
    });
  }

  recovers(schemeId: string): boolean {
    return !!SCHEME_CHARGES[schemeId]?.waterRecovery;
  }

  setting(schemeId: string): WaterSetting {
    return this.settings().find((s) => s.schemeId === schemeId) ?? { schemeId, ratePerKl: DEFAULT_RATE_PER_KL, version: 0 };
  }

  setRate(schemeId: string, ratePerKl: number, by: string): void {
    const current = this.setting(schemeId);
    const next: WaterSetting = { schemeId, ratePerKl: round2(ratePerKl), version: current.version + 1, updatedBy: by, updatedAt: new Date().toISOString() };
    this.settings.update((all) => [...all.filter((s) => s.schemeId !== schemeId), next]);
  }

  reading(unitId: string, period: string): MeterReading | undefined {
    return this.readings().find((r) => r.unitId === unitId && r.period === period);
  }

  /** The latest reading before the period. */
  previous(unitId: string, period: string): MeterReading | undefined {
    return this.readings()
      .filter((r) => r.unitId === unitId && r.period < period)
      .sort((a, b) => b.period.localeCompare(a.period))[0];
  }

  /** Average monthly consumption over the three months before the period, or undefined without enough history. */
  usual(unitId: string, period: string): number | undefined {
    const history = this.readings()
      .filter((r) => r.unitId === unitId && r.period < period)
      .sort((a, b) => b.period.localeCompare(a.period))
      .slice(0, 4);
    if (history.length < 2) return undefined;
    const used = history.slice(0, -1).map((r, i) => r.reading - history[i + 1].reading);
    return round2(used.reduce((s, x) => s + x, 0) / used.length);
  }

  /** Has anyone captured readings for this scheme and month? (Until then, billing behaves as before.) */
  inUse(schemeId: string, period: string): boolean {
    return this.readings().some((r) => r.schemeId === schemeId && r.period === period);
  }

  isUnusual(consumption: number, usual: number | undefined): boolean {
    return usual !== undefined && usual > 0 && consumption > UNUSUAL_FACTOR * usual;
  }

  save(list: Omit<MeterReading, 'capturedAt'>[]): void {
    const at = new Date().toISOString();
    const key = (r: { unitId: string; period: string }) => `${r.unitId}|${r.period}`;
    const replaced = new Set(list.map(key));
    this.readings.update((all) => [...all.filter((r) => !replaced.has(key(r))), ...list.map((r) => ({ ...r, capturedAt: at }))]);
  }

  private seed(): MeterReading[] {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const out: MeterReading[] = [];
    for (const unit of this.db.units.filter((u) => SCHEME_CHARGES[u.schemeId]?.waterRecovery)) {
      const r = seeded(`meter-${unit.id}`);
      let reading = Math.round(300 + r() * 900);
      for (let n = -3; n <= 0; n++) {
        const period = addMonths(thisMonth, n);
        out.push({ unitId: unit.id, schemeId: unit.schemeId, period, reading, readOn: `${period}-25`, capturedBy: 'Imported at onboarding', capturedAt: `${period}-25T10:00:00.000Z` });
        reading += Math.round(8 + r() * 14);
      }
    }
    return out;
  }
}
