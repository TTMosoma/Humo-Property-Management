import { Injectable } from '@angular/core';
import { Observable, catchError, of, throwError } from 'rxjs';
import { BudgetAction, BudgetDataSource, BudgetView, ComplianceProfile, NewBudget } from '../domain';
import { HttpPort } from './http-port';

/**
 * Finance › Budgets over HTTP (D28): each scheme's budget with actuals from levies billed and supplier invoices, next
 * year's drafts, this year's captured part-way, and the owners' approval recorded by hand until meetings are on the API.
 */
@Injectable()
export class HttpBudgetDataSource extends HttpPort implements BudgetDataSource {
  list(schemeIds: string[]): Observable<BudgetView[]> {
    return this.live<BudgetView[]>('/budgets', ['budgets', 'payables', 'billing', 'schemes'], { schemeIds });
  }

  get(id: string): Observable<BudgetView | undefined> {
    return this.live<BudgetView>(`/budgets/${id}`, ['budgets', 'payables', 'billing', 'schemes']).pipe(
      catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))),
    );
  }

  create(input: NewBudget): Observable<string> {
    return this.createId('/budgets', input, ['budgets', 'schemes', 'settings']);
  }

  act(id: string, action: BudgetAction, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/budgets/${id}/actions`, { action, expectedVersion }, ['budgets', 'work-items']);
  }
}

/** The scheme facts budgets and compliance follow (financial year end, lifts): the part of Compliance already on the API. */
@Injectable()
export class HttpComplianceProfiles extends HttpPort {
  profiles(schemeIds: string[]): Observable<ComplianceProfile[]> {
    return this.live<ComplianceProfile[]>('/settings/compliance-profiles', ['settings', 'schemes'], { schemeIds });
  }

  update(profile: ComplianceProfile): Observable<void> {
    return this.command('PUT', `/settings/compliance-profiles/${profile.schemeId}`, { financialYearEnd: profile.financialYearEnd, hasLifts: profile.hasLifts }, ['settings', 'schemes', 'budgets']);
  }
}
