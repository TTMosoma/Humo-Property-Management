import { Injectable, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, combineLatest, map, of, switchMap } from 'rxjs';
import {
  AppNotification,
  FieldErrors,
  NotificationDataSource,
  Organisation,
  OrganisationDataSource,
  OrganisationDetails,
  OrganisationStatus,
  Role,
  isHumoRole,
} from '../../domain';
import { AccountRequestStore } from '../db/account-request-store';
import { NOTIFICATIONS } from '../fixtures/notifications';
import { MockDb } from '../db/mock-db';
import { ResidentNotifications } from './resident-notifications';
import { OrganisationStore } from '../db/organisation-store';
import { PlatformStore } from '../db/platform-store';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];

/** Which lifecycle moves the API allows. */
const ALLOWED: Record<OrganisationStatus, OrganisationStatus[]> = {
  onboarding: ['active', 'suspended', 'archived'],
  active: ['suspended', 'archived'],
  suspended: ['active', 'archived'],
  archived: ['active'],
};

const VERB: Record<OrganisationStatus, string> = { onboarding: 'Moved to onboarding', active: 'Activated', suspended: 'Suspended', archived: 'Archived' };

@Injectable()
export class InMemoryOrganisationDataSource extends OrganisationDataSource {
  private readonly auth = inject(MockAuthSession);
  private readonly orgs = inject(OrganisationStore);
  private readonly platform = inject(PlatformStore);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();
  private readonly all$ = toObservable(this.orgs.all);

  /** Humo staff: every organisation. Everyone else: only their own. Live: follows role switches and edits. */
  list(): Observable<Organisation[]> {
    return combineLatest([this.auth.session$, this.all$]).pipe(
      switchMap(([s, all]) => {
        const role = s.assignments.find((a) => a.id === s.activeAssignmentId)?.role;
        return this.respond(role && isHumoRole(role) ? all : all.filter((o) => o.id === s.organisation?.id));
      }),
    );
  }

  get(id: string): Observable<Organisation | undefined> {
    return this.list().pipe(map((all) => all.find((o) => o.id === id)));
  }

  update(id: string, details: OrganisationDetails, expectedVersion?: number): Observable<void> {
    const org = this.orgs.get(id);
    return this.gateway
      .command(
        {
          action: `Updated organisation details for ${details.shortName}`,
          resource: 'Organisation',
          resourceId: id,
          permission: 'Platform.Customers.Manage',
          version: { expected: expectedVersion, current: org?.version },
          validate: () => this.check(details, id),
        },
        () => {
          this.orgs.change(id, (o) => ({ ...o, name: details.name.trim(), shortName: details.shortName.trim(), city: details.city.trim(), province: details.province }));
          this.platform.renameCustomer(id, { name: details.shortName.trim(), city: details.city.trim(), province: details.province });
        },
      )
      .pipe(map(() => undefined));
  }

  setApprovalStepUpAmount(id: string, amount: number, reason: string, expectedVersion?: number): Observable<void> {
    const org = this.orgs.get(id);
    return this.gateway
      .command(
        {
          action: `Set the passkey approval threshold to R${amount.toLocaleString('en-ZA')} — ${reason}`,
          resource: 'Organisation',
          resourceId: id,
          category: 'security',
          permission: 'Organisation.Manage',
          stepUp: true,
          version: { expected: expectedVersion, current: org?.version },
          validate: () => {
            const e: Record<string, string> = {};
            if (!(amount >= 1_000 && amount <= 10_000_000)) e['amount'] = 'Between R1 000 and R10 000 000.';
            if (reason.trim().length < 5) e['reason'] = 'Say why, in a few words. It goes in the audit log.';
            return Object.keys(e).length ? e : null;
          },
        },
        () => this.orgs.change(id, (o) => ({ ...o, approvalStepUpAmount: amount })),
      )
      .pipe(map(() => undefined));
  }

  setStatus(id: string, status: OrganisationStatus, reason: string, expectedVersion?: number): Observable<void> {
    const org = this.orgs.get(id);
    return this.gateway
      .command(
        {
          action: `${VERB[status]} ${org?.shortName ?? id} — ${reason}`,
          resource: 'Organisation',
          resourceId: id,
          category: 'security',
          permission: 'Platform.Customers.Manage',
          // Pausing or closing a whole customer is a big step: verify it's really you.
          stepUp: status === 'suspended' || status === 'archived',
          version: { expected: expectedVersion, current: org?.version },
          validate: (): FieldErrors | null => {
            if (!org) return { status: 'That organisation no longer exists.' };
            if (!ALLOWED[org.status].includes(status)) return { status: `A ${org.status} organisation can’t be moved to ${status}.` };
            return reason.trim().length < 5 ? { reason: 'Say why, in a few words. It goes in the audit log.' } : null;
          },
        },
        () => this.orgs.change(id, (o) => ({ ...o, status })),
      )
      .pipe(map(() => undefined));
  }

  private check(d: OrganisationDetails, id: string | null, more: () => FieldErrors = () => ({})): FieldErrors {
    const e: FieldErrors = { ...more() };
    if (d.name.trim().length < 3) e['name'] = 'Enter the registered name.';
    if (d.shortName.trim().length < 2) e['shortName'] = 'Enter the name people use day to day.';
    else if (this.orgs.all().some((o) => o.id !== id && o.shortName.toLowerCase() === d.shortName.trim().toLowerCase())) e['shortName'] = 'Another customer already uses this name.';
    if (d.city.trim().length < 2) e['city'] = 'Enter the city.';
    if (!PROVINCES.includes(d.province)) e['province'] = 'Choose the province.';
    return e;
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
  private readonly db = inject(MockDb);
  private readonly respond = mockResponder();
  private readonly read = signal<Set<string>>(new Set());
  private readonly read$ = toObservable(this.read);
  private readonly residents = inject(ResidentNotifications);
  private readonly accounts = inject(AccountRequestStore);
  private readonly notices$ = toObservable(this.accounts.notices);

  /** The server filters by audience (role), scheme scope and, for residents, their unit. */
  list(): Observable<AppNotification[]> {
    return combineLatest([this.auth.session$, this.read$, this.db.changes$, this.notices$]).pipe(
      switchMap(([s, read]) => {
        const a = s.assignments.find((x) => x.id === s.activeAssignmentId);
        if (!a) return of([]);
        const schemes =
          a.scope.type === 'organisation'
            ? new Set([...this.db.schemes.values()].filter((x) => x.organisationId === a.scope.organisationId).map((x) => x.id))
            : new Set(a.scope.schemeIds);
        const unit = unitLabelOf(a.scope.unitId);
        // Residents' own news is worked out from live records; the fixture keeps the staff and trustee examples.
        const resident = a.role === 'owner' || a.role === 'tenant';
        const fixtures = resident ? [] : NOTIFICATIONS.filter((n) => n.audience.includes(a.role)).filter((n) => n.schemeId === null || schemes.has(n.schemeId)).filter((n) => !n.unitLabel || n.unitLabel === unit);
        const live = resident ? this.residents.for(a, s.identity.personId) : [];
        const platform = this.platformNotices(s.identity.id, a.role);
        return this.respond([...live, ...platform, ...fixtures].sort((x, y) => y.at.localeCompare(x.at)).map((n) => (read.has(n.id) ? { ...n, read: true } : n)));
      }),
    );
  }

  /** Humo-staff notices (new accounts, delegated activation, policy and permission changes). In-app only: no email exists yet. */
  private platformNotices(identityId: string, role: Role): AppNotification[] {
    return this.accounts
      .notices()
      .filter((n) => n.actorId !== identityId && ('identityId' in n.to ? n.to.identityId === identityId : n.to.role === role))
      .map((n) => ({ id: n.id, kind: 'platform' as const, title: n.title, detail: n.detail, schemeId: null, audience: 'role' in n.to ? [n.to.role] : [role], at: n.at, read: false, link: n.link }));
  }

  markRead(ids: string[]): Observable<void> {
    this.read.update((s) => new Set([...s, ...ids]));
    return of(undefined);
  }
}
