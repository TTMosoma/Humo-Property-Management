import { map, of, switchMap, throwError } from 'rxjs';
import { AccessDataSource, ApiError, CUSTOMER_ROLES, CustomerRole, Identity, NewAssignment, ROLE_LABELS, ROLE_META, Scheme, UnitDataSource } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { FormValues, REASON_FIELD, openForm } from '../shared/form-drawer';

/** Roles an agency can invite people into. */
const INVITABLE = CUSTOMER_ROLES;
const kindOf = (v: FormValues) => ROLE_META[(v['role'] || 'portfolio-manager') as CustomerRole].scopeKind;

/**
 * Invite someone with their first role. More roles and schemes are added
 * afterwards from their access, like for anyone else.
 */
export function inviteForm(drawer: DrawerService, access: AccessDataSource, units: UnitDataSource, organisationId: string, organisationName: string, schemes: Scheme[], firstAdministrator = false): void {
  const schemeOptions = schemes.map((s) => ({ value: s.id, label: s.name }));
  openForm(drawer, {
    eyebrow: 'Users & access',
    title: firstAdministrator ? `Invite ${organisationName}’s administrator` : 'Invite someone',
    intro: `They get an email to join ${organisationName} in Humo Property Management and set up a passkey. Until they accept, they show as Invited and can’t sign in.`,
    fields: [
      { key: 'name', label: 'Full name', type: 'text', required: true, placeholder: 'Lerato Mokoena' },
      { key: 'email', label: 'Email', type: 'email', required: true, help: 'The invitation goes here. It becomes their Humo sign-in.' },
      { key: 'title', label: 'Job title', type: 'text', placeholder: 'Portfolio Manager', showIf: (v) => kindOf(v) === 'agency' || kindOf(v) === 'schemes' },
      { key: 'role', label: 'Role', type: 'select', required: true, options: INVITABLE.map((r) => ({ value: r, label: ROLE_LABELS[r] })), help: 'What they can do. Admin roles ask you to verify it’s you.' },
      {
        key: 'where', label: 'Where it applies', type: 'select', required: true,
        options: [{ value: 'all', label: 'All schemes, including new ones' }, ...schemeOptions],
        showIf: (v) => kindOf(v) === 'schemes' && v['role'] !== 'trustee',
      },
      { key: 'board', label: 'Board (scheme)', type: 'select', required: true, options: schemeOptions, showIf: (v) => v['role'] === 'trustee' },
      { key: 'unitScheme', label: 'Scheme', type: 'select', required: true, half: true, options: schemeOptions, showIf: (v) => kindOf(v) === 'unit' },
      { key: 'unitNumber', label: 'Unit', type: 'text', required: true, half: true, placeholder: 'e.g. 42', showIf: (v) => kindOf(v) === 'unit' },
    ],
    initial: { role: firstAdministrator ? 'agency-admin' : 'portfolio-manager', where: 'all' },
    submitLabel: 'Verify and send invitation',
    stepUp: (v) => ({ action: v['role'] === 'agency-admin' ? 'add-administrator' : 'change-roles', detail: `Invite ${v['name']} as ${ROLE_LABELS[v['role'] as CustomerRole]}` }),
    submit: (v) =>
      assignmentFrom(v, organisationId, organisationName, schemes, units).pipe(
        switchMap((assignment) => access.invite({ organisationId, name: v['name'], email: v['email'], title: v['title'], assignment })),
      ),
    success: (_id, v) => `Invitation sent to ${v['email']}. They’ll show as Invited until they accept.`,
    failure: 'The invitation wasn’t sent',
  });
}

/** The first role, as the API expects it. A unit is looked up by its number, as people say it. */
function assignmentFrom(v: FormValues, organisationId: string, organisationName: string, schemes: Scheme[], units: UnitDataSource) {
  const role = v['role'] as CustomerRole;
  const name = (id: string) => schemes.find((s) => s.id === id)?.name ?? id;
  switch (ROLE_META[role].scopeKind) {
    case 'unit': {
      const schemeId = v['unitScheme'];
      const number = (v['unitNumber'] ?? '').replace(/^unit\s*/i, '').trim();
      return units.get(schemeId, number).pipe(
        switchMap((u) =>
          u
            ? of<NewAssignment>({ role, scope: { type: 'unit', organisationId, schemeIds: [schemeId], unitId: u.unit.id }, label: `Unit ${u.unit.number}, ${name(schemeId)}` })
            : throwError(() => new ApiError('validation', 'Unit not found', { unitNumber: `There’s no unit ${number} in ${name(schemeId)}.` })),
        ),
      );
    }
    case 'schemes':
      if (role === 'trustee') return of<NewAssignment>({ role, scope: { type: 'schemes', organisationId, schemeIds: [v['board']] }, label: name(v['board']) });
      return of<NewAssignment>(
        v['where'] === 'all'
          ? { role, scope: { type: 'organisation', organisationId, schemeIds: [] }, label: 'All schemes' }
          : { role, scope: { type: 'schemes', organisationId, schemeIds: [v['where']] }, label: name(v['where']) },
      );
    default:
      return of<NewAssignment>({ role, scope: { type: 'organisation', organisationId, schemeIds: [] }, label: organisationName }).pipe(map((a) => a));
  }
}

export function editPersonDetailsForm(drawer: DrawerService, access: AccessDataSource, who: Identity): void {
  openForm(drawer, {
    eyebrow: 'Users & access',
    title: `Edit ${who.name}`,
    intro: 'Their sign-in email changes too. Passkeys and devices are theirs to manage, in their own Security settings.',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'title', label: 'Job title', type: 'text' },
    ],
    initial: { name: who.name, email: who.email, title: who.title ?? '' },
    submitLabel: 'Save',
    submit: (v) => access.updateIdentity(who.id, { name: v['name'], email: v['email'], title: v['title'] }, who.version),
    success: () => 'Details saved.',
    failure: 'The details weren’t saved',
  });
}

const MEMBERSHIP_COPY = {
  suspended: { title: 'Suspend access', intro: 'They can’t sign in to work here until you restore it. Their roles stay as they are.', button: 'Verify and suspend', done: 'Access suspended' },
  active: { title: 'Restore access', intro: 'They can sign in and work here again, with the roles they had.', button: 'Verify and restore', done: 'Access restored' },
  ended: {
    title: 'Remove from the agency',
    intro: 'Every role they hold here ends today. Their history stays in the audit log; inviting them again starts afresh.',
    button: 'Verify and remove',
    done: 'Removed',
  },
};

export function membershipForm(drawer: DrawerService, access: AccessDataSource, who: Identity, organisationId: string, status: 'active' | 'suspended' | 'ended'): void {
  const copy = MEMBERSHIP_COPY[status];
  openForm(drawer, {
    eyebrow: who.name,
    title: copy.title,
    intro: copy.intro,
    fields: [REASON_FIELD],
    submitLabel: copy.button,
    stepUp: { action: 'change-roles', detail: `${copy.title}: ${who.name}` },
    submit: (v) => access.setMembershipStatus(who.id, organisationId, status, v['reason']),
    success: () => `${copy.done}: ${who.name}.`,
    failure: 'Their access wasn’t changed',
  });
}
