import { Injectable, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, combineLatest, map, of, switchMap } from 'rxjs';
import {
  AppNotification,
  FieldErrors,
  NewOrganisation,
  NotificationDataSource,
  Organisation,
  OrganisationDataSource,
  OrganisationDetails,
  OrganisationStatus,
  activeAssignments,
  isHumoRole,
} from '../../domain';
import { NOTIFICATIONS } from '../fixtures/notifications';
import { MockDb } from '../db/mock-db';
import { OrganisationStore } from '../db/organisation-store';
import { PlatformStore } from '../db/platform-store';
import { AccessStore } from '../db/access-store';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

/** "Mabena Property Group" → "mabena-property-group" (unique). */
function slug(text: string, taken: (id: string) => boolean): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'customer';
  let id = base;
  for (let n = 2; taken(id); n++) id = `${base}-${n}`;
  return id;
}

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
  private readonly access = inject(AccessStore);
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

  create(input: NewOrganisation): Observable<string> {
    // Any Humo identity that holds the Account Manager role.
    const manager = this.access.identities().find((i) => i.id === input.accountManagerId && i.kind === 'humo' && activeAssignments(i).some((a) => a.role === 'humo-account-manager'));
    return this.gateway.command(
      {
        action: `Onboarded customer ${input.shortName} (${input.packageId} trial)`,
        resource: 'Organisation',
        category: 'security',
        permission: 'Platform.Customers.Manage',
        validate: () => this.check(input, null, (): FieldErrors => (!manager ? { accountManagerId: 'Choose the account manager.' } : {})),
      },
      () => {
        const id = slug(input.shortName, (x) => !!this.orgs.get(x));
        this.orgs.add({ id, version: 1, kind: 'managing-agency', status: 'onboarding', name: input.name.trim(), shortName: input.shortName.trim(), city: input.city.trim(), province: input.province, schemeCount: 0, unitCount: 0 });
        this.platform.addCustomer({ organisationId: id, name: input.shortName.trim(), city: input.city.trim(), province: input.province, packageId: input.packageId, accountManagerId: manager!.id, accountManager: manager!.name });
        return id;
      },
    );
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

  /** The server filters by audience (role), scheme scope and, for residents, their unit. */
  list(): Observable<AppNotification[]> {
    return combineLatest([this.auth.session$, this.read$]).pipe(
      switchMap(([s, read]) => {
        const a = s.assignments.find((x) => x.id === s.activeAssignmentId);
        if (!a) return of([]);
        const schemes =
          a.scope.type === 'organisation'
            ? new Set([...this.db.schemes.values()].filter((x) => x.organisationId === a.scope.organisationId).map((x) => x.id))
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
