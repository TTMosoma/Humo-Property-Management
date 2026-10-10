import { Role } from './role';
import { StepUpMethod } from './security';

/**
 * An audit record: what someone actually did. Written by the API (never by
 * the browser) at the moment a command is accepted or refused.
 *
 * The crucial distinction during impersonation: `actor` is the human at the
 * keyboard; `actingAs` is the customer user they were impersonating.
 */
export type AuditCategory = 'activity' | 'security' | 'impersonation';

export type AuditResult = 'success' | 'denied' | 'failed';

export interface AuditParty {
  identityId: string;
  name: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  category: AuditCategory;
  actor: AuditParty;
  /** Set only while impersonating: whose session the action ran in. */
  actingAs?: AuditParty;
  role: Role;
  /** Agency the action happened in (null for platform-level events). */
  organisationId: string | null;
  /** Scheme scope at the time, if any. */
  schemeId?: string | null;
  /** Past-tense, human: "Approved supplier invoice". */
  action: string;
  /** e.g. "Invoice", "Payment batch", "Role assignment". */
  resource?: string;
  resourceId?: string;
  /** Rands, when money is involved. */
  amount?: number;
  result: AuditResult;
  /** Why it was denied or failed. */
  reason?: string;
  stepUp?: { method: StepUpMethod; device?: string };
  impersonation?: { mode: ImpersonationMode; reason: ImpersonationReason; note?: string };
  session: { ip: string; device: string; sessionId: string };
}

// ---- Impersonation ----

/** Observe: see what the customer sees, nothing can change. Act: perform actions as them. */
export type ImpersonationMode = 'observe' | 'act';

export type ImpersonationReason = 'support' | 'bug' | 'security' | 'data-correction' | 'other';

export const IMPERSONATION_REASONS: Record<ImpersonationReason, string> = {
  support: 'Customer support investigation',
  bug: 'Bug reproduction',
  security: 'Security investigation',
  'data-correction': 'Data correction',
  other: 'Other',
};

/** An active impersonation session (one target user, one of their roles, one mode). */
export interface ImpersonationSession {
  id: string;
  actorId: string;
  targetId: string;
  targetAssignmentId: string;
  mode: ImpersonationMode;
  reason: ImpersonationReason;
  note?: string;
  /** Customer ticket or case reference. */
  ticket?: string;
  startedAt: string;
}

export interface AuditQuery {
  /** Null for platform-wide. */
  organisationId: string | null;
  category?: AuditCategory;
  /** Only events where this identity was the actor or was acted as. */
  identityId?: string;
}
