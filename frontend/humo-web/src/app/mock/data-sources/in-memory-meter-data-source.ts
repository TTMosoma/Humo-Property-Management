import { Injectable, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, combineLatest, map, switchMap } from 'rxjs';
import { FieldErrors, MeterDataSource, MeterEntry, MeterSheet, MeterSheetRow } from '../../domain';
import { formatRand } from '../../ui/format/money';
import { BillingStore } from '../db/billing-store';
import { MeterStore } from '../db/meter-store';
import { MockDb } from '../db/mock-db';
import { round2 } from '../db/random';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

/**
 * Water meter readings (docs/22 §2). Rules the API enforces:
 * - only schemes that recover water; `Billing.Run`;
 * - a reading can't be lower than the unit's last one (rollovers aren't in v1);
 * - readings change only while the month's run doesn't exist or is still Preparing;
 * - saving while it's Preparing updates the run's water charges and meter exceptions.
 */
@Injectable()
export class InMemoryMeterDataSource extends MeterDataSource {
  private readonly db = inject(MockDb);
  private readonly meters = inject(MeterStore);
  private readonly billing = inject(BillingStore);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();
  private readonly changes$ = combineLatest([toObservable(this.meters.readings), toObservable(this.meters.settings), this.db.changes$]);

  sheet(schemeId: string, period: string): Observable<MeterSheet> {
    return this.changes$.pipe(switchMap(() => this.respond(this.build(schemeId, period))));
  }

  saveReadings(schemeId: string, period: string, readOn: string, entries: MeterEntry[]): Observable<number> {
    const scheme = this.db.schemes.get(schemeId);
    const units = new Map(this.db.units.filter((u) => u.schemeId === schemeId).map((u) => [u.number.toLowerCase(), u]));
    return this.gateway.command(
      {
        action: `Captured ${entries.length} water meter reading${entries.length === 1 ? '' : 's'} for ${scheme?.name ?? schemeId}, ${period}`,
        resource: 'Meter readings',
        resourceId: `${schemeId}|${period}`,
        schemeId,
        permission: 'Billing.Run',
        feature: 'billing',
        validate: (): FieldErrors | null => {
          if (!scheme || !this.meters.recovers(schemeId)) return { schemeId: 'This scheme doesn’t recover water from owners.' };
          if (!/^\d{4}-\d{2}$/.test(period)) return { period: 'Choose the month.' };
          const today = new Date().toISOString().slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(readOn) || readOn > today) return { readOn: 'When were the meters read? Not in the future.' };
          const stage = this.runStage(schemeId, period);
          if (stage && stage !== 'preview') return { period: `The ${period} billing run is ${stage === 'awaiting-approval' ? 'with the approvers' : 'already approved or posted'}. Correct water with a journal, or send the run back to Preparing first.` };
          if (!entries.length) return { entries: 'Enter at least one reading.' };
          const e: FieldErrors = {};
          const seen = new Set<string>();
          for (const x of entries) {
            const unit = units.get(x.unitNumber.toLowerCase());
            const key = `unit-${x.unitNumber}`;
            if (!unit) e[key] = `There’s no unit ${x.unitNumber} in ${scheme.name}.`;
            else if (seen.has(unit.id)) e[key] = `Unit ${x.unitNumber} appears twice.`;
            else if (!(x.reading >= 0)) e[key] = `Unit ${x.unitNumber}: a reading can’t be negative.`;
            else {
              const before = this.meters.previous(unit.id, period);
              if (before && x.reading < before.reading) e[key] = `Unit ${x.unitNumber}: ${x.reading} is lower than the last reading (${before.reading}). Meter replacements aren’t supported yet.`;
            }
            if (unit) seen.add(unit.id);
          }
          return Object.keys(e).length ? e : null;
        },
      },
      () => {
        const by = this.auth.current.identity.name;
        this.meters.save(
          entries.map((x) => {
            const unit = units.get(x.unitNumber.toLowerCase())!;
            return { unitId: unit.id, schemeId, period, reading: round2(x.reading), readOn, capturedBy: by };
          }),
        );
        this.billing.refreshWater(schemeId, period, by);
        return entries.length;
      },
    );
  }

  setRate(schemeId: string, ratePerKl: number, reason: string, expectedVersion?: number): Observable<void> {
    const current = this.meters.setting(schemeId);
    return this.gateway
      .command(
        {
          action: `Set the water rate for ${this.db.schemes.get(schemeId)?.name ?? schemeId} to ${formatRand(ratePerKl)}/kl — ${reason.trim()}`,
          resource: 'Water rate',
          resourceId: schemeId,
          schemeId,
          permission: 'Billing.Run',
          feature: 'billing',
          version: { expected: expectedVersion, current: current.version },
          validate: (): FieldErrors | null => {
            if (!this.meters.recovers(schemeId)) return { schemeId: 'This scheme doesn’t recover water from owners.' };
            if (!(ratePerKl > 0 && ratePerKl < 1000)) return { ratePerKl: 'Enter the rate per kilolitre, in rand.' };
            return reason.trim().length < 5 ? { reason: 'Say why, in a few words. It goes in the audit log.' } : null;
          },
        },
        () => this.meters.setRate(schemeId, ratePerKl, this.auth.current.identity.name),
      )
      .pipe(map(() => undefined));
  }

  private runStage(schemeId: string, period: string) {
    return this.billing.runs.find((r) => r.schemeId === schemeId && r.period === period && r.stage !== 'cancelled')?.stage;
  }

  private build(schemeId: string, period: string): MeterSheet {
    const scheme = this.db.scheme(schemeId);
    const rows: MeterSheetRow[] = this.db.units
      .filter((u) => u.schemeId === schemeId)
      .sort((a, b) => Number(a.number) - Number(b.number) || a.number.localeCompare(b.number))
      .flatMap((u) => {
        const account = this.db.accountForUnit(u.id);
        if (!account) return [];
        const before = this.meters.previous(u.id, period);
        const now = this.meters.reading(u.id, period);
        const usual = this.meters.usual(u.id, period);
        const consumption = now && before ? round2(now.reading - before.reading) : undefined;
        return [
          {
            unitId: u.id,
            unitNumber: u.number,
            accountNo: account.accountNo,
            previous: before ? { period: before.period, reading: before.reading } : undefined,
            reading: now?.reading,
            consumption,
            usual,
            unusual: consumption !== undefined && this.meters.isUnusual(consumption, usual),
          },
        ];
      });
    return {
      schemeId,
      schemeName: scheme.name,
      period,
      setting: this.meters.setting(schemeId),
      rows,
      captured: rows.filter((r) => r.reading !== undefined).length,
      runStage: this.runStage(schemeId, period),
    };
  }
}
