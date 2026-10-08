import { Router } from '@angular/router';
import { Observable, of, switchMap, throwError } from 'rxjs';
import { ApiError, NewRelationship, Person, PersonDataSource, PersonDetails, RelationshipView, Scheme, UnitDataSource } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { FormField, FormValues, openForm, today } from '../shared/form-drawer';

const PERSON_FIELDS: FormField[] = [
  {
    key: 'kind', label: 'This is', type: 'select', required: true,
    options: [
      { value: 'individual', label: 'A person' },
      { value: 'company', label: 'A company' },
      { value: 'trust', label: 'A trust' },
    ],
  },
  { key: 'firstName', label: 'First name', type: 'text', required: true, half: true, showIf: (v) => v['kind'] === 'individual' },
  { key: 'lastName', label: 'Surname', type: 'text', required: true, half: true, showIf: (v) => v['kind'] === 'individual' },
  { key: 'lastName', label: 'Registered name', type: 'text', required: true, showIf: (v) => v['kind'] !== 'individual' },
  { key: 'firstName', label: 'Contact person', type: 'text', showIf: (v) => v['kind'] !== 'individual' },
  { key: 'phone', label: 'Mobile', type: 'tel', half: true, placeholder: '082 555 0142' },
  { key: 'email', label: 'Email', type: 'email', half: true },
  {
    key: 'preferredChannel', label: 'Prefers to hear by', type: 'select', required: true,
    options: [
      { value: 'email', label: 'Email' },
      { value: 'sms', label: 'SMS' },
      { value: 'whatsapp', label: 'WhatsApp' },
    ],
  },
  { key: 'postalAddress', label: 'Postal address', type: 'textarea' },
];

const personDetails = (v: FormValues): PersonDetails => ({
  firstName: v['firstName'] ?? '', lastName: v['lastName'] ?? '', kind: v['kind'] as Person['kind'], email: v['email'] ?? '', phone: v['phone'] ?? '',
  preferredChannel: v['preferredChannel'] as Person['preferredChannel'], postalAddress: v['postalAddress'],
});

/** The link fields, used when adding someone and when linking an existing person. */
function linkFields(schemes: Scheme[]): FormField[] {
  return [
    {
      key: 'type', label: 'Role', type: 'select', required: true,
      options: [
        { value: 'owner', label: 'Owner of a unit' },
        { value: 'tenant', label: 'Tenant of a unit' },
        { value: 'trustee', label: 'Trustee of a scheme' },
      ],
    },
    { key: 'schemeId', label: 'Scheme', type: 'select', required: true, half: true, options: schemes.map((s) => ({ value: s.id, label: s.name })) },
    { key: 'unitNumber', label: 'Unit', type: 'text', required: true, half: true, placeholder: 'e.g. 42', showIf: (v) => v['type'] !== 'trustee' },
    {
      key: 'portfolio', label: 'Position', type: 'select', required: true, half: true, showIf: (v) => v['type'] === 'trustee',
      options: ['Chairperson', 'Treasurer', 'Trustee'].map((p) => ({ value: p, label: p })),
    },
    { key: 'since', label: 'Since', type: 'date', required: true, half: true },
    { key: 'until', label: 'Lease ends', type: 'date', half: true, showIf: (v) => v['type'] === 'tenant' },
  ];
}

/** The relationship as the API expects it; a unit is looked up by its number, as people say it. */
function linkFrom(v: FormValues, units: UnitDataSource, schemes: Scheme[]): Observable<NewRelationship> {
  const base = { type: v['type'] as NewRelationship['type'], schemeId: v['schemeId'], since: v['since'], until: v['type'] === 'tenant' && v['until'] ? v['until'] : undefined };
  if (base.type === 'trustee') return of({ ...base, portfolio: v['portfolio'] });
  const number = (v['unitNumber'] ?? '').replace(/^unit\s*/i, '').trim();
  const scheme = schemes.find((s) => s.id === base.schemeId)?.name ?? 'that scheme';
  return units.get(base.schemeId, number).pipe(
    switchMap((u) => (u ? of({ ...base, unitId: u.unit.id }) : throwError(() => new ApiError('validation', 'Unit not found', { unitNumber: `There’s no unit ${number} in ${scheme}.` })))),
  );
}

export function newPersonForm(drawer: DrawerService, people: PersonDataSource, units: UnitDataSource, schemes: Scheme[], router: Router, schemeId?: string): void {
  openForm(drawer, {
    eyebrow: 'People',
    title: 'Add an owner, tenant or trustee',
    intro: 'One record per person, however many roles they hold. If they’re already in the directory, open them and link the new role instead.',
    fields: [...PERSON_FIELDS, ...linkFields(schemes)],
    initial: { kind: 'individual', preferredChannel: 'email', type: 'owner', schemeId: schemeId ?? schemes[0]?.id ?? '', since: today(), portfolio: 'Trustee' },
    submitLabel: 'Add person',
    submit: (v) => linkFrom(v, units, schemes).pipe(switchMap((link) => people.create(personDetails(v), link))),
    success: (_id, v) => `${v['kind'] === 'individual' ? `${v['firstName']} ${v['lastName']}` : v['lastName']} added.`,
    done: (id) => router.navigate(['/people', id]),
    failure: 'The person wasn’t added',
  });
}

export function editPersonForm(drawer: DrawerService, people: PersonDataSource, p: Person): void {
  openForm(drawer, {
    eyebrow: p.displayName,
    title: 'Edit contact details',
    fields: PERSON_FIELDS,
    initial: { kind: p.kind, firstName: p.firstName, lastName: p.lastName, phone: p.phone, email: p.email, preferredChannel: p.preferredChannel, postalAddress: p.postalAddress ?? '' },
    submitLabel: 'Save details',
    submit: (v) => people.update(p.id, personDetails(v), p.version),
    success: () => 'Contact details saved.',
    failure: 'The details weren’t saved',
  });
}

export function linkPersonForm(drawer: DrawerService, people: PersonDataSource, units: UnitDataSource, schemes: Scheme[], p: Person): void {
  openForm(drawer, {
    eyebrow: p.displayName,
    title: 'Add a role',
    intro: 'Owner or tenant of a unit, or trustee of a scheme. A new owner becomes the account holder if the unit has none.',
    fields: linkFields(schemes),
    initial: { type: 'owner', schemeId: schemes[0]?.id ?? '', since: today(), portfolio: 'Trustee' },
    submitLabel: 'Add role',
    submit: (v) => linkFrom(v, units, schemes).pipe(switchMap((link) => people.addRelationship(p.id, link))),
    success: () => `Role added for ${p.displayName}.`,
    failure: 'The role wasn’t added',
  });
}

const END_COPY = { owner: 'sold or transferred the unit', tenant: 'moved out', trustee: 'stepped down from the board' };

export function endRelationshipForm(drawer: DrawerService, people: PersonDataSource, p: Person, r: RelationshipView): void {
  const where = r.unit ? `Unit ${r.unit.number}, ${r.scheme.name}` : r.scheme.name;
  openForm(drawer, {
    eyebrow: p.displayName,
    title: `End: ${r.relationship.type === 'trustee' ? r.relationship.portfolio : r.relationship.type} · ${where}`,
    intro: `Use this when they ${END_COPY[r.relationship.type]}. The history stays with the person and the unit.`,
    fields: [{ key: 'until', label: 'Last day', type: 'date', required: true }],
    initial: { until: today() },
    submitLabel: 'End role',
    submit: (v) => people.endRelationship(r.relationship.id, v['until']),
    success: () => `Ended. ${p.displayName}’s history is kept.`,
    failure: 'The role wasn’t ended',
  });
}
