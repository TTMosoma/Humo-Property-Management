import { Injectable, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, combineLatest, map, switchMap } from 'rxjs';
import {
  FieldErrors,
  HUMO_EMAIL_DOMAIN,
  HumoTeamAction,
  HumoTeamDataSource,
  HumoTeamMember,
  Identity,
  NewHumoMember,
  PendingHumoGrant,
  ROLE_LABELS,
  RoleAssignment,
  SOLE_ADMIN_COOLING_OFF_HOURS,
  activeAssignments,
  activeSystemAdmins,
  isHumoRole,
  isSoleSystemAdmin,
  soleAdminConfirmableFrom,
} from '../../domain';
import { AccessStore } from '../db/access-store';
import { HumoTeamStore } from '../db/humo-team-store';
import { AccountRequestStore } from '../db/account-request-store';
import { PlatformStore } from '../db/platform-store';
import { mockResponder } from '../mock-latency';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockGateway } from '../server/mock-gateway';

const nameOk = (n: string) => n.trim().split(/\s+/).length >= 2;
const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return `${parts[0][0]}${parts.at(-1)![0]}`.toUpperCase();
};

/** Granted individually to Account Managers, never by role (docs/21). */
const DELEGATED = 'Platform.Customers.ActivateWithoutApproval' as const;

/** Humo's own team, managed by System Administrators (Platform › Humo team). */
@Injectable()
export class InMemoryHumoTeamDataSource extends HumoTeamDataSource {
  private readonly store = inject(AccessStore);
  private readonly team = inject(HumoTeamStore);
  private readonly platform = inject(PlatformStore);
  private readonly accounts = inject(AccountRequestStore);
  private readonly auth = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();
  private readonly changes$ = combineLatest([toObservable(this.store.identities), toObservable(this.team.pending), toObservable(this.platform.seeds)]);

  // =================================================================== Reads

  private member(i: Identity): HumoTeamMember {
    const roles = activeAssignments(i).filter((a) => isHumoRole(a.role));
    const formerRoles = i.assignments.filter((a) => a.status === 'ended' && isHumoRole(a.role)).sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
    const sessions = this.store.security()[i.id]?.sessions ?? [];
    return {
      identity: i,
      roles,
      formerRoles,
      canImpersonate: roles.some((a) => a.role === 'system-admin' && a.grants?.includes('System.Impersonate')),
      canActivateWithoutApproval: roles.some((a) => a.role === 'humo-account-manager' && a.grants?.includes(DELEGATED)),
      customers: this.platform
        .seeds()
        .filter((c) => c.accountManagerId === i.id)
        .map((c) => ({ organisationId: c.organisationId, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      pending: this.team.pending().find((g) => g.identityId === i.id),
      lastActiveAt: sessions.map((s) => s.lastActiveAt).sort().at(-1),
    };
  }

  list(): Observable<HumoTeamMember[]> {
    return this.changes$.pipe(switchMap(([all]) => this.respond(all.filter((i) => i.kind === 'humo').map((i) => this.member(i)))));
  }

  get(identityId: string): Observable<HumoTeamMember | undefined> {
    return this.changes$.pipe(
      switchMap(([all]) => {
        const i = all.find((x) => x.id === identityId && x.kind === 'humo');
        return this.respond(i ? this.member(i) : undefined);
      }),
    );
  }

  pending(): Observable<PendingHumoGrant[]> {
    return this.changes$.pipe(switchMap(() => this.respond(this.team.pending())));
  }

  // =================================================================== Helpers

  private activeSystemAdmins(): Identity[] {
    return activeSystemAdmins(this.store.identities());
  }

  /** Sole-administrator safeguard: the rest of the Humo team hears about a self-confirmable request at once. */
  private announceSoleAdminRequest(identityId: string, identityName: string): void {
    const me = this.auth.actor();
    if (!isSoleSystemAdmin(this.store.identities(), me.id)) return;
    const from = soleAdminConfirmableFrom({ requestedAt: new Date().toISOString() });
    for (const person of this.store.identities().filter((i) => i.kind === 'humo' && i.status !== 'deactivated' && i.id !== me.id)) {
      this.accounts.notify({
        to: { identityId: person.id },
        actorId: me.id,
        title: `${me.name} asked to make ${identityName} a System Administrator`,
        detail: `${me.name} is Humo’s only System Administrator, so they can confirm it themselves after a ${SOLE_ADMIN_COOLING_OFF_HOURS}-hour cooling-off period (from ${from.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}). If you didn’t expect this, raise it with Humo’s founders before then.`,
        link: `/platform/team/${identityId}`,
      });
    }
  }

  /** Would this leave Humo without an active System Administrator? */
  private isLastSystemAdmin(identityId: string): boolean {
    const admins = this.activeSystemAdmins();
    return admins.length === 1 && admins[0].id === identityId;
  }

  private customersOf(identityId: string) {
    return this.platform.seeds().filter((c) => c.accountManagerId === identityId);
  }

  /** Active account managers other than `except`. */
  private accountManagers(except?: string): Identity[] {
    return this.store.identities().filter((i) => i.id !== except && i.kind === 'humo' && i.status === 'active' && activeAssignments(i).some((a) => a.role === 'humo-account-manager'));
  }

  private endSessions(identityId: string): void {
    this.store.updateSecurity(identityId, (p) => ({ ...p, sessions: [] }));
  }

  private grantRole(identityId: string, role: RoleAssignment['role'], label: string, by: string): void {
    this.store.assign(identityId, { role, scope: { type: 'platform', organisationId: null, schemeIds: [] }, label }, by);
  }

  // =================================================================== Commands

  invite(input: NewHumoMember): Observable<string> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim().replace(/\s+/g, ' ');
    const needsSecond = input.role === 'system-admin';
    return this.gateway.command(
      {
        action: `Invited ${name} (${email}) to the Humo team as ${ROLE_LABELS[input.role]}${needsSecond ? ' (waiting for a second System Administrator)' : ''} — ${input.reason.trim()}`,
        resource: 'Humo team',
        category: 'security',
        permission: 'Platform.ManageHumoRoles',
        stepUp: true,
        validate: (): FieldErrors => {
          const e: FieldErrors = {};
          if (!nameOk(name)) e['name'] = 'Enter their first name and surname.';
          if (!emailOk(email)) e['email'] = 'Enter their Humo work email.';
          else if (!email.endsWith(`@${HUMO_EMAIL_DOMAIN}`)) e['email'] = `Humo staff sign in with their @${HUMO_EMAIL_DOMAIN} address.`;
          else if (this.store.identities().some((i) => i.email.toLowerCase() === email)) e['email'] = 'Someone already signs in with this email.';
          if (!isHumoRole(input.role)) e['role'] = 'Choose a Humo role.';
          if (input.label.trim().length < 3) e['label'] = 'Describe what they do, e.g. “Customer support”.';
          if (input.reason.trim().length < 5) e['reason'] = 'Say why, in a few words. It goes in the audit log.';
          return e;
        },
      },
      () => {
        const by = this.auth.actor();
        const id = this.store.nextId('humo');
        this.store.addIdentity({
          id,
          version: 1,
          name,
          initials: initialsOf(name),
          email,
          kind: 'humo',
          status: 'invited',
          title: input.title?.trim() || undefined,
          memberships: [],
          assignments: [],
        });
        if (needsSecond) {
          this.team.add({ identityId: id, identityName: name, role: input.role, label: input.label.trim(), reason: input.reason.trim(), requestedById: by.id, requestedBy: by.name, requestedAt: new Date().toISOString() });
          this.announceSoleAdminRequest(id, name);
        } else {
          this.grantRole(id, input.role, input.label.trim(), by.name);
        }
        return id;
      },
    );
  }

  update(identityId: string, details: { name: string; email: string; title?: string }, expectedVersion?: number): Observable<void> {
    const target = this.store.identity(identityId);
    const email = details.email.trim().toLowerCase();
    const name = details.name.trim().replace(/\s+/g, ' ');
    return this.gateway
      .command(
        {
          action: `Updated ${name}’s details`,
          resource: 'Humo team',
          resourceId: identityId,
          category: 'security',
          permission: 'Platform.ManageHumoRoles',
          version: { expected: expectedVersion, current: target?.version },
          validate: (): FieldErrors => {
            const e: FieldErrors = {};
            if (target?.kind !== 'humo') e['name'] = 'They aren’t on the Humo team.';
            if (!nameOk(name)) e['name'] = 'Enter their first name and surname.';
            if (!emailOk(email) || !email.endsWith(`@${HUMO_EMAIL_DOMAIN}`)) e['email'] = `Their @${HUMO_EMAIL_DOMAIN} address.`;
            else if (this.store.identities().some((i) => i.id !== identityId && i.email.toLowerCase() === email)) e['email'] = 'Someone else already signs in with this email.';
            return e;
          },
        },
        () => this.store.changeIdentity(identityId, (i) => ({ ...i, name, email, title: details.title?.trim() || undefined, initials: initialsOf(name) })),
      )
      .pipe(map(() => undefined));
  }

  act(identityId: string, a: HumoTeamAction, expectedVersion?: number): Observable<void> {
    const target = this.store.identity(identityId);
    const me = this.auth.actor();
    const name = target?.name ?? identityId;
    const grant = 'grantId' in a ? this.team.pending().find((g) => g.id === a.grantId) : undefined;
    const ended = a.type === 'end-role' ? target?.assignments.find((x) => x.id === a.assignmentId) : undefined;
    const reasonText = 'reason' in a ? ` — ${a.reason.trim()}` : '';
    const what: Record<HumoTeamAction['type'], string> = {
      'grant-role': a.type === 'grant-role' ? `${a.role === 'system-admin' ? 'Asked to make' : 'Made'} ${name} ${ROLE_LABELS[a.role]}${a.role === 'system-admin' ? ' (needs a second System Administrator)' : ''}` : '',
      'end-role': `Ended ${ended ? ROLE_LABELS[ended.role] : 'a role'} for ${name}`,
      'set-impersonation': a.type === 'set-impersonation' ? `${a.allowed ? 'Allowed' : 'Withdrew'} impersonation for ${name}` : '',
      'set-delegated-activation':
        a.type === 'set-delegated-activation' ? `${a.allowed ? 'Granted' : 'Revoked'} delegated account activation (${DELEGATED}) for ${name}` : '',
      'set-customers': `Changed the customers ${name} looks after`,
      suspend: `Suspended ${name}’s Humo access`,
      restore: `Restored ${name}’s Humo access`,
      offboard: `Offboarded ${name} from the Humo team`,
      'approve-grant': `Approved ${grant ? `${grant.identityName} as ${ROLE_LABELS[grant.role]} (requested by ${grant.requestedBy})` : 'a grant'}${grant?.requestedById === me.id ? ` — confirmed by the sole System Administrator after the ${SOLE_ADMIN_COOLING_OFF_HOURS}-hour cooling-off period` : ''}`,
      'decline-grant': `Declined ${grant ? `${grant.identityName} as ${ROLE_LABELS[grant.role]}` : 'a grant'}`,
    };
    return this.gateway
      .command(
        {
          action: what[a.type] + reasonText,
          resource: 'Humo team',
          resourceId: identityId,
          category: 'security',
          permission: 'Platform.ManageHumoRoles',
          stepUp: true,
          version: { expected: expectedVersion, current: target?.version },
          validate: () => this.check(identityId, target, a, grant),
        },
        () => this.apply(identityId, target!, a, grant, me.name),
      )
      .pipe(map(() => undefined));
  }

  private check(identityId: string, target: Identity | undefined, a: HumoTeamAction, grant?: PendingHumoGrant): FieldErrors | null {
    const me = this.auth.actor();
    if (!target || target.kind !== 'humo') return { id: 'They aren’t on the Humo team.' };
    if ('reason' in a && a.reason.trim().length < 5) return { reason: 'Say why, in a few words. It goes in the audit log.' };
    if (a.type === 'approve-grant' || a.type === 'decline-grant') {
      if (!grant || grant.identityId !== identityId) return { grantId: 'That request is no longer waiting.' };
      if (a.type === 'approve-grant' && grant.requestedById === me.id) {
        // Sole-administrator safeguard: otherwise nobody could ever approve a second System Administrator.
        if (!isSoleSystemAdmin(this.store.identities(), me.id)) return { grantId: 'A second System Administrator approves it: not the person who asked.' };
        const from = soleAdminConfirmableFrom(grant);
        if (Date.now() < from.getTime()) {
          return { grantId: `You’re the only System Administrator, so you can confirm your own request after a ${SOLE_ADMIN_COOLING_OFF_HOURS}-hour cooling-off period: from ${from.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}.` };
        }
      }
      if (grant.identityId === me.id) return { grantId: 'You can’t decide on your own access.' };
      return null;
    }
    if (identityId === me.id) return { id: 'You can’t change your own access. Ask another System Administrator.' };
    const roles = activeAssignments(target).filter((x) => isHumoRole(x.role));
    switch (a.type) {
      case 'grant-role':
        if (target.status === 'deactivated') return { role: 'They’ve left the Humo team.' };
        if (roles.some((x) => x.role === a.role)) return { role: `They’re already ${ROLE_LABELS[a.role]}.` };
        if (a.role === 'system-admin' && this.team.pending().some((g) => g.identityId === identityId)) return { role: 'A request is already waiting for approval.' };
        if (a.label.trim().length < 3) return { label: 'Describe what they do in this role.' };
        return null;
      case 'end-role': {
        const r = roles.find((x) => x.id === a.assignmentId);
        if (!r) return { assignmentId: 'That role isn’t active.' };
        if (r.role === 'system-admin' && this.isLastSystemAdmin(identityId)) return { assignmentId: 'They’re the last active System Administrator. Make someone else one first.' };
        if (r.role === 'humo-account-manager' && this.customersOf(identityId).length) return { assignmentId: `Hand over their ${this.customersOf(identityId).length} customers to another account manager first.` };
        return null;
      }
      case 'set-impersonation':
        if (!roles.some((x) => x.role === 'system-admin')) return { allowed: 'Only System Administrators can be allowed to impersonate.' };
        return null;
      case 'set-delegated-activation': {
        const am = roles.find((x) => x.role === 'humo-account-manager');
        if (!am) return { allowed: 'Only Account Managers can be given delegated account activation.' };
        if (target.status !== 'active') return { allowed: 'Their Humo access isn’t active.' };
        if (a.allowed === !!am.grants?.includes(DELEGATED)) return { allowed: a.allowed ? 'They already have it.' : 'They don’t have it.' };
        return null;
      }
      case 'set-customers': {
        if (!roles.some((x) => x.role === 'humo-account-manager')) return { organisationIds: 'They aren’t an account manager.' };
        const keep = new Set(a.organisationIds);
        const dropped = this.customersOf(identityId).filter((c) => !keep.has(c.organisationId));
        if (dropped.length) return { organisationIds: `Every customer needs an account manager: move ${dropped.map((c) => c.name).join(', ')} by giving them to someone else from that person’s page.` };
        return null;
      }
      case 'suspend':
        if (target.status !== 'active' && target.status !== 'invited') return { status: 'Their access isn’t active.' };
        if (roles.some((x) => x.role === 'system-admin') && this.isLastSystemAdmin(identityId)) return { status: 'They’re the last active System Administrator.' };
        return null;
      case 'restore':
        return target.status === 'suspended' ? null : { status: 'They aren’t suspended.' };
      case 'offboard': {
        if (target.status === 'deactivated') return { status: 'They’ve already left.' };
        if (this.isLastSystemAdmin(identityId)) return { status: 'They’re the last active System Administrator. Make someone else one first.' };
        if (this.customersOf(identityId).length) {
          if (!a.reassignTo) return { reassignTo: `Choose who looks after their ${this.customersOf(identityId).length} customers.` };
          if (!this.accountManagers(identityId).some((i) => i.id === a.reassignTo)) return { reassignTo: 'Choose an active account manager.' };
        }
        return null;
      }
    }
  }

  private apply(identityId: string, target: Identity, a: HumoTeamAction, grant: PendingHumoGrant | undefined, by: string): void {
    switch (a.type) {
      case 'grant-role':
        if (a.role === 'system-admin') {
          const me = this.auth.actor();
          this.team.add({ identityId, identityName: target.name, role: a.role, label: a.label.trim(), reason: a.reason.trim(), requestedById: me.id, requestedBy: me.name, requestedAt: new Date().toISOString() });
          this.announceSoleAdminRequest(identityId, target.name);
        } else {
          this.grantRole(identityId, a.role, a.label.trim(), by);
        }
        return;
      case 'end-role': {
        const r = target.assignments.find((x) => x.id === a.assignmentId);
        // Impersonation is a grant on the System Administrator role: it ends with it.
        this.store.end(identityId, a.assignmentId, by);
        if (r?.role === 'system-admin') this.endSessions(identityId);
        return;
      }
      case 'set-impersonation':
        this.store.changeIdentity(identityId, (i) => ({
          ...i,
          assignments: i.assignments.map((x) =>
            x.role === 'system-admin' && x.status === 'active'
              ? { ...x, version: x.version + 1, grants: a.allowed ? [...new Set([...(x.grants ?? []), 'System.Impersonate' as const])] : (x.grants ?? []).filter((g) => g !== 'System.Impersonate') }
              : x,
          ),
        }));
        return;
      case 'set-delegated-activation':
        this.store.changeIdentity(identityId, (i) => ({
          ...i,
          assignments: i.assignments.map((x) =>
            x.role === 'humo-account-manager' && x.status === 'active'
              ? { ...x, version: x.version + 1, grants: a.allowed ? [...new Set([...(x.grants ?? []), DELEGATED])] : (x.grants ?? []).filter((g) => g !== DELEGATED) }
              : x,
          ),
        }));
        this.accounts.notify({
          to: { role: 'system-admin' },
          actorId: this.auth.actor().id,
          title: `Delegated account activation ${a.allowed ? 'granted' : 'revoked'}: ${target.name}`,
          detail: a.allowed ? `${target.name} can now activate new customer accounts without a separate approval.` : `${target.name}’s new accounts need approval again.`,
          link: `/platform/team/${identityId}`,
        });
        return;
      case 'set-customers':
        this.platform.setAccountManager(a.organisationIds, { id: identityId });
        return;
      case 'suspend':
        this.store.changeIdentity(identityId, (i) => ({ ...i, status: 'suspended', suspendedFrom: i.status === 'invited' ? 'invited' : 'active' }));
        this.endSessions(identityId);
        return;
      case 'restore':
        // Back to where they were: an invitee who never accepted is still invited, not active.
        this.store.changeIdentity(identityId, (i) => ({ ...i, status: i.suspendedFrom ?? 'active', suspendedFrom: undefined }));
        return;
      case 'offboard': {
        const customers = this.customersOf(identityId);
        if (customers.length && a.reassignTo) {
          const to = this.store.identity(a.reassignTo)!;
          this.platform.setAccountManager(
            customers.map((c) => c.organisationId),
            { id: to.id },
          );
        }
        for (const r of activeAssignments(target).filter((x) => isHumoRole(x.role))) this.store.end(identityId, r.id, by);
        this.store.changeIdentity(identityId, (i) => ({ ...i, status: 'deactivated' }));
        this.endSessions(identityId);
        for (const g of this.team.pending().filter((x) => x.identityId === identityId || x.requestedById === identityId)) this.team.remove(g.id);
        return;
      }
      case 'approve-grant':
        this.grantRole(identityId, grant!.role, grant!.label, `${grant!.requestedBy}, approved by ${by}`);
        this.team.remove(grant!.id);
        return;
      case 'decline-grant':
        this.team.remove(grant!.id);
        return;
    }
  }
}
