import { Injectable, effect, signal, untracked } from '@angular/core';
import { simulationStorage } from '../simulation/simulation-storage';
import {
  AuditEvent,
  Identity,
  NewAssignment,
  ROLE_LABELS,
  RoleAssignment,
  SecurityProfile,
} from '../../domain';
import { PERSONAS } from '../fixtures/personas';
import { seedAudit } from './seed-audit';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

/** Credentials and devices per identity. Everyone else gets a sensible default. */
function securityFor(identity: Identity): SecurityProfile {
  const first = identity.name.split(' ')[0];
  if (identity.id === 'p-terry') {
    return {
      identityId: identity.id,
      passkeys: [
        { id: 'pk-1', name: 'Studio laptop', provider: 'Windows Hello', createdAt: daysAgo(210), lastUsedAt: hoursAgo(2) },
        { id: 'pk-2', name: 'Terry’s iPhone', provider: 'iCloud Keychain', createdAt: daysAgo(180), lastUsedAt: daysAgo(3) },
      ],
      devices: [
        { id: 'dv-1', name: 'Studio laptop', kind: 'laptop', humoMobile: false, addedAt: daysAgo(210), lastSeenAt: hoursAgo(0.1) },
        { id: 'dv-2', name: 'Terry’s iPhone 15', kind: 'phone', humoMobile: true, addedAt: daysAgo(180), lastSeenAt: hoursAgo(5) },
      ],
      sessions: [
        { id: 'ss-1', device: 'Studio laptop', browser: 'Edge on Windows 11', location: 'Johannesburg, ZA', ip: '196.21.45.10', startedAt: hoursAgo(3), lastActiveAt: hoursAgo(0), current: true },
        { id: 'ss-2', device: 'Terry’s iPhone 15', browser: 'Humo Mobile', location: 'Johannesburg, ZA', ip: '41.13.200.7', startedAt: daysAgo(2), lastActiveAt: hoursAgo(5), current: false },
      ],
    };
  }
  return {
    identityId: identity.id,
    passkeys: [
      { id: `${identity.id}-pk1`, name: identity.kind === 'humo' || identity.staffId ? 'Work laptop' : 'Home PC', provider: 'Windows Hello', createdAt: daysAgo(120), lastUsedAt: hoursAgo(1) },
      { id: `${identity.id}-pk2`, name: `${first}’s phone`, provider: 'Google Password Manager', createdAt: daysAgo(90), lastUsedAt: daysAgo(6) },
    ],
    devices: [
      { id: `${identity.id}-dv1`, name: identity.staffId ? 'Work laptop' : 'Home PC', kind: 'laptop', humoMobile: false, addedAt: daysAgo(120), lastSeenAt: hoursAgo(0.1) },
      { id: `${identity.id}-dv2`, name: `${first}’s Samsung Galaxy S24`, kind: 'phone', humoMobile: true, addedAt: daysAgo(90), lastSeenAt: hoursAgo(9) },
    ],
    sessions: [
      { id: `${identity.id}-ss1`, device: identity.staffId ? 'Work laptop' : 'Home PC', browser: 'Chrome on Windows 11', location: 'Johannesburg, ZA', ip: '196.21.45.10', startedAt: hoursAgo(4), lastActiveAt: hoursAgo(0), current: true },
      { id: `${identity.id}-ss2`, device: `${first}’s Samsung Galaxy S24`, browser: 'Humo Mobile', location: 'Johannesburg, ZA', ip: '41.13.88.21', startedAt: daysAgo(1), lastActiveAt: hoursAgo(9), current: false },
      { id: `${identity.id}-ss3`, device: 'Unknown Windows PC', browser: 'Firefox on Windows 10', location: 'Pretoria, ZA', ip: '105.224.3.18', startedAt: daysAgo(6), lastActiveAt: daysAgo(5), current: false },
    ],
  };
}

/**
 * The prototype's identity provider + access store: identities and their role
 * assignments, each identity's credentials and sessions, and the audit log.
 * In production these live behind the .NET API (identity, authorisation and
 * an append-only audit store).
 */
/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface AccessSnapshot {
  identities: Identity[];
  security: Record<string, SecurityProfile>;
  audit: AuditEvent[];
  seq: number;
}

@Injectable({ providedIn: 'root' })
export class AccessStore {
  private readonly saved = simulationStorage.load<AccessSnapshot>('access');
  readonly identities = signal<Identity[]>(this.saved?.identities ?? structuredClone(PERSONAS));
  readonly security = signal<Record<string, SecurityProfile>>(this.saved?.security ?? Object.fromEntries(PERSONAS.map((p) => [p.id, securityFor(p)])));
  readonly audit = signal<AuditEvent[]>(this.saved?.audit ?? seedAudit());

  private seq = this.saved?.seq ?? 1;

  constructor() {
    // Seed identities added after a simulation was saved join it (e.g. the account managers named on customers).
    if (this.saved) {
      const known = new Set(this.saved.identities.map((i) => i.id));
      const missing = PERSONAS.filter((p) => !known.has(p.id));
      if (missing.length) {
        this.identities.update((all) => [...all, ...structuredClone(missing)]);
        this.security.update((all) => ({ ...all, ...Object.fromEntries(missing.map((p) => [p.id, securityFor(p)])) }));
      }
    }
    // DEVELOPMENT / SIMULATION ONLY: keep identities, credentials and the audit log across refreshes.
    effect(() => {
      const snapshot: AccessSnapshot = { identities: this.identities(), security: this.security(), audit: this.audit(), seq: this.seq };
      untracked(() => simulationStorage.save('access', () => ({ ...snapshot, seq: this.seq })));
    });
  }

  /** A new id that can't collide with one saved before a refresh. */
  nextId(prefix: string): string {
    return `${prefix}-${this.seq++}`;
  }

  identity(id: string): Identity | undefined {
    return this.identities().find((i) => i.id === id);
  }

  assign(identityId: string, input: NewAssignment, by: string): RoleAssignment {
    const at = new Date().toISOString();
    const assignment: RoleAssignment = { version: 1, ...input, id: this.nextId('m-new'), status: 'active', grantedBy: by, grantedAt: at };
    const org = input.scope.organisationId;
    this.identities.update((all) =>
      all.map((i) => {
        if (i.id !== identityId) return i;
        // Granting a role in an organisation makes (or keeps) the person a member of it.
        const member = !org || i.memberships.some((m) => m.organisationId === org && m.status === 'active');
        const memberships = member
          ? i.memberships
          : [...i.memberships.filter((m) => m.organisationId !== org), { organisationId: org, status: 'active' as const, since: at }];
        return { ...i, memberships, assignments: [...i.assignments, assignment] };
      }),
    );
    return assignment;
  }

  /** Assignments end; they're never deleted (the history is part of the access record). */
  end(identityId: string, assignmentId: string, by: string): RoleAssignment | undefined {
    const ended = this.identity(identityId)?.assignments.find((m) => m.id === assignmentId);
    const at = new Date().toISOString();
    this.identities.update((all) =>
      all.map((i) =>
        i.id === identityId
          ? { ...i, assignments: i.assignments.map((m) => (m.id === assignmentId ? { ...m, version: m.version + 1, status: 'ended' as const, endedBy: by, endedAt: at } : m)) }
          : i,
      ),
    );
    return ended;
  }

  addIdentity(identity: Identity): void {
    this.identities.update((all) => [...all, identity]);
    // Someone invited hasn't signed in yet: no passkeys, devices or sessions until they accept.
    const profile = identity.status === 'invited' ? { identityId: identity.id, passkeys: [], devices: [], sessions: [] } : securityFor(identity);
    this.security.update((all) => ({ ...all, [identity.id]: profile }));
  }

  changeIdentity(id: string, apply: (i: Identity) => Identity): void {
    this.identities.update((all) => all.map((i) => (i.id === id ? { ...apply(i), version: i.version + 1 } : i)));
  }

  /**
   * Suspends, reactivates or ends someone's membership of an organisation.
   * Ending it also ends every role they hold there (kept as history).
   */
  setMembership(identityId: string, organisationId: string, status: 'active' | 'suspended' | 'ended', by: string): void {
    const at = new Date().toISOString();
    this.changeIdentity(identityId, (i) => ({
      ...i,
      memberships: i.memberships.map((m) => (m.organisationId === organisationId ? { ...m, status, endedAt: status === 'ended' ? at : undefined } : m)),
      assignments:
        status === 'ended'
          ? i.assignments.map((a) => (a.scope.organisationId === organisationId && a.status === 'active' ? { ...a, version: a.version + 1, status: 'ended' as const, endedBy: by, endedAt: at } : a))
          : i.assignments,
    }));
  }

  updateSecurity(identityId: string, change: (p: SecurityProfile) => SecurityProfile): void {
    this.security.update((all) => ({ ...all, [identityId]: change(all[identityId] ?? { identityId, passkeys: [], devices: [], sessions: [] }) }));
  }

  record(event: Omit<AuditEvent, 'id' | 'at'>): AuditEvent {
    const full: AuditEvent = { ...event, id: this.nextId('ae-live'), at: new Date().toISOString() };
    this.audit.update((all) => [full, ...all]);
    return full;
  }

  describe(a: RoleAssignment): string {
    return `${ROLE_LABELS[a.role]} · ${a.label}`;
  }
}
