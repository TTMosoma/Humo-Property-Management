import { Router } from '@angular/router';
import { HUMO_EMAIL_DOMAIN, HUMO_ROLES, HumoRole, HumoTeamAction, HumoTeamDataSource, HumoTeamMember, PendingHumoGrant, ROLE_LABELS, RoleAssignment } from '../../../domain';
import { DrawerService } from '../../../ui/drawer/drawer.service';
import { openForm } from '../../shared/form-drawer';

const ROLE_HELP: Record<HumoRole, string> = {
  'system-admin': 'Runs the platform and the Humo team. Needs a second System Administrator’s approval (or, while you’re the only one, your own confirmation after 24 hours).',
  'humo-account-manager': 'Looks after customers: onboarding, adoption, subscriptions.',
  'humo-support': 'Helps customers and investigates problems. Can’t change packages, configuration or roles.',
  'humo-executive': 'Business figures: revenue, growth, account health. Read-only.',
};
const DEFAULT_LABEL: Record<HumoRole, string> = {
  'system-admin': 'Platform operations',
  'humo-account-manager': 'Customer accounts',
  'humo-support': 'Customer support',
  'humo-executive': 'Leadership',
};
const roleOptions = (except: HumoRole[] = []) => HUMO_ROLES.filter((r) => !except.includes(r)).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
const step = (detail: string) => ({ action: 'change-humo-team' as const, detail });

export function inviteMemberForm(drawer: DrawerService, data: HumoTeamDataSource, router: Router): void {
  openForm(drawer, {
    eyebrow: 'Humo team',
    title: 'Invite to the Humo team',
    intro: `They get an invitation at their @${HUMO_EMAIL_DOMAIN} address and set up a passkey on first sign-in. Humo staff can never be invited into a customer’s agency.`,
    fields: [
      { key: 'name', label: 'Full name', type: 'text', required: true },
      { key: 'email', label: 'Humo email', type: 'email', required: true, placeholder: `name@${HUMO_EMAIL_DOMAIN}` },
      { key: 'title', label: 'Job title', type: 'text', placeholder: 'e.g. Support Specialist' },
      { key: 'role', label: 'Role', type: 'select', required: true, options: roleOptions() },
      { key: 'label', label: 'What they do', type: 'text', required: true, help: 'Shown with the role, e.g. “Western Cape accounts”.' },
      { key: 'reason', label: 'Why', type: 'text', required: true, help: 'For the audit log, e.g. “New support hire, starts Monday”.' },
    ],
    initial: { role: 'humo-support', label: DEFAULT_LABEL['humo-support'] },
    changed: (key, v) => (key === 'role' ? { ...v, label: DEFAULT_LABEL[v['role'] as HumoRole] } : v),
    stepUp: (v) => step(`Invite ${v['name'] || 'someone'} as ${ROLE_LABELS[v['role'] as HumoRole]}`),
    submitLabel: 'Send invitation',
    submit: (v) => data.invite({ name: v['name'], email: v['email'], title: v['title'], role: v['role'] as HumoRole, label: v['label'], reason: v['reason'] }),
    success: (_, v) => (v['role'] === 'system-admin' ? 'Invited. A second System Administrator approves the role before it applies.' : 'Invitation sent.'),
    done: (id) => router.navigate(['/platform/team', id]),
    failure: 'The invitation wasn’t sent',
  });
}

export function detailsForm(drawer: DrawerService, data: HumoTeamDataSource, m: HumoTeamMember): void {
  const i = m.identity;
  openForm(drawer, {
    eyebrow: 'Humo team',
    title: `${i.name}’s details`,
    fields: [
      { key: 'name', label: 'Full name', type: 'text', required: true },
      { key: 'email', label: 'Humo email', type: 'email', required: true, help: 'It’s their Humo sign-in.' },
      { key: 'title', label: 'Job title', type: 'text' },
    ],
    initial: { name: i.name, email: i.email, title: i.title ?? '' },
    submitLabel: 'Save',
    submit: (v) => data.update(i.id, { name: v['name'], email: v['email'], title: v['title'] }, i.version),
    success: () => 'Saved.',
    failure: 'It wasn’t saved',
  });
}

export function grantRoleForm(drawer: DrawerService, data: HumoTeamDataSource, m: HumoTeamMember): void {
  const held = m.roles.map((r) => r.role as HumoRole);
  openForm(drawer, {
    eyebrow: m.identity.name,
    title: 'Give a Humo role',
    fields: [
      { key: 'role', label: 'Role', type: 'select', required: true, options: roleOptions(held) },
      { key: 'label', label: 'What they do', type: 'text', required: true },
      { key: 'reason', label: 'Why', type: 'text', required: true },
    ],
    initial: { role: roleOptions(held)[0]?.value ?? '', label: DEFAULT_LABEL[(roleOptions(held)[0]?.value ?? 'humo-support') as HumoRole] },
    changed: (key, v) => (key === 'role' ? { ...v, label: DEFAULT_LABEL[v['role'] as HumoRole] } : v),
    intro: 'System Administrator needs a second System Administrator to approve it. While you’re the only one, you confirm it yourself after a 24-hour cooling-off period, and the Humo team is told.',
    stepUp: (v) => step(`Make ${m.identity.name} ${ROLE_LABELS[v['role'] as HumoRole]}`),
    submitLabel: 'Give role',
    submit: (v) => act(data, m, { type: 'grant-role', role: v['role'] as HumoRole, label: v['label'], reason: v['reason'] }),
    success: (_, v) => (v['role'] === 'system-admin' ? 'Requested. Another System Administrator approves it.' : 'Role given.'),
    failure: 'The role wasn’t given',
  });
}

export function endRoleForm(drawer: DrawerService, data: HumoTeamDataSource, m: HumoTeamMember, r: RoleAssignment): void {
  openForm(drawer, {
    eyebrow: m.identity.name,
    title: `End ${ROLE_LABELS[r.role]}`,
    intro: r.role === 'system-admin' ? 'Their permission to impersonate ends with it, and they’re signed out.' : 'It stays in their history.',
    fields: [{ key: 'reason', label: 'Why', type: 'text', required: true }],
    stepUp: step(`End ${ROLE_LABELS[r.role]} for ${m.identity.name}`),
    submitLabel: 'End role',
    submit: (v) => act(data, m, { type: 'end-role', assignmentId: r.id, reason: v['reason'] }),
    success: () => 'Role ended.',
    failure: 'The role wasn’t ended',
  });
}

export function impersonationForm(drawer: DrawerService, data: HumoTeamDataSource, m: HumoTeamMember): void {
  const allow = !m.canImpersonate;
  openForm(drawer, {
    eyebrow: m.identity.name,
    title: allow ? 'Allow impersonation' : 'Withdraw impersonation',
    intro: allow
      ? 'They’ll be able to view as a customer user (Observe), and act as one (Act, with step-up). Every session is recorded and visible to the customer’s administrators.'
      : 'They can still look customer users up, but not view as them.',
    fields: [{ key: 'reason', label: 'Why', type: 'text', required: true }],
    stepUp: step(`${allow ? 'Allow' : 'Withdraw'} impersonation for ${m.identity.name}`),
    submitLabel: allow ? 'Allow' : 'Withdraw',
    submit: (v) => act(data, m, { type: 'set-impersonation', allowed: allow, reason: v['reason'] }),
    success: () => (allow ? 'Allowed.' : 'Withdrawn.'),
    failure: 'It wasn’t changed',
  });
}

/** Delegated account activation: an individual grant on the Account Manager role (docs/21). */
export function delegatedActivationForm(drawer: DrawerService, data: HumoTeamDataSource, m: HumoTeamMember): void {
  const allow = !m.canActivateWithoutApproval;
  openForm(drawer, {
    eyebrow: m.identity.name,
    title: allow ? 'Grant delegated account activation' : 'Revoke delegated account activation',
    intro: allow
      ? `${m.identity.name} will be able to activate new customer accounts without a separate approval. Each one is still validated, starts in onboarding, is recorded in the audit log, and notifies System Administrators. It doesn’t let them invite users, change roles or override packages.`
      : `From now on, ${m.identity.name}’s new customer accounts wait for a System Administrator’s approval. Accounts they already activated stay as they are.`,
    fields: [{ key: 'reason', label: 'Why', type: 'text', required: true }],
    stepUp: step(`${allow ? 'Grant' : 'Revoke'} delegated account activation for ${m.identity.name}`),
    submitLabel: allow ? 'Grant' : 'Revoke',
    submit: (v) => act(data, m, { type: 'set-delegated-activation', allowed: allow, reason: v['reason'] }),
    success: () => (allow ? 'Granted. It applies to their next new account.' : 'Revoked. Their next new account needs approval.'),
    failure: 'It wasn’t changed',
  });
}

export function customersForm(drawer: DrawerService, data: HumoTeamDataSource, m: HumoTeamMember, all: { organisationId: string; name: string; accountManager: string }[]): void {
  openForm(drawer, {
    eyebrow: m.identity.name,
    title: 'Customers they look after',
    intro: 'Choosing a customer moves it from its current account manager. To give one of theirs to someone else, do it from that person’s page.',
    fields: [
      {
        key: 'organisationIds',
        label: 'Customers',
        type: 'checks',
        options: all.map((c) => ({ value: c.organisationId, label: c.accountManager && c.accountManager !== m.identity.name ? `${c.name} (now ${c.accountManager})` : c.name })),
      },
      { key: 'reason', label: 'Why', type: 'text', required: true },
    ],
    initial: { organisationIds: m.customers.map((c) => c.organisationId).join(',') },
    stepUp: step(`Change the customers ${m.identity.name} looks after`),
    submitLabel: 'Save',
    submit: (v) => act(data, m, { type: 'set-customers', organisationIds: v['organisationIds'] ? v['organisationIds'].split(',') : [], reason: v['reason'] }),
    success: () => 'Saved.',
    failure: 'It wasn’t saved',
  });
}

export function statusForm(drawer: DrawerService, data: HumoTeamDataSource, m: HumoTeamMember, kind: 'suspend' | 'restore'): void {
  openForm(drawer, {
    eyebrow: m.identity.name,
    title: kind === 'suspend' ? 'Suspend Humo access' : 'Restore Humo access',
    intro: kind === 'suspend' ? 'They’re signed out everywhere and can’t sign in until restored. Their roles and customers stay as they are.' : 'They can sign in again with their roles as before.',
    fields: [{ key: 'reason', label: 'Why', type: 'text', required: true }],
    stepUp: step(`${kind === 'suspend' ? 'Suspend' : 'Restore'} ${m.identity.name}`),
    submitLabel: kind === 'suspend' ? 'Suspend' : 'Restore',
    submit: (v) => act(data, m, { type: kind, reason: v['reason'] }),
    success: () => (kind === 'suspend' ? 'Suspended.' : 'Restored.'),
    failure: 'It wasn’t changed',
  });
}

export function offboardForm(drawer: DrawerService, data: HumoTeamDataSource, m: HumoTeamMember, managers: HumoTeamMember[]): void {
  const n = m.customers.length;
  openForm(drawer, {
    eyebrow: m.identity.name,
    title: `${m.identity.name} leaves Humo`,
    intro: `Every Humo role ends, they’re signed out everywhere and can’t sign in again.${n ? ` Their ${n} customers move to the account manager you choose.` : ''} Their history stays in the audit log.`,
    fields: [
      ...(n
        ? [{ key: 'reassignTo', label: `Who looks after their ${n} customers`, type: 'select' as const, required: true, options: managers.filter((x) => x.identity.id !== m.identity.id).map((x) => ({ value: x.identity.id, label: `${x.identity.name} (${x.customers.length} customers)` })) }]
        : []),
      { key: 'reason', label: 'Why', type: 'text', required: true, placeholder: 'e.g. Resigned, last day 31 October' },
    ],
    stepUp: step(`Offboard ${m.identity.name}`),
    submitLabel: 'Offboard',
    submit: (v) => act(data, m, { type: 'offboard', reason: v['reason'], reassignTo: v['reassignTo'] || undefined }),
    success: () => `${m.identity.name} has left the Humo team.`,
    failure: 'They weren’t offboarded',
  });
}

export function declineForm(drawer: DrawerService, data: HumoTeamDataSource, g: PendingHumoGrant): void {
  openForm(drawer, {
    eyebrow: 'Humo team',
    title: `Decline: ${g.identityName} as ${ROLE_LABELS[g.role]}`,
    fields: [{ key: 'reason', label: 'Why', type: 'text', required: true }],
    stepUp: step(`Decline ${g.identityName} as ${ROLE_LABELS[g.role]}`),
    submitLabel: 'Decline',
    submit: (v) => data.act(g.identityId, { type: 'decline-grant', grantId: g.id, reason: v['reason'] }),
    success: () => 'Declined.',
    failure: 'It wasn’t declined',
  });
}

export const roleHelp = (r: HumoRole) => ROLE_HELP[r];

function act(data: HumoTeamDataSource, m: HumoTeamMember, a: HumoTeamAction) {
  return data.act(m.identity.id, a, m.identity.version);
}
