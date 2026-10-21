import { ApiError } from './api-error';
import { Observable } from 'rxjs';
import { ImpersonationSession } from '../models/audit';
import { Entitlement, Subscription } from '../models/entitlement';
import { Identity, RoleAssignment } from '../models/identity';
import { Organisation } from '../models/organisation';
import { Permission } from '../models/permission';

/**
 * "Who am I, right now?" — the session bootstrap (`GET /me` on the API).
 *
 * The server works all of this out from the token: the client never computes
 * its own permissions or entitlements, it renders what it is told. Role
 * switching, impersonation and sign-out change the server session (through
 * AccessDataSource) and this stream emits the new state.
 */
export interface CurrentSession {
  signedIn: boolean;
  /** Why the person can't work right now, when they can't (shown on the signed-out page). */
  blocked: 'organisation-suspended' | 'identity-suspended' | 'identity-deactivated' | null;
  /** The authenticated human. Never changes when switching role. */
  actor: Identity;
  /** The identity the app is rendered for: the actor, or the impersonated user. */
  identity: Identity;
  /** Assignments the identity can switch between (only the impersonated one while impersonating). */
  assignments: RoleAssignment[];
  activeAssignmentId: string;
  /** What the active assignment may do right now (role + grants − impersonation limits). */
  permissions: Permission[];
  /**
   * The same before impersonation limits: which pages it may open. Observe
   * impersonation can open every page the user can, but change nothing.
   */
  pagePermissions: Permission[];
  /** The actor's own permissions across their assignments (e.g. System.Impersonate). */
  actorPermissions: Permission[];
  /** The organisation of the active assignment; null for Humo staff. */
  organisation: Organisation | null;
  /** The organisation's subscription and effective entitlements; null when no customer plan applies. */
  subscription: Subscription | null;
  entitlements: Entitlement[] | null;
  impersonation: ImpersonationSession | null;
}

/** The session before anyone signs in, or when the API can't say who you are. */
export const SIGNED_OUT_SESSION: CurrentSession = (() => {
  const nobody: Identity = { id: 'anonymous', version: 0, name: '', initials: '', email: '', kind: 'customer', status: 'active', memberships: [], assignments: [] };
  const none: RoleAssignment = { id: 'none', role: 'tenant', scope: { type: 'organisation', organisationId: null, schemeIds: [] }, label: '', status: 'active', version: 0 };
  return {
    signedIn: false,
    blocked: null,
    actor: nobody,
    identity: nobody,
    assignments: [none],
    activeAssignmentId: none.id,
    permissions: [],
    pagePermissions: [],
    actorPermissions: [],
    organisation: null,
    subscription: null,
    entitlements: null,
    impersonation: null,
  };
})();

export abstract class SessionDataSource {
  /** Live: emits the current session, and again whenever it changes. */
  abstract current(): Observable<CurrentSession>;
  /**
   * Prototype stand-in for the identity provider's sign-in (passkey / Humo
   * Mobile). In production this is a redirect, not an API call.
   */
  abstract signIn(identityId?: string): Observable<void>;
  /**
   * Sign in with a passkey. `emailHint` narrows the browser's passkey prompt to
   * that account; without it the browser offers the passkeys it holds for Humo.
   * `ownComputer` is the person's say-so that this is their own computer, which
   * gives a longer session; a shared computer leaves it off.
   * Fails with a SignInError. It never says whether an account exists.
   * PRODUCTION: the identity provider's WebAuthn ceremony (D5) — see docs/18 R-8.
   */
  abstract signInWithPasskey(emailHint?: string, ownComputer?: boolean): Observable<void>;
  /**
   * Emails a one-time sign-in link and returns the six-digit code for the screen
   * that asked. The link only signs in together with that code, so a forwarded
   * link is no use on its own. Always succeeds, so nobody can find out which
   * addresses have a Humo account.
   * PRODUCTION: the identity provider's email link and code (docs/18 R-8).
   */
  abstract sendSignInLink(email: string): Observable<string>;
  /**
   * Signs in with the token from a sign-in link and the code from the screen that
   * asked for it. Fails with SignInError('wrong-code') while tries remain, and
   * with SignInError('link-expired') once the link is used, too old or out of tries.
   */
  abstract completeSignInLink(token: string, code: string): Observable<void>;
  /**
   * Creates a passkey on this device for the signed-in person (offered right
   * after an email-link sign-in, so newcomers get their first passkey).
   * Fails with SignInError('cancelled') if they close the prompt.
   * PRODUCTION: WebAuthn navigator.credentials.create() with the API's options (D14).
   */
  abstract registerPasskey(): Observable<void>;
  /** Prototype only: identities offered in "Sign in as". */
  abstract demoIdentities(): Observable<Identity[]>;
}

/**
 * Why a sign-in didn't go through.
 * - no-passkey: no passkey for that account on this device (or no such account: deliberately the same answer)
 * - cancelled: the person dismissed the passkey prompt
 * - paused: the account is suspended or closed
 * - link-expired: the sign-in link was used already, is too old, or its code was entered wrongly too often
 * - wrong-code: the code doesn't match the screen that asked for the link (tries remain)
 * - unavailable: sign-in can't be reached (e.g. the identity provider isn't connected yet)
 */
export type SignInFailure = 'no-passkey' | 'cancelled' | 'paused' | 'link-expired' | 'wrong-code' | 'unavailable';

export class SignInError extends ApiError {
  constructor(
    readonly code: SignInFailure,
    message: string,
  ) {
    super('policy', message);
    this.name = 'SignInError';
  }
}
