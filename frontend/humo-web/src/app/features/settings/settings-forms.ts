import { AgencySettings, BillingSettings, ComplianceProfile, Scheme, SchemeTrustAccount, SettingsDataSource } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { PROVINCE_OPTIONS, openForm } from '../shared/form-drawer';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function agencyDetailsForm(drawer: DrawerService, data: SettingsDataSource, a: AgencySettings): void {
  const d = a.details;
  openForm(drawer, {
    eyebrow: 'Agency',
    title: 'Agency details',
    intro: 'Your registered details. The name and address appear on statements and letters; the PPRA Fidelity Fund certificate number shows that you may hold owners’ money in trust.',
    fields: [
      { key: 'name', label: 'Registered name', type: 'text', required: true },
      { key: 'shortName', label: 'Trading name', type: 'text', required: true, half: true },
      { key: 'registrationNumber', label: 'Company registration', type: 'text', required: true, half: true, placeholder: '2009/012345/07' },
      { key: 'vatNumber', label: 'VAT number', type: 'text', half: true },
      { key: 'ffcNumber', label: 'Fidelity Fund certificate', type: 'text', half: true },
      { key: 'address', label: 'Street address', type: 'text', required: true },
      { key: 'city', label: 'City', type: 'text', required: true, half: true },
      { key: 'province', label: 'Province', type: 'select', required: true, half: true, options: PROVINCE_OPTIONS },
      { key: 'email', label: 'Email', type: 'email', required: true, half: true },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, half: true },
    ],
    initial: { ...d, vatNumber: d.vatNumber ?? '', ffcNumber: d.ffcNumber ?? '' },
    submitLabel: 'Save',
    submit: (v) =>
      data.updateDetails(
        { name: v['name'], shortName: v['shortName'], registrationNumber: v['registrationNumber'], vatNumber: v['vatNumber'], ffcNumber: v['ffcNumber'], address: v['address'], city: v['city'], province: v['province'], email: v['email'], phone: v['phone'] },
        a.version,
      ),
    success: () => 'Agency details saved.',
    failure: 'The details weren’t saved',
  });
}

/** Owners pay into this account: a fresh step-up, and it starts unverified until the bank's letter is on file. */
export function trustAccountForm(drawer: DrawerService, data: SettingsDataSource, t: SchemeTrustAccount): void {
  openForm(drawer, {
    eyebrow: t.scheme.name,
    title: 'Change trust account',
    intro: 'Statements and letters tell owners to pay into this account, so changing it needs your passkey or Humo Mobile. Upload the bank’s confirmation letter on the scheme afterwards.',
    fields: [
      { key: 'bank', label: 'Bank', type: 'text', required: true, half: true },
      { key: 'branchCode', label: 'Branch code', type: 'text', required: true, half: true },
      { key: 'accountName', label: 'Account name', type: 'text', required: true },
      { key: 'accountNumber', label: 'Account number', type: 'text', required: true },
    ],
    initial: { ...t.account },
    submitLabel: 'Change account',
    stepUp: { action: 'change-bank-details', detail: `Change the trust account owners of ${t.scheme.name} pay into` },
    submit: (v) => data.updateTrustAccount(t.scheme.id, { bank: v['bank'], branchCode: v['branchCode'], accountName: v['accountName'], accountNumber: v['accountNumber'] }),
    success: () => 'Trust account changed. Upload the bank’s confirmation letter to verify it.',
    failure: 'The account wasn’t changed',
  });
}

export function billingSettingsForm(drawer: DrawerService, data: SettingsDataSource, a: AgencySettings): void {
  const b = a.billing;
  openForm(drawer, {
    eyebrow: 'Billing configuration',
    title: 'Billing and collection rules',
    intro: 'These apply to every scheme from the next billing run, letter or compliance check. Runs already prepared keep the rules they were prepared with.',
    fields: [
      { key: 'interestRate', label: 'Interest on arrears (% per month)', type: 'number', required: true, half: true, help: 'Check each scheme’s rules: some set their own rate.' },
      { key: 'billingDay', label: 'Prepare runs on day', type: 'number', required: true, half: true, help: 'Next month’s runs are prepared on this day.' },
      { key: 'dueDay', label: 'Levies due by day', type: 'number', required: true, half: true },
      { key: 'stepDays', label: 'Days between collection letters', type: 'number', required: true, half: true },
      { key: 'agmMonths', label: 'AGM within (months of year-end)', type: 'number', required: true, half: true },
    ],
    initial: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, String(v)])),
    submitLabel: 'Save rules',
    submit: (v) =>
      data.updateBilling(
        { interestRate: Number(v['interestRate']), billingDay: Number(v['billingDay']), dueDay: Number(v['dueDay']), stepDays: Number(v['stepDays']), agmMonths: Number(v['agmMonths']) } satisfies BillingSettings,
        a.version,
      ),
    success: () => 'Rules saved.',
    failure: 'The rules weren’t saved',
  });
}

export function complianceProfileForm(drawer: DrawerService, data: SettingsDataSource, scheme: Scheme, profile: ComplianceProfile): void {
  openForm(drawer, {
    eyebrow: scheme.name,
    title: 'Financial year and lifts',
    intro: 'The financial year-end sets when the AGM, audited statements and CSOS return are due. Lifts add the lift inspection to Compliance.',
    fields: [
      { key: 'financialYearEnd', label: 'Financial year ends in', type: 'select', required: true, options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })) },
      { key: 'hasLifts', label: 'Lifts', type: 'select', required: true, options: [{ value: 'no', label: 'No lifts' }, { value: 'yes', label: 'Has lifts' }] },
    ],
    initial: { financialYearEnd: String(profile.financialYearEnd), hasLifts: profile.hasLifts ? 'yes' : 'no' },
    submitLabel: 'Save',
    submit: (v) => data.updateComplianceProfile({ schemeId: scheme.id, financialYearEnd: Number(v['financialYearEnd']), hasLifts: v['hasLifts'] === 'yes' }),
    success: () => 'Saved. Compliance has been worked out again.',
    failure: 'It wasn’t saved',
  });
}
