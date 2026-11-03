import { Injectable } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { ApiError, BreachAction, BreachView, NewBreach, RuleAction, RulesDataSource, RulesView } from '../domain';
import { HttpPort } from './http-port';
import { DataTopic } from '../core/data/data-changes';

const RULES: DataTopic[] = ['rules', 'documents'];
const BREACHES: DataTopic[] = ['rules', 'work-items', 'communications'];

/**
 * Scheme rules and the breach log over HTTP (doc 15 §6, D29). The API requires a resolution for each change to a rule,
 * prints the shared rule book to PDF, sends warning letters through Communications and raises the follow-up tasks.
 */
@Injectable()
export class HttpRulesDataSource extends HttpPort implements RulesDataSource {
  rules(schemeId: string): Observable<RulesView | undefined> {
    return this.live<RulesView>(`/rules/${schemeId}`, ['rules', 'documents']).pipe(catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))));
  }

  actRules(schemeId: string, action: RuleAction, file?: File): Observable<string | void> {
    if (action.type !== 'upload') {
      return this.command<{ id: string } | null>('POST', `/rules/${schemeId}/actions`, action, RULES).pipe(map((r) => r?.id));
    }
    if (!file) return throwError(() => new ApiError('validation', 'Choose the rules PDF.', { file: 'Choose the rules PDF.' }));
    const form = new FormData();
    form.append('adoptedOn', action.adoptedOn);
    form.append('resolutionRef', action.resolutionRef);
    form.append('shareWithOwners', String(action.shareWithOwners));
    form.append('file', file, file.name);
    return this.createId(`/rules/${schemeId}/upload`, form, RULES);
  }

  breaches(schemeIds: string[]): Observable<BreachView[]> {
    return this.live<BreachView[]>('/breaches', BREACHES, { schemeIds });
  }

  breach(id: string): Observable<BreachView | undefined> {
    return this.live<BreachView>(`/breaches/${id}`, BREACHES).pipe(catchError((e) => (e.kind === 'not-found' ? of(undefined) : throwError(() => e))));
  }

  logBreach(input: NewBreach): Observable<string> {
    return this.createId('/breaches', input, ['rules', 'work-items']);
  }

  actBreach(id: string, action: BreachAction, expectedVersion?: number): Observable<void> {
    return this.command('POST', `/breaches/${id}/actions`, { action, expectedVersion }, BREACHES);
  }
}
