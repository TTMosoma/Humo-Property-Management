import { Observable } from 'rxjs';
import { AuditEvent, AuditQuery, ImpersonationMode, ImpersonationReason, ImpersonationSession } from '../models/audit';
import { Identity, RoleAssignment } from '../models/persona';
import { SecurityProfile, StepUpMethod, StepUpRequest, StepUpResult } from '../models/security';

/**
 * Why the API refused a command. The UI hides what a person can't do, but the
 * API is the security boundary: it re-checks role permissions, scope,
 * entitlements, impersonation mode and step-up freshness on every command.
 */
export type PolicyDenial = 'observe-only' | 'forbidden' | 'step-up-required' | 'not-entitled';

export class PolicyError extends Error {
  constructor(
    readonly code: PolicyDenial,
    message: string,
  ) {
    super(message);
    this.name = 'PolicyError';
  }
}

export interface NewAssignment {
  role: RoleAssignment['role'];
  agencyId: string | null;
  schemeIds: string[];
  unitLabel?: string;
  label: string;
}

/** Identities, their role assignments, role switching and impersonation sessions. */
export abstract class AccessDataSource {
  /** Customer identities with at least one assignment in the agency (null = every agency). */
  abstract directory(agencyId: string | null): Observable<Identity[]>;
  /** Humo's own staff and their internal roles. */
  abstract humoTeam(): Observable<Identity[]>;
  abstract assign(identityId: string, assignment: NewAssignment): Observable<void>;
  abstract revoke(identityId: string, assignmentId: string): Observable<void>;
  /** The API validates the identity holds the assignment and issues a token for it. */
  abstract switchRole(assignmentId: string): Observable<void>;
  /** Ends the Humo session server-side (all products) and records it. */
  abstract signOut(fromProduct: string): Observable<void>;
  abstract startImpersonation(input: {
    targetId: string;
    targetAssignmentId: string;
    mode: ImpersonationMode;
    reason: ImpersonationReason;
    note?: string;
    ticket?: string;
  }): Observable<ImpersonationSession>;
  abstract endImpersonation(sessionId: string): Observable<void>;
}

export abstract class AuditDataSource {
  abstract query(query: AuditQuery): Observable<AuditEvent[]>;
  /** Sensitive: needs step-up. Returns the export's file name. */
  abstract export(query: AuditQuery): Observable<string>;
}

/** The signed-in identity's own credentials, trusted devices and sessions. */
export abstract class SecurityDataSource {
  abstract profile(identityId: string): Observable<SecurityProfile>;
  abstract addPasskey(identityId: string, name: string, provider: string): Observable<void>;
  abstract removePasskey(identityId: string, passkeyId: string): Observable<void>;
  abstract removeDevice(identityId: string, deviceId: string): Observable<void>;
  abstract signOutSession(identityId: string, sessionId: string): Observable<void>;
  abstract signOutOtherSessions(identityId: string): Observable<void>;
}

/**
 * Step-up verification. Later: WebAuthn `navigator.credentials.get()` with a
 * server challenge (passkey) or a signed push to Humo Mobile; the API records
 * the proof's method and time and checks it is fresh for sensitive commands.
 */
export abstract class StepUpAuthenticator {
  abstract methods(identityId: string): Observable<{ method: StepUpMethod; device: string }[]>;
  abstract verify(method: StepUpMethod, request: StepUpRequest): Observable<StepUpResult>;
}
