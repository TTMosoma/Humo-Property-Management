import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { AccountApprovalPolicy, AccountPolicySetting, AccountRequest, FieldErrors, NewAccountDetails, activeAssignments } from '../../domain';
import { simulationStorage } from '../simulation/simulation-storage';
import { AccessStore } from './access-store';
import { OrganisationStore } from './organisation-store';
import { PlatformStore } from './platform-store';

interface Snapshot {
  requests: AccountRequest[];
  policy: AccountPolicySetting;
  seq: number;
}

/** A Humo-staff notice, delivered in-app only (no email exists in the prototype). */
export interface PlatformNotice {
  id: string;
  at: string;
  title: string;
  detail: string;
  link: string;
  /** Every System Administrator, or one person. */
  to: { role: 'system-admin' } | { identityId: string };
  /** Who caused it: they don't get their own notice. */
  actorId: string;
}

const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'];
const DAY = 86_400_000;
const ago = (days: number, hour = 10) => {
  const d = new Date(Date.now() - days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

/** A few requests so the oversight view isn't empty in the demo. */
function seed(): AccountRequest[] {
  return [
    {
      id: 'ar-1003', ref: 'AR-1003', version: 1, status: 'pending', route: 'approval', policy: 'delegation-allowed',
      details: { name: 'Mabena Property Group (Pty) Ltd', shortName: 'Mabena Property', city: 'Polokwane', province: 'Limpopo', packageId: 'professional', accountManagerId: 'am-thabo', notes: 'Referred by Tshikrand. 14 schemes, moving from spreadsheets.' },
      accountManager: 'Thabo Mahlangu', requestedById: 'am-thabo', requestedBy: 'Thabo Mahlangu', requestedAt: ago(1, 15),
    },
    {
      id: 'ar-1002', ref: 'AR-1002', version: 2, status: 'rejected', route: 'approval', policy: 'delegation-allowed',
      details: { name: 'Coastline Estates CC', shortName: 'Coastline Estates', city: 'Durban', province: 'KwaZulu-Natal', packageId: 'essentials', accountManagerId: 'p-dumisani' },
      accountManager: 'Dumisani Ngcobo', requestedById: 'p-dumisani', requestedBy: 'Dumisani Ngcobo', requestedAt: ago(9, 11),
      decidedById: 'p-terry', decidedBy: 'Terry Mosoma', decidedAt: ago(8, 9), reason: 'Duplicate of an existing trial under their holding company. Ask them to use that account.',
    },
  ];
}

/**
 * DEVELOPMENT / SIMULATION ONLY. New-account requests, the account-creation
 * policy, and the in-app notices they send Humo staff.
 */
@Injectable({ providedIn: 'root' })
export class AccountRequestStore {
  private readonly access = inject(AccessStore);
  private readonly orgs = inject(OrganisationStore);
  private readonly platform = inject(PlatformStore);

  private readonly saved = simulationStorage.load<Snapshot>('account-requests');
  readonly requests = signal<AccountRequest[]>(this.saved?.requests ?? seed());
  readonly policy = signal<AccountPolicySetting>(this.saved?.policy ?? { policy: 'delegation-allowed', version: 1 });
  readonly notices = signal<PlatformNotice[]>(simulationStorage.load<PlatformNotice[]>('platform-notices') ?? []);
  private seq = this.saved?.seq ?? 1004;

  constructor() {
    effect(() => {
      const snapshot: Snapshot = { requests: this.requests(), policy: this.policy(), seq: this.seq };
      untracked(() => simulationStorage.save('account-requests', () => ({ ...snapshot, seq: this.seq })));
    });
    effect(() => {
      const notices = this.notices();
      untracked(() => simulationStorage.save('platform-notices', () => notices));
    });
  }

  get(id: string): AccountRequest | undefined {
    return this.requests().find((r) => r.id === id);
  }

  nextRef(): { id: string; ref: string } {
    const n = this.seq++;
    return { id: `ar-${n}`, ref: `AR-${n}` };
  }

  add(r: AccountRequest): void {
    this.requests.update((all) => [r, ...all]);
  }

  change(id: string, apply: (r: AccountRequest) => AccountRequest): void {
    this.requests.update((all) => all.map((r) => (r.id === id ? { ...apply(r), version: r.version + 1 } : r)));
  }

  setPolicy(policy: AccountApprovalPolicy, by: string): void {
    this.policy.update((p) => ({ policy, version: p.version + 1, updatedBy: by, updatedAt: new Date().toISOString() }));
  }

  notify(n: Omit<PlatformNotice, 'id' | 'at'>): void {
    this.notices.update((all) => [{ ...n, id: `pn-${Date.now()}-${all.length}`, at: new Date().toISOString() }, ...all]);
  }

  /** An active Humo Account Manager, by identity id. */
  accountManager(id: string) {
    return this.access.identities().find((i) => i.id === id && i.kind === 'humo' && i.status === 'active' && activeAssignments(i).some((a) => a.role === 'humo-account-manager'));
  }

  /** Required fields, and no duplicate of a customer or of a request that's still waiting. */
  validate(d: NewAccountDetails, ignoreRequestId?: string): FieldErrors | null {
    const e: FieldErrors = {};
    const short = d.shortName.trim().toLowerCase();
    const name = d.name.trim().toLowerCase();
    if (name.length < 3) e['name'] = 'Enter the registered name.';
    if (short.length < 2) e['shortName'] = 'Enter the name people use day to day.';
    if (d.city.trim().length < 2) e['city'] = 'Enter the city.';
    if (!PROVINCES.includes(d.province)) e['province'] = 'Choose the province.';
    if (!['essentials', 'professional', 'enterprise'].includes(d.packageId)) e['packageId'] = 'Choose the package for the trial.';
    if (!this.accountManager(d.accountManagerId)) e['accountManagerId'] = 'Choose an active account manager.';
    if (!e['shortName'] && this.orgs.all().some((o) => o.shortName.toLowerCase() === short || o.name.toLowerCase() === name)) {
      e['shortName'] = 'This customer already has an account.';
    } else if (!e['shortName'] && this.requests().some((r) => r.id !== ignoreRequestId && r.status === 'pending' && (r.details.shortName.toLowerCase() === short || r.details.name.toLowerCase() === name))) {
      e['shortName'] = 'A request for this customer is already waiting for approval.';
    }
    return Object.keys(e).length ? e : null;
  }

  /** The organisation starts onboarding on a trial, exactly as a direct onboarding did. Returns its id. */
  createOrganisation(d: NewAccountDetails): string {
    const base = d.shortName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'customer';
    let id = base;
    for (let n = 2; this.orgs.get(id); n++) id = `${base}-${n}`;
    const manager = this.accountManager(d.accountManagerId)!;
    this.orgs.add({ id, version: 1, kind: 'managing-agency', status: 'onboarding', name: d.name.trim(), shortName: d.shortName.trim(), city: d.city.trim(), province: d.province, schemeCount: 0, unitCount: 0 });
    this.platform.addCustomer({ organisationId: id, name: d.shortName.trim(), city: d.city.trim(), province: d.province, packageId: d.packageId, accountManagerId: manager.id });
    return id;
  }
}
