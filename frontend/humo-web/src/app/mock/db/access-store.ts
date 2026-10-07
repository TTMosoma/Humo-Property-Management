import { Injectable, signal } from '@angular/core';
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
@Injectable({ providedIn: 'root' })
export class AccessStore {
  readonly identities = signal<Identity[]>(structuredClone(PERSONAS));
  readonly security = signal<Record<string, SecurityProfile>>(Object.fromEntries(PERSONAS.map((p) => [p.id, securityFor(p)])));
  readonly audit = signal<AuditEvent[]>(seedAudit());

  private seq = 1;

  identity(id: string): Identity | undefined {
    return this.identities().find((i) => i.id === id);
  }

  assign(identityId: string, input: NewAssignment, by: string): RoleAssignment {
    const assignment: RoleAssignment = {
      ...input,
      id: `m-new-${this.seq++}`,
      grantedBy: by,
      grantedAt: new Date().toISOString(),
    };
    this.identities.update((all) => all.map((i) => (i.id === identityId ? { ...i, memberships: [...i.memberships, assignment] } : i)));
    return assignment;
  }

  revoke(identityId: string, assignmentId: string): RoleAssignment | undefined {
    const removed = this.identity(identityId)?.memberships.find((m) => m.id === assignmentId);
    this.identities.update((all) =>
      all.map((i) => (i.id === identityId ? { ...i, memberships: i.memberships.filter((m) => m.id !== assignmentId) } : i)),
    );
    return removed;
  }

  updateSecurity(identityId: string, change: (p: SecurityProfile) => SecurityProfile): void {
    this.security.update((all) => ({ ...all, [identityId]: change(all[identityId]) }));
  }

  record(event: Omit<AuditEvent, 'id' | 'at'>): AuditEvent {
    const full: AuditEvent = { ...event, id: `ae-live-${this.seq++}`, at: new Date().toISOString() };
    this.audit.update((all) => [full, ...all]);
    return full;
  }

  describe(a: RoleAssignment): string {
    return `${ROLE_LABELS[a.role]} · ${a.label}`;
  }
}
