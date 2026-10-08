import { Injectable, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, combineLatest, map, of, switchMap } from 'rxjs';
import { AppNotification, NotificationDataSource, Organisation, OrganisationDataSource, isHumoRole } from '../../domain';
import { NOTIFICATIONS } from '../fixtures/notifications';
import { ORGANISATIONS } from '../fixtures/organisations';
import { SCHEMES } from '../fixtures/schemes';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';

@Injectable()
export class InMemoryOrganisationDataSource extends OrganisationDataSource {
  private readonly auth = inject(MockAuthSession);
  private readonly respond = mockResponder();

  /** Humo staff: every organisation. Everyone else: only their own. Live: follows role switches. */
  list(): Observable<Organisation[]> {
    return this.auth.session$.pipe(
      switchMap((s) => {
        const role = s.assignments.find((a) => a.id === s.activeAssignmentId)?.role;
        return this.respond(role && isHumoRole(role) ? ORGANISATIONS : ORGANISATIONS.filter((o) => o.id === s.organisation?.id));
      }),
    );
  }

  get(id: string): Observable<Organisation | undefined> {
    return this.list().pipe(map((all) => all.find((o) => o.id === id)));
  }
}

/** "unit-kc-042" → "Unit 42", the label notifications use. */
function unitLabelOf(unitId: string | undefined): string | undefined {
  const n = unitId?.match(/(\d+)$/)?.[1];
  return n ? `Unit ${Number(n)}` : undefined;
}

@Injectable()
export class InMemoryNotificationDataSource extends NotificationDataSource {
  private readonly auth = inject(MockAuthSession);
  private readonly respond = mockResponder();
  private readonly read = signal<Set<string>>(new Set());
  private readonly read$ = toObservable(this.read);

  /** The server filters by audience (role), scheme scope and, for residents, their unit. */
  list(): Observable<AppNotification[]> {
    return combineLatest([this.auth.session$, this.read$]).pipe(
      switchMap(([s, read]) => {
        const a = s.assignments.find((x) => x.id === s.activeAssignmentId);
        if (!a) return of([]);
        const schemes =
          a.scope.type === 'organisation'
            ? new Set(SCHEMES.filter((x) => x.organisationId === a.scope.organisationId).map((x) => x.id))
            : new Set(a.scope.schemeIds);
        const unit = unitLabelOf(a.scope.unitId);
        return this.respond(
          NOTIFICATIONS.filter((n) => n.audience.includes(a.role))
            .filter((n) => n.schemeId === null || schemes.has(n.schemeId))
            .filter((n) => !n.unitLabel || n.unitLabel === unit)
            .map((n) => (read.has(n.id) ? { ...n, read: true } : n)),
        );
      }),
    );
  }

  markRead(ids: string[]): Observable<void> {
    this.read.update((s) => new Set([...s, ...ids]));
    return of(undefined);
  }
}
