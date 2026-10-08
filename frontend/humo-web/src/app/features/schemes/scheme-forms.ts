import { Router } from '@angular/router';
import { SCHEME_STATUS_LABELS, Scheme, SchemeDataSource, SchemeStatus, Unit, UnitDataSource } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { FormField, FormValues, PROVINCE_OPTIONS, REASON_FIELD, openForm } from '../shared/form-drawer';

const DETAILS: FormField[] = [
  { key: 'name', label: 'Scheme name', type: 'text', required: true, placeholder: 'Kingfisher Court' },
  { key: 'code', label: 'Code', type: 'text', required: true, half: true, placeholder: 'KC', help: '2–4 letters. Every account number starts with it (KC-042).' },
  {
    key: 'type', label: 'Type', type: 'select', required: true, half: true,
    options: ['Sectional Title', 'Home Owners Association', 'Share Block'].map((t) => ({ value: t, label: t })),
  },
  { key: 'suburb', label: 'Suburb', type: 'text', required: true, half: true },
  { key: 'city', label: 'City', type: 'text', required: true, half: true },
  { key: 'province', label: 'Province', type: 'select', required: true, options: PROVINCE_OPTIONS },
];

const details = (v: FormValues) => ({ name: v['name'], code: v['code'], type: v['type'] as Scheme['type'], suburb: v['suburb'], city: v['city'], province: v['province'] });

export function newSchemeForm(drawer: DrawerService, data: SchemeDataSource, router: Router): void {
  openForm(drawer, {
    eyebrow: 'Schemes',
    title: 'Add a scheme',
    intro: 'It starts in onboarding: add its units and owners, then mark it active. Give someone the Portfolio Manager role for it in Users & access.',
    fields: DETAILS,
    initial: { type: 'Sectional Title', province: 'Gauteng' },
    submitLabel: 'Add scheme',
    submit: (v) => data.create(details(v)),
    success: (_id, v) => `${v['name']} added. Next: add its units.`,
    done: (id) => router.navigate(['/schemes', id, 'units']),
    failure: 'The scheme wasn’t added',
  });
}

export function editSchemeForm(drawer: DrawerService, data: SchemeDataSource, s: Scheme): void {
  openForm(drawer, {
    eyebrow: s.name,
    title: 'Edit scheme details',
    fields: DETAILS.map((f) => (f.key === 'code' && s.unitCount > 0 ? { ...f, help: 'Account numbers already issued keep their old code.' } : f)),
    initial: { name: s.name, code: s.code, type: s.type, suburb: s.suburb, city: s.city, province: s.province },
    submitLabel: 'Save details',
    submit: (v) => data.update(s.id, details(v), s.version),
    success: () => 'Scheme details saved.',
    failure: 'The details weren’t saved',
  });
}

const STATUS_COPY: Partial<Record<SchemeStatus, { title: string; intro: string; button: string }>> = {
  onboarding: { title: 'Start onboarding', intro: 'Units, owners and opening balances can now be loaded.', button: 'Start onboarding' },
  active: { title: 'Mark active', intro: 'The scheme is live: billing, maintenance and the resident portal run as normal.', button: 'Mark active' },
  closed: {
    title: 'Close the scheme',
    intro: 'The agency no longer manages it. It stays visible, read-only, for handover and the final accounts. It can be reopened.',
    button: 'Close scheme',
  },
  archived: { title: 'Archive', intro: 'Hidden from day-to-day lists and from everyone’s scope. Records are kept and it can be restored.', button: 'Archive' },
};

export function schemeStatusForm(drawer: DrawerService, data: SchemeDataSource, s: Scheme, status: SchemeStatus): void {
  const restoring = s.status === 'archived';
  const reopening = s.status === 'closed' && status === 'active';
  const copy = restoring
    ? { title: 'Restore scheme', intro: 'It comes back as closed (read-only); reopen it to manage it again.', button: 'Restore' }
    : reopening
      ? { title: 'Reopen the scheme', intro: 'The agency manages it again.', button: 'Reopen' }
      : STATUS_COPY[status]!;
  openForm(drawer, {
    eyebrow: `${s.name} · ${SCHEME_STATUS_LABELS[s.status]}`,
    title: copy.title,
    intro: copy.intro,
    fields: [REASON_FIELD],
    submitLabel: copy.button,
    submit: (v) => data.setStatus(s.id, status, v['reason'], s.version),
    success: () => `${s.name} is now ${SCHEME_STATUS_LABELS[status].toLowerCase()}.`,
    failure: 'The scheme wasn’t changed',
  });
}

/** The status moves offered from each state (the API checks them again). */
export function nextStatuses(s: Scheme): SchemeStatus[] {
  switch (s.status) {
    case 'prospect':
      return ['onboarding', 'archived'];
    case 'onboarding':
      return ['active', 'archived'];
    case 'active':
      return ['closed'];
    case 'closed':
      return ['active', 'archived'];
    case 'archived':
      return ['closed'];
  }
}

export const STATUS_ACTION: Record<SchemeStatus, string> = {
  prospect: 'Back to prospect',
  onboarding: 'Start onboarding',
  active: 'Mark active',
  closed: 'Close scheme',
  archived: 'Archive',
};

// ---- Units

const UNIT_FIELDS: FormField[] = [
  { key: 'number', label: 'Unit number', type: 'text', required: true, half: true, placeholder: '42' },
  { key: 'block', label: 'Block', type: 'text', half: true, placeholder: 'B' },
  { key: 'description', label: 'Description', type: 'text', required: true, placeholder: '2-bed apartment, ground floor' },
  { key: 'sizeM2', label: 'Size (m²)', type: 'number', required: true, half: true },
  { key: 'participationQuota', label: 'Participation quota (%)', type: 'number', required: true, half: true, help: 'Sets its share of the levy.' },
  { key: 'monthlyLevy', label: 'Monthly levy (R)', type: 'number', required: true, half: true },
  {
    key: 'occupancy', label: 'Who lives there', type: 'select', required: true, half: true,
    options: [
      { value: 'owner-occupied', label: 'The owner' },
      { value: 'tenanted', label: 'A tenant' },
      { value: 'vacant', label: 'Nobody (vacant)' },
    ],
  },
];

const unitDetails = (v: FormValues) => ({
  number: v['number'], block: v['block'], description: v['description'], sizeM2: Number(v['sizeM2']), participationQuota: Number(v['participationQuota']),
  monthlyLevy: Number(v['monthlyLevy']), occupancy: v['occupancy'] as Unit['occupancy'],
});

export function newUnitForm(drawer: DrawerService, units: UnitDataSource, scheme: Scheme, router: Router): void {
  openForm(drawer, {
    eyebrow: scheme.name,
    title: 'Add a unit',
    intro: `Its levy account (${scheme.code}-…) is opened with it. Link the owner from People.`,
    fields: UNIT_FIELDS,
    initial: { occupancy: 'owner-occupied' },
    submitLabel: 'Add unit',
    submit: (v) => units.create(scheme.id, unitDetails(v)),
    success: (_id, v) => `Unit ${v['number']} added to ${scheme.name}.`,
    done: () => router.navigate(['/schemes', scheme.id, 'units']),
    failure: 'The unit wasn’t added',
  });
}

export function editUnitForm(drawer: DrawerService, units: UnitDataSource, unit: Unit, schemeName: string): void {
  openForm(drawer, {
    eyebrow: `${schemeName} · Unit ${unit.number}`,
    title: 'Edit unit',
    intro: 'The unit number can’t change: it’s part of the account number owners pay with.',
    fields: UNIT_FIELDS.filter((f) => f.key !== 'number'),
    initial: {
      number: unit.number, block: unit.block ?? '', description: unit.description, sizeM2: String(unit.sizeM2), participationQuota: String(unit.participationQuota),
      monthlyLevy: String(unit.monthlyLevy), occupancy: unit.occupancy,
    },
    submitLabel: 'Save unit',
    submit: (v) => units.update(unit.id, unitDetails(v), unit.version),
    success: () => `Unit ${unit.number} saved.`,
    failure: 'The unit wasn’t saved',
  });
}
