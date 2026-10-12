import { ORGANISATION_STATUS_LABELS, Organisation, OrganisationDataSource, OrganisationStatus } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { FormField, PROVINCE_OPTIONS, REASON_FIELD, openForm } from '../shared/form-drawer';

const DETAILS: FormField[] = [
  { key: 'name', label: 'Registered name', type: 'text', required: true, placeholder: 'Mabena Property Group (Pty) Ltd' },
  { key: 'shortName', label: 'Name people use', type: 'text', required: true, placeholder: 'Mabena Property', help: 'Shown in the app, on statements and in the support view.' },
  { key: 'city', label: 'City', type: 'text', required: true, half: true },
  { key: 'province', label: 'Province', type: 'select', required: true, half: true, options: PROVINCE_OPTIONS },
];

export function editOrganisationForm(drawer: DrawerService, data: OrganisationDataSource, org: Organisation): void {
  openForm(drawer, {
    eyebrow: org.shortName,
    title: 'Edit organisation details',
    fields: DETAILS,
    initial: { name: org.name, shortName: org.shortName, city: org.city, province: org.province },
    submitLabel: 'Save details',
    submit: (v) => data.update(org.id, { name: v['name'], shortName: v['shortName'], city: v['city'], province: v['province'] }, org.version),
    success: () => 'Organisation details saved.',
    failure: 'The details weren’t saved',
  });
}

const STATUS_COPY: Record<OrganisationStatus, { title: string; intro: string; button: string; done: string }> = {
  active: { title: 'Activate', intro: 'Everyone with a role here can sign in and work again.', button: 'Activate', done: 'is active' },
  suspended: {
    title: 'Suspend',
    intro: 'Access is paused for everyone in this organisation: nobody can sign in to work here until it’s reactivated. Data, roles and the subscription stay as they are.',
    button: 'Verify and suspend',
    done: 'is suspended',
  },
  archived: {
    title: 'Archive',
    intro: 'The customer has left. Nobody can sign in to work here; records are kept for the retention period and the organisation can be restored.',
    button: 'Verify and archive',
    done: 'is archived',
  },
  onboarding: { title: 'Back to onboarding', intro: '', button: 'Save', done: 'is onboarding' },
};

/** Lifecycle changes: suspend, reactivate, archive, restore. */
export function organisationStatusForm(drawer: DrawerService, data: OrganisationDataSource, org: Organisation, status: OrganisationStatus): void {
  const copy = STATUS_COPY[status];
  const restoring = org.status === 'archived' && status === 'active';
  openForm(drawer, {
    eyebrow: `${org.shortName} · ${ORGANISATION_STATUS_LABELS[org.status]}`,
    title: restoring ? 'Restore organisation' : `${copy.title} ${org.shortName}`,
    intro: restoring ? 'Brings the organisation back: everyone with a role here can sign in again.' : copy.intro,
    fields: [REASON_FIELD],
    submitLabel: restoring ? 'Restore' : copy.button,
    stepUp: status === 'suspended' || status === 'archived' ? { action: 'change-customer-status', detail: `${copy.title} ${org.shortName}` } : undefined,
    submit: (v) => data.setStatus(org.id, status, v['reason'], org.version),
    success: () => `${org.shortName} ${restoring ? 'is restored' : copy.done}.`,
    failure: 'The organisation wasn’t changed',
  });
}
