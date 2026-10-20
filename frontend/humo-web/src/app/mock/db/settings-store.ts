import { Injectable, inject } from '@angular/core';
import {
  AgencyDetails,
  AgencySettings,
  BillingSettings,
  DEFAULT_BILLING,
  DEFAULT_NOTIFICATION_RULES,
  FieldErrors,
  NOTIFICATION_EVENTS,
  NotificationRule,
  PersonalPreferences,
  TrustAccount,
} from '../../domain';
import { simulationStorage } from '../simulation/simulation-storage';
import { MockDb } from './mock-db';
import { OrganisationStore } from './organisation-store';

/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface SettingsSnapshot {
  agencies: AgencySettings[];
  preferences: PersonalPreferences[];
}

const DEFAULT_RULES: NotificationRule[] = DEFAULT_NOTIFICATION_RULES;

/** Acacia's own choices for the demo: SMS for payments and requests, WhatsApp for notices. */
const ACACIA_RULES: NotificationRule[] = DEFAULT_RULES.map((r) =>
  r.event === 'payment-received'
    ? { ...r, channels: ['sms', 'portal'] }
    : r.event === 'job-updated'
      ? { ...r, channels: ['sms', 'portal'] }
      : r.event === 'notice-published'
        ? { ...r, channels: ['email', 'whatsapp', 'portal'] }
        : r,
);

/**
 * Agency settings and personal preferences for the prototype. Billing,
 * credit control and compliance read their rules from here (interest rate,
 * step days, AGM deadline), so changing them changes what the next run,
 * letter or compliance item does.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly db = inject(MockDb);
  private readonly orgs = inject(OrganisationStore);

  private agencies: AgencySettings[];
  private preferences: PersonalPreferences[];

  constructor() {
    const saved = simulationStorage.load<SettingsSnapshot>('settings');
    this.agencies = saved?.agencies ?? [this.seedAcacia()];
    this.preferences = saved?.preferences ?? [];
  }

  // =================================================================== Reads

  agency(organisationId: string): AgencySettings {
    const found = this.agencies.find((a) => a.organisationId === organisationId);
    if (found) return found;
    const o = this.orgs.get(organisationId);
    return {
      organisationId,
      version: 0,
      details: { name: o?.name ?? '', shortName: o?.shortName ?? '', registrationNumber: '', address: '', city: o?.city ?? '', province: o?.province ?? '', email: '', phone: '' },
      billing: DEFAULT_BILLING,
      notifications: DEFAULT_RULES,
    };
  }

  billing(organisationId: string): BillingSettings {
    return { ...DEFAULT_BILLING, ...this.agency(organisationId).billing };
  }

  rule(organisationId: string, event: NotificationRule['event']): NotificationRule {
    return this.agency(organisationId).notifications.find((r) => r.event === event) ?? DEFAULT_RULES.find((r) => r.event === event)!;
  }

  preferencesOf(identityId: string): PersonalPreferences {
    return this.preferences.find((p) => p.identityId === identityId) ?? { identityId, version: 0, work: ['email', 'push'], digest: 'daily' };
  }

  // =================================================================== Validation

  checkDetails(d: AgencyDetails): FieldErrors | null {
    const e: FieldErrors = {};
    if (d.name.trim().length < 3) e['name'] = 'The registered name.';
    if (d.shortName.trim().length < 2) e['shortName'] = 'The name people know you by.';
    if (!/^\d{4}\/\d{6}\/\d{2}$/.test(d.registrationNumber.trim())) e['registrationNumber'] = 'A CIPC number like 2009/012345/07.';
    if (d.vatNumber && !/^4\d{9}$/.test(d.vatNumber.trim())) e['vatNumber'] = 'A VAT number is 10 digits starting with 4.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) e['email'] = 'An email address owners can reply to.';
    if (d.phone.replace(/\D/g, '').length < 10) e['phone'] = 'A phone number with area code.';
    return Object.keys(e).length ? e : null;
  }

  checkBilling(b: BillingSettings): FieldErrors | null {
    const e: FieldErrors = {};
    if (!(b.interestRate >= 0 && b.interestRate <= 5)) e['interestRate'] = 'Between 0% and 5% a month. Check the scheme rules and the law on interest.';
    if (!(b.billingDay >= 1 && b.billingDay <= 28)) e['billingDay'] = 'A day from 1 to 28.';
    if (!(b.dueDay >= 1 && b.dueDay <= 28)) e['dueDay'] = 'A day from 1 to 28.';
    if (!(b.stepDays >= 7 && b.stepDays <= 60)) e['stepDays'] = 'Between 7 and 60 days: owners need time to respond.';
    if (!(b.agmMonths >= 1 && b.agmMonths <= 6)) e['agmMonths'] = 'Between 1 and 6 months.';
    return Object.keys(e).length ? e : null;
  }

  checkRules(rules: NotificationRule[]): FieldErrors | null {
    for (const r of rules) {
      const def = NOTIFICATION_EVENTS.find((d) => d.id === r.event);
      if (!def) return { rules: 'Unknown notification.' };
      if (def.required && !r.enabled) return { [r.event]: `${def.label} can’t be switched off.` };
      if (r.enabled && !r.channels.length) return { [r.event]: `Choose at least one channel for ${def.label.toLowerCase()}, or switch it off.` };
      if (r.channels.some((c) => !def.channels.includes(c))) return { [r.event]: `${def.label} can’t go by that channel.` };
    }
    return null;
  }

  checkTrustAccount(a: TrustAccount): FieldErrors | null {
    const e: FieldErrors = {};
    if (a.bank.trim().length < 3) e['bank'] = 'Which bank?';
    if (a.accountName.trim().length < 5) e['accountName'] = 'The account name as the bank has it.';
    if (!/^\d{7,12}$/.test(a.accountNumber.replace(/\s/g, ''))) e['accountNumber'] = 'An account number of 7 to 12 digits.';
    if (!/^\d{6}$/.test(a.branchCode.replace(/\s/g, ''))) e['branchCode'] = 'A 6-digit branch code.';
    return Object.keys(e).length ? e : null;
  }

  // =================================================================== Commands

  updateDetails(organisationId: string, d: AgencyDetails): void {
    const a = this.mutable(organisationId);
    a.details = { ...d, name: d.name.trim(), shortName: d.shortName.trim(), vatNumber: d.vatNumber?.trim() || undefined, ffcNumber: d.ffcNumber?.trim() || undefined };
    a.version++;
    this.orgs.change(organisationId, (o) => ({ ...o, name: a.details.name, shortName: a.details.shortName, city: a.details.city, province: a.details.province }));
    this.commit();
  }

  updateBilling(organisationId: string, b: BillingSettings): void {
    const a = this.mutable(organisationId);
    a.billing = { ...b };
    a.version++;
    this.commit();
  }

  updateRules(organisationId: string, rules: NotificationRule[]): void {
    const a = this.mutable(organisationId);
    a.notifications = rules.map((r) => ({ ...r }));
    a.version++;
    this.commit();
  }

  updatePreferences(identityId: string, prefs: Omit<PersonalPreferences, 'identityId' | 'version'>): void {
    const current = this.preferencesOf(identityId);
    this.preferences = [...this.preferences.filter((p) => p.identityId !== identityId), { ...prefs, identityId, version: current.version + 1 }];
    this.commit();
  }

  private mutable(organisationId: string): AgencySettings {
    let a = this.agencies.find((x) => x.organisationId === organisationId);
    if (!a) {
      a = { ...this.agency(organisationId) };
      this.agencies.push(a);
    }
    return a;
  }

  private seedAcacia(): AgencySettings {
    return {
      organisationId: 'acacia',
      version: 1,
      details: {
        name: 'Acacia Managing Agents (Pty) Ltd',
        shortName: 'Acacia',
        registrationNumber: '2009/012345/07',
        vatNumber: '4120245678',
        ffcNumber: 'FFC 2026/045812',
        address: '14 Fricker Road, Illovo',
        city: 'Johannesburg',
        province: 'Gauteng',
        email: 'accounts@acacia-ma.example',
        phone: '011 555 0142',
      },
      billing: { ...DEFAULT_BILLING },
      notifications: ACACIA_RULES,
    };
  }

  private commit(): void {
    simulationStorage.save('settings', (): SettingsSnapshot => ({ agencies: this.agencies, preferences: this.preferences }));
    this.db.touch();
  }
}
