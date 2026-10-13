import { Injectable, Injector, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, delay, map, of, switchMap, throwError, timer } from 'rxjs';
import {
  AccessDataSource,
  AuditDataSource,
  AuditEvent,
  AuditQuery,
  CurrentSession,
  FieldErrors,
  HUMO_EMAIL_DOMAIN,
  IMPERSONATION_REASONS,
  Identity,
  ImpersonationSession,
  ListQuery,
  NewAssignment,
  Page,
  PolicyError,
  ROLE_LABELS,
  SENSITIVE_ACTION_LABELS,
  SecurityDataSource,
  SecurityProfile,
  SessionDataSource,
  SignInError,
  StepUpAuthenticator,
  StepUpMethod,
  StepUpRequest,
  StepUpResult,
  activeAssignments,
  isHumoRole,
  AGENCY_STAFF,
} from '../../domain';
import { PrototypeStateService } from '../../core/prototype/prototype-state.service';
import { AccessStore } from '../db/access-store';
import { mockResponder } from '../mock-latency';
import { toPage } from '../mock-page';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

@Injectable()
export class InMemoryAccessDataSource extends AccessDataSource {
  private readonly store = inject(AccessStore);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();
  private readonly identities$ = toObservable(this.store.identities);

  directory(organisationId: string | null): Observable<Identity[]> {
    return this.identities$.pipe(
      switchMap((all) =>
        this.respond(
          all.filter((i) => i.kind === 'customer' && (organisationId === null || i.memberships.some((m) => m.organisationId === organisationId && m.status !== 'ended'))),
        ),
      ),
    );
  }

  humoTeam(): Observable<Identity[]> {
    return this.identities$.pipe(switchMap((all) => this.respond(all.filter((i) => i.kind === 'humo'))));
  }

  invite(input: { organisationId: string; name: string; email: string; title?: string; assignment: NewAssignment }): Observable<string> {
    const email = input.email.trim().toLowerCase();
    const existing = this.store.identities().find((i) => i.email.toLowerCase() === email);
    const a = input.assignment;
    return this.gateway.command(
      {
        action: existing ? `Gave ${existing.name} access: ${ROLE_LABELS[a.role]} · ${a.label}` : `Invited ${input.name.trim()} (${email}) as ${ROLE_LABELS[a.role]} · ${a.label}`,
        resource: 'Identity',
        category: 'security',
        // Humo staff onboarding a customer invite its first administrator; inside an agency, its own administrators do.
        permission: isHumoRole(this.auth.assignment().role) ? 'Platform.Customers.Manage' : a.role === 'agency-admin' ? 'Users.ManageAdmins' : 'Users.Manage',
        stepUp: true,
        validate: (): FieldErrors => {
          const e: FieldErrors = {};
          if (input.name.trim().split(/\s+/).length < 2) e['name'] = 'Enter their first name and surname.';
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) e['email'] = 'Enter the email address the invitation goes to.';
          // Humo addresses are reserved for Humo staff, who are managed on the platform, never in an agency.
          else if (existing?.kind === 'humo' || email.endsWith(`@${HUMO_EMAIL_DOMAIN}`)) e['email'] = 'That’s a Humo staff address. Humo staff are managed by Humo, not from an agency.';
          else if (existing?.memberships.some((m) => m.organisationId === input.organisationId && m.status !== 'ended')) e['email'] = `${existing.name} already has access here. Add the role from their access instead.`;
          if (a.scope.type === 'schemes' && a.scope.schemeIds.length === 0) e['scope'] = 'Choose at least one scheme.';
          if (a.scope.type === 'unit' && !a.scope.unitId) e['unit'] = 'Choose the unit.';
          return e;
        },
      },
      () => {
        const by = this.auth.actor().name;
        const now = new Date().toISOString();
        if (existing) {
          this.store.changeIdentity(existing.id, (i) => ({
            ...i,
            memberships: [...i.memberships.filter((m) => m.organisationId !== input.organisationId), { organisationId: input.organisationId, status: 'active', since: now }],
          }));
          this.store.assign(existing.id, a, by);
          return existing.id;
        }
        const name = input.name.trim().replace(/\s+/g, ' ');
        const parts = name.split(' ');
        const id = this.store.nextId('p-new');
        this.store.addIdentity({
          id,
          version: 1,
          name,
          initials: `${parts[0][0]}${parts.at(-1)![0]}`.toUpperCase(),
          email,
          kind: 'customer',
          status: 'invited',
          title: input.title?.trim() || undefined,
          memberships: [{ organisationId: input.organisationId, status: 'active', since: now }],
          assignments: [],
        });
        this.store.assign(id, a, by);
        return id;
      },
    );
  }

  updateIdentity(identityId: string, details: { name: string; email: string; title?: string }, expectedVersion?: number): Observable<void> {
    const target = this.store.identity(identityId);
    const email = details.email.trim().toLowerCase();
    return this.gateway
      .command(
        {
          action: `Updated ${details.name.trim()}’s details`,
          resource: 'Identity',
          resourceId: identityId,
          permission: 'Users.Manage',
          version: { expected: expectedVersion, current: target?.version },
          validate: (): FieldErrors => {
            const e: FieldErrors = {};
            if (details.name.trim().split(/\s+/).length < 2) e['name'] = 'Enter their first name and surname.';
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) e['email'] = 'Enter a valid email address.';
            else if (this.store.identities().some((i) => i.id !== identityId && i.email.toLowerCase() === email)) e['email'] = 'Someone else already signs in with this email.';
            else if (target?.kind === 'customer' && email.endsWith(`@${HUMO_EMAIL_DOMAIN}`)) e['email'] = 'That’s a Humo staff address. Use the person’s own email.';
            return e;
          },
        },
        () => {
          const name = details.name.trim().replace(/\s+/g, ' ');
          const parts = name.split(' ');
          this.store.changeIdentity(identityId, (i) => ({ ...i, name, email, title: details.title?.trim() || undefined, initials: `${parts[0][0]}${parts.at(-1)![0]}`.toUpperCase() }));
        },
      )
      .pipe(map(() => undefined));
  }

  setMembershipStatus(identityId: string, organisationId: string, status: 'active' | 'suspended' | 'ended', reason: string): Observable<void> {
    const target = this.store.identity(identityId);
    const verb = status === 'suspended' ? 'Suspended access for' : status === 'ended' ? 'Removed' : 'Restored access for';
    const isAdmin = !!target && activeAssignments(target).some((x) => x.role === 'agency-admin' && x.scope.organisationId === organisationId);
    return this.gateway
      .command(
        {
          action: `${verb} ${target?.name ?? identityId}${status === 'ended' ? ' from the organisation' : ''} — ${reason}`,
          resource: 'Membership',
          resourceId: identityId,
          category: 'security',
          permission: isAdmin ? 'Users.ManageAdmins' : 'Users.Manage',
          stepUp: true,
          validate: (): FieldErrors | null => {
            const m = target?.memberships.find((x) => x.organisationId === organisationId);
            if (!m) return { status: 'They aren’t a member of this organisation.' };
            if (m.status === 'ended') return { status: 'Their membership has already ended.' };
            if (m.status === status) return { status: `Their access is already ${status}.` };
            return reason.trim().length < 5 ? { reason: 'Say why, in a few words. It goes in the audit log.' } : null;
          },
        },
        () => {
          // The API also refuses changing your own access, whatever your role.
          if (identityId === this.auth.actor().id) throw new PolicyError('forbidden', 'You can’t change your own access');
          this.store.setMembership(identityId, organisationId, status, this.auth.actor().name);
        },
      )
      .pipe(map(() => undefined));
  }

  resendInvite(identityId: string): Observable<void> {
    const target = this.store.identity(identityId);
    return this.gateway
      .command(
        {
          action: `Resent the invitation to ${target?.name} (${target?.email})`,
          resource: 'Identity',
          resourceId: identityId,
          permission: 'Users.Manage',
          validate: () => (target?.status === 'invited' ? null : { status: 'They’ve already accepted their invitation.' }),
        },
        () => undefined,
      )
      .pipe(map(() => undefined));
  }

  assign(identityId: string, a: NewAssignment): Observable<void> {
    const target = this.store.identity(identityId);
    const humo = isHumoRole(a.role);
    return this.gateway
      .command(
        {
          action: `Granted ${ROLE_LABELS[a.role]} · ${a.label} to ${target?.name}`,
          resource: 'Role assignment',
          resourceId: identityId,
          category: 'security',
          permission: humo ? 'Platform.ManageHumoRoles' : a.role === 'agency-admin' ? 'Users.ManageAdmins' : 'Users.Manage',
          stepUp: true,
          validate: (): FieldErrors | null => {
            if (a.scope.type === 'schemes' && a.scope.schemeIds.length === 0) return { scope: 'Choose at least one scheme.' };
            if (a.scope.type === 'unit' && !a.scope.unitId) return { unit: 'Choose the unit.' };
            const duplicate = target && activeAssignments(target).some(
              (x) => x.role === a.role && x.scope.type === a.scope.type && x.scope.organisationId === a.scope.organisationId && x.scope.schemeIds.join() === a.scope.schemeIds.join() && x.scope.unitId === a.scope.unitId,
            );
            return duplicate ? { role: `${target!.name} already has this role here.` } : null;
          },
        },
        () => {
          // The API also refuses self-escalation, whatever the caller's role.
          if (identityId === this.auth.actor().id) throw new PolicyError('forbidden', 'You can’t change your own roles');
          this.store.assign(identityId, a, this.auth.actor().name);
        },
      )
      .pipe(map(() => undefined));
  }

  setBrowseAgency(identityId: string, assignmentId: string, allowed: boolean, expectedVersion?: number): Observable<void> {
    const target = this.store.identity(identityId);
    const a = target?.assignments.find((m) => m.id === assignmentId);
    return this.gateway
      .command(
        {
          action: `${allowed ? 'Allowed' : 'Withdrew'} browsing every scheme (read-only) for ${target?.name} · ${a ? ROLE_LABELS[a.role] : 'a role'}`,
          resource: 'Role assignment',
          resourceId: assignmentId,
          category: 'security',
          permission: 'Users.Manage',
          stepUp: true,
          version: { expected: expectedVersion, current: a?.version },
          validate: (): FieldErrors | null =>
            !a || a.status !== 'active'
              ? { assignmentId: 'That role isn’t active.' }
              : a.scope.type !== 'schemes' || !AGENCY_STAFF.includes(a.role)
                ? { assignmentId: 'Only staff roles limited to some schemes can be allowed to browse the rest.' }
                : null,
        },
        () => {
          if (identityId === this.auth.actor().id) throw new PolicyError('forbidden', 'You can’t change your own access');
          this.store.changeIdentity(identityId, (i) => ({
            ...i,
            assignments: i.assignments.map((x) =>
              x.id === assignmentId
                ? { ...x, version: x.version + 1, grants: allowed ? [...new Set([...(x.grants ?? []), 'Portfolio.BrowseAgency' as const])] : (x.grants ?? []).filter((g) => g !== 'Portfolio.BrowseAgency') }
                : x,
            ),
          }));
        },
      )
      .pipe(map(() => undefined));
  }

  endAssignment(identityId: string, assignmentId: string, expectedVersion?: number): Observable<void> {
    const target = this.store.identity(identityId);
    const a = target?.assignments.find((m) => m.id === assignmentId);
    return this.gateway
      .command(
        {
          action: `Ended ${a ? ROLE_LABELS[a.role] + ' · ' + a.label : 'a role'} for ${target?.name}`,
          resource: 'Role assignment',
          resourceId: assignmentId,
          category: 'security',
          permission: a && isHumoRole(a.role) ? 'Platform.ManageHumoRoles' : a?.role === 'agency-admin' ? 'Users.ManageAdmins' : 'Users.Manage',
          stepUp: true,
          version: { expected: expectedVersion, current: a?.version },
        },
        () => {
          if (identityId === this.auth.actor().id) throw new PolicyError('forbidden', 'You can’t change your own roles');
          this.store.end(identityId, assignmentId, this.auth.actor().name);
        },
      )
      .pipe(map(() => undefined));
  }

  switchRole(assignmentId: string): Observable<void> {
    const a = this.auth.current.assignments.find((m) => m.id === assignmentId);
    if (!a) return throwError(() => new PolicyError('forbidden', 'Not one of your roles'));
    return this.gateway
      .command(
        { action: `Switched role to ${ROLE_LABELS[a.role]}`, resource: 'Role assignment', resourceId: assignmentId, category: 'security', allowedWhileObserving: true },
        // The API issues a token scoped to the new assignment.
        () => void this.auth.switchAssignment(assignmentId),
      )
      .pipe(map(() => undefined));
  }

  signOut(fromProduct: string): Observable<void> {
    const imp = !!this.auth.current.impersonation;
    // The server ends the session as soon as it hears about it, even if the response is lost.
    this.gateway.audit(
      {
        action: imp ? `Signed out of ${fromProduct} (impersonation ended)` : `Signed out of ${fromProduct}`,
        resource: 'Session',
        resourceId: 's-current',
        category: 'security',
      },
      'success',
    );
    this.auth.signOut();
    return this.respond(undefined);
  }

  startImpersonation(input: Parameters<AccessDataSource['startImpersonation']>[0]): Observable<ImpersonationSession> {
    const actor = this.auth.actor();
    const target = this.store.identity(input.targetId);
    const assignment = target ? activeAssignments(target).find((m) => m.id === input.targetAssignmentId) : undefined;
    const allowed = this.auth.current.actorPermissions.includes('System.Impersonate');
    const proofNeeded = input.mode === 'act' && !this.auth.stepUpFresh();
    const base = {
      category: 'impersonation' as const,
      actor: { identityId: actor.id, name: actor.name },
      actingAs: target ? { identityId: target.id, name: target.name } : undefined,
      role: assignment?.role ?? 'system-admin',
      organisationId: assignment?.scope.organisationId ?? null,
      resource: 'Identity',
      resourceId: input.targetId,
      impersonation: { mode: input.mode, reason: input.reason, note: [input.ticket, input.note].filter(Boolean).join(' · ') || undefined },
      session: { ip: '102.65.12.4', device: 'Edge on Windows 11', sessionId: 's-current' },
    };

    // Policy: the actor needs the individual grant; Humo staff can't be impersonated; Act needs a fresh step-up.
    if (!allowed || !target || target.kind !== 'customer' || !assignment || proofNeeded) {
      const reason = !allowed ? 'System.Impersonate not granted' : proofNeeded ? 'Step-up verification was not fresh' : 'Target cannot be impersonated';
      this.store.record({ ...base, action: 'Tried to start impersonation', result: 'denied', reason });
      return timer(200).pipe(switchMap(() => throwError(() => new PolicyError(proofNeeded ? 'step-up-required' : 'forbidden', reason))));
    }

    const session: ImpersonationSession = {
      id: `imp-${Date.now()}`,
      actorId: actor.id,
      targetId: target.id,
      targetAssignmentId: assignment.id,
      mode: input.mode,
      reason: input.reason,
      note: input.note,
      ticket: input.ticket,
      startedAt: new Date().toISOString(),
    };
    return this.respond(session).pipe(
      map((s) => {
        const proof = this.auth.stepUpProof();
        this.store.record({
          ...base,
          action: `Started impersonation (${input.mode === 'act' ? 'Act' : 'Observe'} · ${IMPERSONATION_REASONS[input.reason]})`,
          result: 'success',
          stepUp: input.mode === 'act' && proof?.method ? { method: proof.method, device: proof.device } : undefined,
        });
        this.auth.startImpersonation(s);
        return s;
      }),
    );
  }

  endImpersonation(sessionId: string): Observable<void> {
    const imp = this.auth.current.impersonation;
    const minutes = imp ? Math.max(1, Math.round((Date.now() - new Date(imp.startedAt).getTime()) / 60_000)) : 0;
    // Ending always succeeds server-side, even if the response is lost on the way back.
    this.gateway.audit(
      { action: `Ended impersonation (${minutes} min)`, resource: 'Identity', resourceId: imp?.targetId ?? sessionId, category: 'impersonation' },
      'success',
    );
    this.auth.endImpersonation();
    return this.respond(undefined);
  }
}

@Injectable()
export class InMemoryAuditDataSource extends AuditDataSource {
  private readonly store = inject(AccessStore);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();
  private readonly events$ = toObservable(this.store.audit);

  query(q: AuditQuery, list?: ListQuery): Observable<Page<AuditEvent>> {
    return this.events$.pipe(
      switchMap((all) =>
        this.respond(
          toPage(
            all.filter(
            (e) =>
              (q.organisationId === null || e.organisationId === q.organisationId) &&
              (!q.category || e.category === q.category) &&
              (!q.identityId || e.actor.identityId === q.identityId || e.actingAs?.identityId === q.identityId),
            ),
            list,
          ),
        ),
      ),
    );
  }

  export(q: AuditQuery): Observable<string> {
    const file = `humo-audit-${q.organisationId ?? 'platform'}-${new Date().toISOString().slice(0, 10)}.csv`;
    return this.gateway.command(
      { action: `Exported the audit log (${q.category ?? 'all events'})`, resource: 'Export', resourceId: file, category: 'security', permission: q.organisationId === null ? 'Platform.Audit' : 'Audit.View', stepUp: true },
      () => file,
    );
  }
}

@Injectable()
export class InMemorySecurityDataSource extends SecurityDataSource {
  private readonly store = inject(AccessStore);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();
  private readonly security$ = toObservable(this.store.security);

  profile(identityId: string): Observable<SecurityProfile> {
    return this.security$.pipe(switchMap((all) => this.respond(all[identityId])));
  }

  addPasskey(identityId: string, name: string, provider: string): Observable<void> {
    return this.change(identityId, `Added a passkey (${provider})`, (p) => ({
      ...p,
      passkeys: [...p.passkeys, { id: `pk-${Date.now()}`, name, provider, createdAt: new Date().toISOString(), lastUsedAt: null }],
    }));
  }

  removePasskey(identityId: string, passkeyId: string): Observable<void> {
    return this.change(identityId, 'Removed a passkey', (p) => ({ ...p, passkeys: p.passkeys.filter((k) => k.id !== passkeyId) }));
  }

  removeDevice(identityId: string, deviceId: string): Observable<void> {
    return this.change(identityId, 'Removed a trusted device', (p) => ({ ...p, devices: p.devices.filter((d) => d.id !== deviceId) }));
  }

  signOutSession(identityId: string, sessionId: string): Observable<void> {
    return this.change(identityId, 'Signed out a session', (p) => ({ ...p, sessions: p.sessions.filter((s) => s.id !== sessionId) }));
  }

  signOutOtherSessions(identityId: string): Observable<void> {
    return this.change(identityId, 'Signed out all other sessions', (p) => ({ ...p, sessions: p.sessions.filter((s) => s.current) }));
  }

  private change(identityId: string, action: string, apply: (p: SecurityProfile) => SecurityProfile): Observable<void> {
    return this.gateway
      .command({ action, resource: 'Security settings', category: 'security', permission: 'Security.ManageOwn' }, () => this.store.updateSecurity(identityId, apply))
      .pipe(map(() => undefined));
  }
}

/**
 * Pretends to be WebAuthn / Humo Mobile. A passkey "verifies" after the time a
 * Windows Hello prompt takes; a mobile approval after the phone is tapped.
 * Prototype toolbar "Error" state makes verification fail, to review that path.
 */
@Injectable()
export class InMemoryStepUpAuthenticator extends StepUpAuthenticator {
  private readonly store = inject(AccessStore);
  private readonly proto = inject(PrototypeStateService);
  /** The step-up is always for the human at the keyboard, never the impersonated user. */
  private readonly auth = inject(MockAuthSession);

  methods(identityId: string): Observable<{ method: StepUpMethod; device: string }[]> {
    const p = this.store.security()[identityId];
    const passkey = p?.passkeys[0];
    const phone = p?.devices.find((d) => d.humoMobile);
    return of([
      ...(passkey ? [{ method: 'passkey' as const, device: `${passkey.provider} · ${passkey.name}` }] : []),
      ...(phone ? [{ method: 'mobile' as const, device: `Humo Mobile · ${phone.name}` }] : []),
    ]);
  }

  verify(method: StepUpMethod, request: StepUpRequest): Observable<StepUpResult> {
    const ms = method === 'passkey' ? 1400 : 2800;
    const failed = this.proto.viewState() === 'error';
    return this.methods(this.auth.actor().id).pipe(
      delay(ms),
      map((all) => {
        const device = all.find((m) => m.method === method)?.device;
        const result: StepUpResult = { verified: !failed, method, device, at: new Date().toISOString() };
        this.recordProof(request, result);
        this.auth.recordProof(result);
        return result;
      }),
    );
  }

  /** The API records every step-up attempt as a security event. */
  private recordProof(request: StepUpRequest, result: StepUpResult): void {
    const s = this.auth.current;
    this.store.record({
      category: 'security',
      actor: { identityId: s.actor.id, name: s.actor.name },
      actingAs: s.impersonation ? { identityId: s.identity.id, name: s.identity.name } : undefined,
      role: this.auth.assignment().role,
      organisationId: s.organisation?.id ?? null,
      action: result.verified
        ? `Verified identity · ${SENSITIVE_ACTION_LABELS[request.action]}`
        : `Step-up verification failed · ${SENSITIVE_ACTION_LABELS[request.action]}`,
      resource: 'Step-up',
      result: result.verified ? 'success' : 'failed',
      stepUp: result.method ? { method: result.method, device: result.device } : undefined,
      session: { ip: '196.21.45.10', device: 'Chrome on Windows 11', sessionId: 's-current' },
    });
  }
}

/**
 * GET /me. Not delayed or failed by the prototype's state simulator: the
 * shell needs it to render at all (a real app shows a full-page error instead).
 */
@Injectable()
export class InMemorySessionDataSource extends SessionDataSource {
  private readonly auth = inject(MockAuthSession);
  private readonly store = inject(AccessStore);
  /** Looked up when needed: the gateway reads the client's scope, which depends on the session. */
  private readonly injector = inject(Injector);

  current(): Observable<CurrentSession> {
    return this.auth.session$.asObservable();
  }

  signIn(identityId?: string): Observable<void> {
    this.auth.signIn(identityId);
    this.injector.get(MockGateway).audit({ action: 'Signed in to Humo with a passkey', resource: 'Session', resourceId: 's-current', category: 'security' }, 'success');
    return of(undefined);
  }

  demoIdentities(): Observable<Identity[]> {
    return of(this.store.identities().filter((i) => i.demo && i.status === 'active'));
  }

  /**
   * SIMULATED (docs/18 R-8): a moment for the person to touch their sensor,
   * then the passkey "found" for the email (or this device's last user).
   * Same answer for "no account" and "no passkey here", like the real thing.
   */
  signInWithPasskey(emailHint?: string): Observable<void> {
    const email = emailHint?.trim().toLowerCase();
    const who = email ? this.store.identities().find((i) => i.email.toLowerCase() === email) : this.store.identity(this.auth.deviceIdentityId());
    const hasPasskey = !!who && (this.store.security()[who.id]?.passkeys.length ?? 0) > 0;
    return timer(1400).pipe(
      switchMap(() => {
        if (!who || !hasPasskey || who.status === 'invited') {
          return throwError(() => new SignInError('no-passkey', 'There’s no passkey for that account on this device'));
        }
        if (who.status !== 'active') {
          return throwError(() => new SignInError('paused', 'This Humo sign-in is paused'));
        }
        this.auth.signIn(who.id);
        this.audit('Signed in to Humo with a passkey');
        return of(undefined);
      }),
    );
  }

  /** SIMULATED (docs/18 R-8): no email is sent; the prototype controls show the link instead. */
  sendSignInLink(email: string): Observable<void> {
    this.auth.issueLink(email.trim());
    return timer(700).pipe(map(() => undefined));
  }

  completeSignInLink(token: string): Observable<void> {
    return timer(600).pipe(
      switchMap(() => {
        const id = this.auth.redeemLink(token);
        const who = id ? this.store.identity(id) : undefined;
        if (!who || who.status !== 'active') return throwError(() => new SignInError('link-expired', 'This sign-in link has expired or was already used'));
        this.auth.signIn(who.id);
        this.audit('Signed in to Humo with an email link');
        return of(undefined);
      }),
    );
  }

  /** After sign-in, so the event is the signed-in person's. */
  private audit(action: string): void {
    this.injector.get(MockGateway).audit({ action, resource: 'Session', resourceId: 's-current', category: 'security' }, 'success');
  }
}
