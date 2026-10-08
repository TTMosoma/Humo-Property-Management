import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { FieldErrors, SCHEME_STATUS_LABELS, Scheme, SchemeDataSource, SchemeDetails, SchemeHealth, SchemeStatus } from '../../domain';
import { AccessStore } from '../db/access-store';
import { MockDb } from '../db/mock-db';
import { SCHEME_HEALTH } from '../fixtures/scheme-health';
import { portfolioManagerOf } from '../fixtures/staff';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

const TYPES: Scheme['type'][] = ['Sectional Title', 'Home Owners Association', 'Share Block'];
const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];

/** The lifecycle moves the API allows. */
const ALLOWED: Record<SchemeStatus, SchemeStatus[]> = {
  prospect: ['onboarding', 'archived'],
  onboarding: ['active', 'archived'],
  active: ['closed'],
  closed: ['active', 'archived'],
  archived: ['closed'],
};

@Injectable()
export class InMemorySchemeDataSource extends SchemeDataSource {
  private readonly respond = mockResponder();
  private readonly access = inject(AccessStore);
  private readonly db = inject(MockDb);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);

  /** The server joins the manager in from role assignments. */
  private withManager(s: Scheme): Scheme {
    return { ...s, portfolioManager: portfolioManagerOf(s.id, this.access.identities()) };
  }

  /** Live: new, edited and archived schemes show up everywhere straight away. */
  list(): Observable<Scheme[]> {
    return this.db.changes$.pipe(switchMap(() => this.respond([...this.db.schemes.values()].map((s) => this.withManager(s)))));
  }

  get(id: string): Observable<Scheme | undefined> {
    const s = this.db.schemes.get(id);
    return this.respond(s ? this.withManager(s) : undefined);
  }

  /** Seeded figures where there are some; a new scheme starts with an empty bill of health. */
  health(): Observable<SchemeHealth[]> {
    return this.db.changes$.pipe(
      switchMap(() => {
        const known = new Map(SCHEME_HEALTH.map((h) => [h.schemeId, h]));
        return this.respond(
          [...this.db.schemes.values()].map(
            (s): SchemeHealth =>
              known.get(s.id) ?? {
                schemeId: s.id, collectionRate: 100, arrears: 0, accounts90Plus: 0, monthlyLevyRoll: 0, openJobs: 0, overdueJobs: 0,
                compliance: 'not-applicable', complianceOpenItems: 0, rating: 'good',
              },
          ),
        );
      }),
    );
  }

  create(details: SchemeDetails): Observable<string> {
    const organisationId = this.auth.current.organisation?.id ?? '';
    return this.gateway.command(
      {
        action: `Added scheme ${details.name}`,
        resource: 'Scheme',
        permission: 'Schemes.Manage',
        feature: 'schemes',
        validate: () => this.check(details, null),
      },
      () => {
        const base = details.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        let id = base;
        for (let n = 2; this.db.schemes.has(id); n++) id = `${base}-${n}`;
        this.db.addScheme({ id, version: 1, organisationId, status: 'onboarding', unitCount: 0, portfolioManager: null, ...this.clean(details) });
        return id;
      },
    );
  }

  update(id: string, details: SchemeDetails, expectedVersion?: number): Observable<void> {
    const s = this.db.schemes.get(id);
    return this.gateway
      .command(
        {
          action: `Updated scheme details for ${details.name}`,
          resource: 'Scheme',
          resourceId: id,
          schemeId: id,
          permission: 'Schemes.Manage',
          version: { expected: expectedVersion, current: s?.version },
          validate: () => this.check(details, id),
        },
        () => this.db.changeScheme(id, (x) => ({ ...x, ...this.clean(details) })),
      )
      .pipe(map(() => undefined));
  }

  setStatus(id: string, status: SchemeStatus, reason: string, expectedVersion?: number): Observable<void> {
    const s = this.db.schemes.get(id);
    return this.gateway
      .command(
        {
          action: `${s?.name ?? id}: ${SCHEME_STATUS_LABELS[s?.status ?? 'active']} → ${SCHEME_STATUS_LABELS[status]} — ${reason}`,
          resource: 'Scheme',
          resourceId: id,
          schemeId: id,
          permission: 'Schemes.Manage',
          version: { expected: expectedVersion, current: s?.version },
          validate: (): FieldErrors | null => {
            if (!s) return { status: 'That scheme no longer exists.' };
            if (!ALLOWED[s.status].includes(status)) return { status: `A ${s.status} scheme can’t be moved to ${status}.` };
            if (status === 'archived' && s.status !== 'archived' && this.db.unitsIn([id]).some((u) => u.account.balance > 0)) {
              return { status: 'Some accounts still owe money. Settle or hand them over before archiving.' };
            }
            return reason.trim().length < 5 ? { reason: 'Say why, in a few words. It goes in the audit log.' } : null;
          },
        },
        () => this.db.changeScheme(id, (x) => ({ ...x, status })),
      )
      .pipe(map(() => undefined));
  }

  private clean(d: SchemeDetails): SchemeDetails {
    return { name: d.name.trim(), code: d.code.trim().toUpperCase(), type: d.type, suburb: d.suburb.trim(), city: d.city.trim(), province: d.province };
  }

  private check(d: SchemeDetails, id: string | null): FieldErrors {
    const e: FieldErrors = {};
    const code = d.code.trim().toUpperCase();
    const orgId = id ? this.db.schemes.get(id)?.organisationId : this.auth.current.organisation?.id;
    if (d.name.trim().length < 3) e['name'] = 'Enter the scheme’s name.';
    if (!/^[A-Z]{2,4}$/.test(code)) e['code'] = 'Use 2–4 letters, e.g. KC. It starts every account number.';
    else if ([...this.db.schemes.values()].some((s) => s.id !== id && s.organisationId === orgId && s.code === code)) e['code'] = 'Another scheme already uses this code.';
    if (!TYPES.includes(d.type)) e['type'] = 'Choose the type of scheme.';
    if (d.suburb.trim().length < 2) e['suburb'] = 'Enter the suburb.';
    if (d.city.trim().length < 2) e['city'] = 'Enter the city.';
    if (!PROVINCES.includes(d.province)) e['province'] = 'Choose the province.';
    return e;
  }
}
