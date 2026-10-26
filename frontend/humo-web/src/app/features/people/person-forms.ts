import { Router } from '@angular/router';
import { Observable, of, switchMap, throwError } from 'rxjs';
import { ApiError, NewRelationship, Person, PersonDataSource, PersonDetails, Relationship, RelationshipView, Scheme, UnitDataSource, UnitSummary } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { FormField, FormValues, REASON_FIELD, openForm, today } from '../shared/form-drawer';

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
      ],
      // D2: the board register is the source of truth for trustees.
      help: 'Trustees are appointed on the scheme’s board (Governance › Board), from a resolution or by co-option.',
    },
    { key: 'schemeId', label: 'Scheme', type: 'select', required: true, half: true, options: schemes.map((s) => ({ value: s.id, label: s.name })) },
    { key: 'unitNumber', label: 'Unit', type: 'text', required: true, half: true, placeholder: 'e.g. 42' },
    {
      key: 'ownership', label: 'If the unit already has an owner', type: 'select', showIf: (v) => v['type'] === 'owner',
      options: [
        { value: 'joint', label: 'They own it together (partners, spouses)' },
        { value: 'replaces', label: 'They replace the owner (sold or transferred)' },
      ],
      help: 'Replacing ends the current owner’s ownership the day before “Since”. The new owner holds the account; its history stays with the unit.',
    },
    { key: 'since', label: 'Since', type: 'date', required: true, half: true },
    { key: 'until', label: 'Lease ends', type: 'date', half: true, showIf: (v) => v['type'] === 'tenant' },
  ];
}

/** The relationship as the API expects it; a unit is looked up by its number, as people say it. */
function linkFrom(v: FormValues, units: UnitDataSource, schemes: Scheme[]): Observable<NewRelationship> {
  const base = {
    type: v['type'] as NewRelationship['type'],
    schemeId: v['schemeId'],
    since: v['since'],
    until: v['type'] === 'tenant' && v['until'] ? v['until'] : undefined,
    ownership: v['type'] === 'owner' && v['ownership'] ? (v['ownership'] as NewRelationship['ownership']) : undefined,
  };
  const number = (v['unitNumber'] ?? '').replace(/^unit\s*/i, '').trim();
  const scheme = schemes.find((s) => s.id === base.schemeId)?.name ?? 'that scheme';
  return units.get(base.schemeId, number).pipe(
    switchMap((u) => (u ? of({ ...base, unitId: u.unit.id }) : throwError(() => new ApiError('validation', 'Unit not found', { unitNumber: `There’s no unit ${number} in ${scheme}.` })))),
  );
}

/** `unitNumber`: started from a unit's page, so the new person joins that unit, and the page stays where it is. */
export function newPersonForm(drawer: DrawerService, people: PersonDataSource, units: UnitDataSource, schemes: Scheme[], router: Router, schemeId?: string, unitNumber?: string): void {
  openForm(drawer, {
    eyebrow: 'People',
    title: 'Add an owner, tenant or trustee',
    intro: 'One record per person, however many roles they hold. If they’re already in the directory, open them and link the new role instead.',
    fields: [...PERSON_FIELDS, ...linkFields(schemes)],
    initial: { kind: 'individual', preferredChannel: 'email', type: 'owner', schemeId: schemeId ?? schemes[0]?.id ?? '', unitNumber: unitNumber ?? '', since: today(), portfolio: 'Trustee' },
    submitLabel: 'Add person',
    submit: (v) => linkFrom(v, units, schemes).pipe(switchMap((link) => people.create(personDetails(v), link))),
    success: (_id, v) => `${v['kind'] === 'individual' ? `${v['firstName']} ${v['lastName']}` : v['lastName']} added.`,
    done: (id) => (unitNumber ? undefined : router.navigate(['/people', id])),
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

export function endRelationshipForm(drawer: DrawerService, people: PersonDataSource, p: Person, r: Pick<RelationshipView, 'relationship' | 'scheme' | 'unit'>): void {
  const where = r.unit ? `Unit ${r.unit.number}, ${r.scheme.name}` : r.scheme.name;
  openForm(drawer, {
    eyebrow: p.displayName,
    title: `End: ${r.relationship.type === 'trustee' ? r.relationship.portfolio : r.relationship.type} · ${where}`,
    intro: `Use this when they ${END_COPY[r.relationship.type]}. The history stays with the person and the unit.${r.relationship.type === 'owner' ? ' If they held the account, another current owner takes it over; a buyer is added with “They replace the owner”.' : ''}`,
    fields: [{ key: 'endedOn', label: 'Ended on', type: 'date', required: true, help: 'The sale, transfer or move-out date. They’re off the unit from this day.' }],
    initial: { endedOn: today() },
    submitLabel: 'End role',
    submit: (v) => people.endRelationship(r.relationship.id, v['endedOn']),
    success: () => `Ended. ${p.displayName}’s history is kept.`,
    failure: 'The role wasn’t ended',
  });
}

/** Corrects when an owner or tenant started, or a tenant's lease end. */
export function editRelationshipForm(drawer: DrawerService, people: PersonDataSource, p: Person, r: Relationship, where: string): void {
  openForm(drawer, {
    eyebrow: `${p.displayName} · ${where}`,
    title: `Correct the ${r.type === 'tenant' ? 'lease' : 'ownership'} dates`,
    intro: r.type === 'owner' ? 'To record a sale or transfer, use End instead.' : 'The lease end is their last day as tenant.',
    fields: [
      { key: 'since', label: 'Since', type: 'date', required: true, half: true },
      { key: 'until', label: r.type === 'tenant' ? 'Lease ends' : 'Last day', type: 'date', half: true, showIf: () => r.type === 'tenant' || !!r.until },
    ],
    initial: { since: r.since.slice(0, 10), until: r.until?.slice(0, 10) ?? '' },
    submitLabel: 'Save dates',
    submit: (v) => people.updateRelationship(r.id, v['since'], v['until'] || undefined),
    success: () => 'Dates saved.',
    failure: 'The dates weren’t saved',
  });
}

/** Removes an owner or tenant added by mistake. The API refuses once anything was sent to them for the unit. */
export function removeRelationshipForm(drawer: DrawerService, people: PersonDataSource, p: Person, r: Relationship, where: string): void {
  openForm(drawer, {
    eyebrow: `${p.displayName} · ${where}`,
    title: `Remove as ${r.type}`,
    intro: `Only if ${p.displayName} was added to the wrong unit by mistake. Once statements, letters or invoices have gone out for the unit while they were on it, use End instead so the history stays.`,
    fields: [REASON_FIELD],
    submitLabel: 'Remove',
    submit: (v) => people.removeRelationship(r.id, v['reason']),
    success: () => `${p.displayName} was removed from ${where}.`,
    failure: 'They weren’t removed',
  });
}

/** From a unit's page: someone already in People becomes its owner or tenant. */
export function addToUnitForm(drawer: DrawerService, people: PersonDataSource, s: UnitSummary, directory: Person[]): void {
  openForm(drawer, {
    eyebrow: `${s.scheme.name} · Unit ${s.unit.number}`,
    title: 'Add an owner or tenant',
    intro: 'Choose someone already in People. Someone new? Use “New person” instead.',
    fields: [
      { key: 'personId', label: 'Person', type: 'select', required: true, options: directory.map((d) => ({ value: d.id, label: d.email ? `${d.displayName} · ${d.email}` : d.displayName })) },
      { key: 'type', label: 'Role', type: 'select', required: true, half: true, options: [{ value: 'owner', label: 'Owner' }, { value: 'tenant', label: 'Tenant' }] },
      { key: 'since', label: 'Since', type: 'date', required: true, half: true },
      { key: 'until', label: 'Lease ends', type: 'date', half: true, showIf: (v) => v['type'] === 'tenant' },
      {
        key: 'ownership', label: 'If the unit already has an owner', type: 'select', showIf: (v) => v['type'] === 'owner' && s.owners.length > 0,
        options: [
          { value: 'joint', label: 'They own it together (partners, spouses)' },
          { value: 'replaces', label: `They replace ${s.owners.map((o) => o.displayName).join(' and ')} (sold or transferred)` },
        ],
      },
    ],
    initial: { type: 'owner', since: today() },
    submitLabel: 'Add',
    submit: (v) =>
      people.addRelationship(v['personId'], {
        type: v['type'] as NewRelationship['type'],
        schemeId: s.scheme.id,
        unitId: s.unit.id,
        since: v['since'],
        until: v['type'] === 'tenant' && v['until'] ? v['until'] : undefined,
        ownership: v['type'] === 'owner' && v['ownership'] ? (v['ownership'] as NewRelationship['ownership']) : undefined,
      }),
    success: (_r, v) => `${directory.find((d) => d.id === v['personId'])?.displayName ?? 'They'} added to unit ${s.unit.number}.`,
    failure: 'They weren’t added',
  });
}
