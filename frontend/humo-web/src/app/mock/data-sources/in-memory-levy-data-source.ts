import { Injectable, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, combineLatest, map, switchMap } from 'rxjs';
import { FieldErrors, LEVY_METHOD_LABELS, LevyDataSource, LevyMethod, LevyRollProposal, LevySetting, derivedLevy } from '../../domain';
import { BillingStore } from '../db/billing-store';
import { BudgetStore } from '../db/budget-store';
import { LevyStore } from '../db/levy-store';
import { MockDb } from '../db/mock-db';
import { round2 } from '../db/random';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

const IN_PROGRESS = ['preview', 'awaiting-approval', 'approved'];

/**
 * D13: each scheme's levies are entered per unit, or derived from the approved
 * budget. A derived roll is only ever proposed; a person applies it, and it
 * takes effect from the next billing run. Rules the API enforces:
 * - Billing.Run and the billing entitlement; a reason for every change;
 * - applying needs the budget method, an approved budget with Levies income,
 *   and no billing run in progress for the scheme.
 */
@Injectable()
export class InMemoryLevyDataSource extends LevyDataSource {
  private readonly db = inject(MockDb);
  private readonly levies = inject(LevyStore);
  private readonly budgets = inject(BudgetStore);
  private readonly billing = inject(BillingStore);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();
  private readonly changes$ = combineLatest([toObservable(this.levies.settings), this.db.changes$]);

  setting(schemeId: string): Observable<LevySetting> {
    return this.changes$.pipe(switchMap(() => this.respond(this.levies.setting(schemeId))));
  }

  proposal(schemeId: string): Observable<LevyRollProposal | undefined> {
    return this.changes$.pipe(switchMap(() => this.respond(this.build(schemeId))));
  }

  setMethod(schemeId: string, method: LevyMethod, reason: string, expectedVersion?: number): Observable<void> {
    const current = this.levies.setting(schemeId);
    const scheme = this.db.schemes.get(schemeId);
    return this.gateway
      .command(
        {
          action: `Set how ${scheme?.name ?? schemeId}’s levies are set: ${LEVY_METHOD_LABELS[method]} — ${reason.trim()}`,
          resource: 'Levy setting',
          resourceId: schemeId,
          schemeId,
          permission: 'Billing.Run',
          feature: 'billing',
          version: { expected: expectedVersion, current: current.version },
          validate: (): FieldErrors | null => {
            if (!scheme) return { schemeId: 'Choose the scheme.' };
            if (!(method in LEVY_METHOD_LABELS)) return { method: 'Choose how levies are set.' };
            if (method === current.method) return { method: 'That’s already how this scheme’s levies are set.' };
            return reason.trim().length < 5 ? { reason: 'Say why, in a few words. It goes in the audit log.' } : null;
          },
        },
        // Switching back to manual keeps the current amounts: nothing is recalculated.
        () => this.levies.change(schemeId, (s) => ({ ...s, method, updatedBy: this.auth.current.identity.name, updatedAt: new Date().toISOString() })),
      )
      .pipe(map(() => undefined));
  }

  apply(schemeId: string, budgetId: string, reason: string, expectedVersion?: number): Observable<number> {
    const current = this.levies.setting(schemeId);
    const p = this.build(schemeId);
    const scheme = this.db.schemes.get(schemeId);
    return this.gateway.command(
      {
        action: `Applied the ${p?.budgetYear ?? ''} budget levy roll to ${scheme?.name ?? schemeId} from ${p?.fromPeriod ?? '?'} — ${reason.trim()}`,
        resource: 'Levy roll',
        resourceId: schemeId,
        schemeId,
        amount: p?.proposedRoll,
        permission: 'Billing.Run',
        feature: 'billing',
        version: { expected: expectedVersion, current: current.version },
        validate: (): FieldErrors | null => {
          if (current.method !== 'budget') return { method: 'This scheme’s levies are entered per unit. Choose “Derived from the approved budget” first.' };
          if (!p || p.budgetId !== budgetId) return { budgetId: 'That budget isn’t the scheme’s approved budget any more. Reload the proposal.' };
          if (p.blocked) return { budgetId: p.blocked };
          return reason.trim().length < 5 ? { reason: 'Say why, in a few words. It goes in the audit log.' } : null;
        },
      },
      () => {
        const by = this.auth.current.identity.name;
        let changed = 0;
        for (const r of p!.rows) {
          if (Math.abs(r.current - r.proposed) < 0.005) continue;
          this.db.changeUnit(r.unitId, (u) => ({ ...u, monthlyLevy: r.proposed }));
          changed++;
        }
        this.levies.change(schemeId, (s) => ({ ...s, applied: { budgetId, year: p!.budgetYear, at: new Date().toISOString(), by, fromPeriod: p!.fromPeriod, units: changed } }));
        return changed;
      },
    );
  }

  /** The latest approved budget with Levies income, applied to the scheme's quotas. */
  private build(schemeId: string): LevyRollProposal | undefined {
    const budget = this.budgets.budgets
      .filter((b) => b.schemeId === schemeId && b.status === 'approved')
      .sort((a, b) => b.from.localeCompare(a.from))
      .find((b) => b.lines.some((l) => l.kind === 'income' && l.category === 'Levies' && l.annual > 0));
    if (!budget) return undefined;
    const annualLevies = budget.lines.find((l) => l.kind === 'income' && l.category === 'Levies')!.annual;
    const units = this.db.units
      .filter((u) => u.schemeId === schemeId)
      .sort((a, b) => Number(a.number) - Number(b.number) || a.number.localeCompare(b.number))
      .map((u) => ({ u, account: this.db.accountForUnit(u.id) }))
      .filter((x) => !!x.account);
    const quotaTotal = units.reduce((sum, x) => sum + x.u.participationQuota, 0);
    const rows = units.map(({ u, account }) => {
      const proposed = derivedLevy(annualLevies, u.participationQuota, quotaTotal);
      return {
        unitId: u.id,
        unitNumber: u.number,
        accountNo: account!.accountNo,
        quota: u.participationQuota,
        share: quotaTotal ? u.participationQuota / quotaTotal : 0,
        current: u.monthlyLevy,
        proposed,
        change: round2(proposed - u.monthlyLevy),
      };
    });
    const status = this.billing.status(schemeId);
    const running = this.billing.runs.find((r) => r.schemeId === schemeId && IN_PROGRESS.includes(r.stage));
    const proposedRoll = round2(rows.reduce((sum, r) => sum + r.proposed, 0));
    const budgetMonthly = round2(annualLevies / 12);
    return {
      schemeId,
      budgetId: budget.id,
      budgetYear: budget.year,
      annualLevies,
      rows,
      currentRoll: round2(rows.reduce((sum, r) => sum + r.current, 0)),
      proposedRoll,
      budgetMonthly,
      roundingDifference: round2(budgetMonthly - proposedRoll),
      fromPeriod: status.nextPeriod,
      blocked:
        quotaTotal <= 0
          ? 'The units have no participation quotas.'
          : running
            ? `The ${running.period} billing run is in progress (${running.ref}). Post or cancel it first, so the new levies start cleanly with the next run.`
            : undefined,
    };
  }
}
