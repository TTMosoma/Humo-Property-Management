import { Observable } from 'rxjs';
import { ListQuery, Page } from './list-query';
import { AuditEvent, AuditQuery, ImpersonationMode, ImpersonationReason, ImpersonationSession } from '../models/audit';
import { AssignmentScope, Identity, RoleAssignment } from '../models/identity';
import { HumoTeamAction, HumoTeamMember, NewHumoMember, PendingHumoGrant } from '../models/humo-team';
import { SecurityProfile, StepUpMethod, StepUpRequest, StepUpResult } from '../models/security';

export interface NewAssignment {
  role: RoleAssignment['role'];
  scope: AssignmentScope;
  label: string;
}

/**
 * Identities, their role assignments, role switching and impersonation sessions.
 * Session-changing commands (switchRole, signOut, impersonation) change what
 * SessionDataSource.current() emits next.
 */
export abstract class AccessDataSource {
  /** Customer identities with at least one assignment in the agency (null = every agency). */
  abstract directory(organisationId: string | null): Observable<Identity[]>;
  /** Humo's own staff and their internal roles. */
  abstract humoTeam(): Observable<Identity[]>;
  /**
   * Invites someone into the organisation with their first role. They're
   * `invited` until they accept (and set up a passkey); returns their identity id.
   * Inviting an email Humo already knows adds the role to that existing identity.
   *
   * Who may invite (the API decides):
   * - Humo staff onboarding a customer: its first Agency Administrator only (F-22);
   * - an Agency Administrator role: `Users.ManageAdmins`; other staff roles: `Users.Manage`;
   * - owners, tenants and trustees: `Residents.Invite`, for schemes in the inviter's scope (D3, D1).
   *
   * `personId` links the sign-in to their People record (invites from the person,
   * unit or board page). A trustee needs a current board seat (D2); an owner or
   * tenant needs a current relationship with the unit.
   */
  abstract invite(input: { organisationId: string; name: string; email: string; title?: string; assignment: NewAssignment; personId?: string }): Observable<string>;
  /** Name, email, job title. Credentials are the identity provider's, never edited here. */
  abstract updateIdentity(identityId: string, details: { name: string; email: string; title?: string }, expectedVersion?: number): Observable<void>;
  /**
   * The person's access to one organisation: suspend (paused, roles kept),
   * reactivate, or end (removed; every role there ends, history stays).
   */
  abstract setMembershipStatus(identityId: string, organisationId: string, status: 'active' | 'suspended' | 'ended', reason: string): Observable<void>;
  abstract resendInvite(identityId: string): Observable<void>;
  abstract assign(identityId: string, assignment: NewAssignment): Observable<void>;
  /**
   * D1: allow or withdraw browsing every scheme in the agency, read-only
   * (Portfolio.BrowseAgency, an individual grant on a scheme-scoped staff role).
   */
  abstract setBrowseAgency(identityId: string, assignmentId: string, allowed: boolean, expectedVersion?: number): Observable<void>;
  /** Ends the assignment (it stays in the person's history; nothing is deleted). */
  abstract endAssignment(identityId: string, assignmentId: string, expectedVersion?: number): Observable<void>;
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

/**
 * Humo's own team (Platform › Humo team):
 *   GET   /platform/team                       members, with roles and the customers they look after
 *   GET   /platform/team/{id}
 *   GET   /platform/team/pending-grants        System Administrator requests waiting for approval
 *   POST  /platform/team                       invite (Platform.ManageHumoRoles, step-up)
 *   PATCH /platform/team/{id}                  name, email, job title
 *   POST  /platform/team/{id}/actions          roles, impersonation, customers, suspend, restore, offboard, approve/decline
 *
 * The API refuses changes to your own access, removing the last System
 * Administrator, and approving a grant you requested.
 */
export abstract class HumoTeamDataSource {
  abstract list(): Observable<HumoTeamMember[]>;
  abstract get(identityId: string): Observable<HumoTeamMember | undefined>;
  abstract pending(): Observable<PendingHumoGrant[]>;
  abstract invite(input: NewHumoMember): Observable<string>;
  abstract update(identityId: string, details: { name: string; email: string; title?: string }, expectedVersion?: number): Observable<void>;
  abstract act(identityId: string, action: HumoTeamAction, expectedVersion?: number): Observable<void>;
}

export abstract class AuditDataSource {
  /** Newest first. */
  abstract query(query: AuditQuery, list?: ListQuery): Observable<Page<AuditEvent>>;
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
