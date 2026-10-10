import { Injectable, inject } from '@angular/core';
import {
  AUDIENCE_LABELS,
  Audience,
  Channel,
  ComposeInput,
  ComposePreview,
  Delivery,
  DeliveryStatus,
  FieldErrors,
  MessageTemplate,
  Person,
  SentKind,
  SentMessage,
  SentView,
  SkippedRecipient,
  TemplateInput,
  UnitSummary,
  daysInArrears,
  overdueOf,
} from '../../domain';
import { formatRand } from '../../ui/format/money';
import { simulationStorage } from '../simulation/simulation-storage';
import { MockDb } from './mock-db';
import { OpsStore } from './ops-store';
import { seeded } from './random';
import { SettingsStore } from './settings-store';

/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface CommsSnapshot {
  templates: MessageTemplate[];
  sent: SentMessage[];
  seq: number;
}

const DAY = 86_400_000;
const CHANNEL_NAME: Record<Channel, string> = { email: 'email', sms: 'SMS', whatsapp: 'WhatsApp', portal: 'the portal', push: 'Humo Mobile' };

export interface Addressee {
  person: Person;
  unit?: UnitSummary;
  /** Force a channel (e.g. a letter sent by post-equivalent email); otherwise the person's preference among `channels`. */
  channel?: Channel;
}

/**
 * Communications "backend" for the prototype. Works out who an audience
 * reaches and by which channel (each person's preference among the chosen
 * channels, if they can receive it), fills in merge fields per person, and
 * keeps one Sent record for everything — composed messages, and what other
 * modules send (notices, letters, statements, reminders, inbox replies).
 *
 * Nothing is really delivered: delivery results are simulated, deterministically.
 */
@Injectable({ providedIn: 'root' })
export class CommsStore {
  private readonly db = inject(MockDb);
  private readonly settings = inject(SettingsStore);
  private readonly ops = inject(OpsStore);

  templates: MessageTemplate[];
  sent: SentMessage[];
  private seq: number;

  constructor() {
    const saved = simulationStorage.load<CommsSnapshot>('comms');
    this.templates = saved?.templates ?? seedTemplates();
    this.sent = saved?.sent ?? [];
    this.seq = saved?.seq ?? 2000;
    if (!saved) this.seedHistory();
  }

  // =================================================================== Audiences

  /** The people an audience covers, for modules that record what they send. */
  addressees(a: Audience): Addressee[] {
    return this.people(a);
  }

  /** An account's holder, with their unit, for letters and statements. */
  holderOf(accountId: string): Addressee | undefined {
    const a = this.db.accounts.get(accountId);
    if (!a) return undefined;
    const unit = this.db.unitsIn([a.schemeId]).find((u) => u.unit.id === a.unitId);
    const person = this.db.persons.get(a.holderPersonId);
    return person ? { person, unit } : undefined;
  }

  private people(a: Audience): Addressee[] {
    const units = this.db.unitsIn([a.schemeId]);
    const out: Addressee[] = [];
    const add = (person: Person | undefined, unit?: UnitSummary) => {
      if (person && !out.some((x) => x.person.id === person.id && x.unit?.unit.id === unit?.unit.id)) out.push({ person, unit });
    };
    switch (a.kind) {
      case 'owners':
        units.forEach((u) => u.owners.forEach((p) => add(p, u)));
        break;
      case 'residents':
        units.forEach((u) => {
          u.owners.forEach((p) => add(p, u));
          add(u.tenant, u);
        });
        break;
      case 'tenants':
        units.forEach((u) => add(u.tenant, u));
        break;
      case 'trustees':
        this.db.trustees(a.schemeId).forEach((t) => add(t.person));
        break;
      case 'arrears':
        units.filter((u) => overdueOf(u.account.ageing) > 0 && daysInArrears(u.account.ageing) >= (a.minDays ?? 30)).forEach((u) => u.owners.forEach((p) => add(p, u)));
        break;
      case 'units':
        units.filter((u) => a.unitIds?.includes(u.unit.id)).forEach((u) => {
          u.owners.forEach((p) => add(p, u));
          if (a.includeTenants) add(u.tenant, u);
        });
        break;
    }
    return out;
  }

  audienceLabel(a: Audience): string {
    const scheme = this.db.schemes.get(a.schemeId)?.name ?? a.schemeId;
    const what = a.kind === 'arrears' ? `Owners ${a.minDays ?? 30}+ days in arrears` : a.kind === 'units' ? `${a.unitIds?.length ?? 0} chosen unit${a.unitIds?.length === 1 ? '' : 's'}` : AUDIENCE_LABELS[a.kind];
    return `${what} · ${scheme}`;
  }

  /** Which channel reaches this person: their preference if chosen, else the first chosen channel they can receive. */
  private channelFor(p: Person, channels: Channel[], organisationId: string): Channel | string {
    const whatsappOn = this.ops.isOn('channels.whatsapp', organisationId);
    const can = (c: Channel) => (c === 'email' ? !!p.email : c === 'sms' ? !!p.phone : c === 'whatsapp' ? !!p.phone && whatsappOn : c === 'portal' ? !!p.personaId : false);
    if (channels.includes(p.preferredChannel) && can(p.preferredChannel)) return p.preferredChannel;
    const found = channels.find(can);
    if (found) return found;
    if (channels.length === 1 && channels[0] === 'whatsapp' && !whatsappOn) return 'WhatsApp is switched off by Humo for now';
    return `Can’t be reached by ${channels.map((c) => CHANNEL_NAME[c]).join(' or ')}`;
  }

  private values(x: Addressee, organisationId: string): Record<string, string> {
    const agency = this.settings.agency(organisationId).details;
    const v: Record<string, string> = {
      'person.name': x.person.displayName,
      'person.firstName': x.person.kind === 'individual' ? x.person.firstName : x.person.displayName,
      'scheme.name': x.unit?.scheme.name ?? '',
      'agency.name': agency.shortName,
      'agency.phone': agency.phone,
    };
    if (x.unit) {
      v['unit.number'] = x.unit.unit.number;
      v['scheme.name'] = x.unit.scheme.name;
      v['account.number'] = x.unit.account.accountNo;
      v['account.balance'] = formatRand(Math.max(0, x.unit.account.balance));
      v['account.overdue'] = formatRand(overdueOf(x.unit.account.ageing));
    }
    return v;
  }

  private address(p: Person, c: Channel): string {
    return c === 'email' ? p.email : c === 'portal' ? 'Resident portal' : p.phone;
  }

  preview(a: Audience, channels: Channel[]): ComposePreview {
    const org = this.db.scheme(a.schemeId).organisationId;
    const recipients: ComposePreview['recipients'] = [];
    const skipped: SkippedRecipient[] = [];
    for (const x of this.people(a)) {
      const unitLabel = x.unit ? `Unit ${x.unit.unit.number}` : undefined;
      const c = this.channelFor(x.person, channels, org);
      if (isChannel(c)) recipients.push({ personId: x.person.id, name: x.person.displayName, unitLabel, channel: c, address: this.address(x.person, c), values: this.values({ ...x, unit: x.unit ?? undefined }, org) });
      else skipped.push({ personId: x.person.id, name: x.person.displayName, unitLabel, reason: c });
    }
    const byChannel: ComposePreview['byChannel'] = {};
    for (const r of recipients) byChannel[r.channel] = (byChannel[r.channel] ?? 0) + 1;
    return { audienceLabel: this.audienceLabel(a), recipients, skipped, byChannel };
  }

  // =================================================================== Sending

  checkSend(input: ComposeInput): FieldErrors | null {
    const e: FieldErrors = {};
    if (!this.db.schemes.has(input.audience.schemeId)) e['schemeId'] = 'Choose a scheme.';
    if (input.audience.kind === 'units' && !input.audience.unitIds?.length) e['units'] = 'Choose at least one unit.';
    if (!input.channels.length) e['channels'] = 'Choose at least one channel.';
    if (input.channels.includes('email') && input.subject.trim().length < 3) e['subject'] = 'Emails need a subject.';
    if (input.body.trim().length < 10) e['body'] = 'Write the message.';
    if (input.channels.length === 1 && input.channels[0] === 'sms' && input.body.length > 480) e['body'] = 'Too long for SMS: keep it under 480 characters (3 messages).';
    const unknown = input.body.match(/\{([a-z]+\.[a-zA-Z]+)\}/g)?.filter((m) => !['person.name', 'person.firstName', 'unit.number', 'scheme.name', 'account.number', 'account.balance', 'account.overdue', 'agency.name', 'agency.phone'].includes(m.slice(1, -1)));
    if (unknown?.length) e['body'] = `Unknown field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`;
    if (input.sendAt && new Date(input.sendAt).getTime() < Date.now() - 60_000) e['sendAt'] = 'That time has passed: send now instead.';
    if (!e['schemeId'] && !this.preview(input.audience, input.channels).recipients.length) e['audience'] = 'Nobody in this audience can be reached by the chosen channels.';
    return Object.keys(e).length ? e : null;
  }

  compose(input: ComposeInput, by: string): string {
    const p = this.preview(input.audience, input.channels);
    return this.store({
      kind: 'message',
      schemeId: input.audience.schemeId,
      subject: input.subject.trim(),
      body: input.body.trim(),
      templateId: input.templateId,
      channels: input.channels,
      audienceLabel: p.audienceLabel,
      sentBy: by,
      sendAt: input.sendAt,
      recipients: p.recipients,
      skipped: p.skipped,
    });
  }

  /** Other modules record what they send here, so Sent is complete. */
  record(input: { kind: SentKind; schemeId: string; subject: string; body: string; channels: Channel[]; audienceLabel: string; by: string; to: Addressee[]; source?: SentMessage['source']; at?: string }): string {
    const org = this.db.scheme(input.schemeId).organisationId;
    const recipients: ComposePreview['recipients'] = [];
    const skipped: SkippedRecipient[] = [];
    for (const x of input.to) {
      const unitLabel = x.unit ? `Unit ${x.unit.unit.number}` : undefined;
      const c = x.channel ?? this.channelFor(x.person, input.channels, org);
      if (isChannel(c)) recipients.push({ personId: x.person.id, name: x.person.displayName, unitLabel, channel: c, address: this.address(x.person, c), values: this.values(x, org) });
      else skipped.push({ personId: x.person.id, name: x.person.displayName, unitLabel, reason: c });
    }
    return this.store({ ...input, sentBy: input.by, recipients, skipped, createdAt: input.at });
  }

  private store(m: { kind: SentKind; schemeId: string; subject: string; body: string; templateId?: string; channels: Channel[]; audienceLabel: string; sentBy: string; sendAt?: string; recipients: ComposePreview['recipients']; skipped: SkippedRecipient[]; source?: SentMessage['source']; createdAt?: string }): string {
    const createdAt = m.createdAt ?? new Date().toISOString();
    const sendAt = m.sendAt ?? createdAt;
    const scheduled = new Date(sendAt).getTime() > Date.now() + 30_000;
    const id = `msg-${++this.seq}`;
    const deliveries: Delivery[] = m.recipients.map((r, i) => ({
      id: `${id}-${i}`,
      personId: r.personId,
      name: r.name,
      unitLabel: r.unitLabel,
      channel: r.channel,
      address: r.address,
      values: r.values,
      ...(scheduled ? { status: 'scheduled' as const, at: sendAt } : outcome(`${id}:${r.personId}:${r.channel}`, r.channel, sendAt)),
    }));
    this.sent = [
      { id, version: 1, ref: `MSG-${this.seq}`, kind: m.kind, schemeId: m.schemeId, subject: m.subject, body: m.body, templateId: m.templateId, channels: m.channels, audienceLabel: m.audienceLabel, createdAt, sentBy: m.sentBy, sendAt, deliveries, skipped: m.skipped, source: m.source },
      ...this.sent,
    ];
    this.commit();
    return id;
  }

  // =================================================================== Reads

  view(m: SentMessage): SentView {
    // A scheduled message whose time has come goes out (the API's scheduler does this).
    if (!m.cancelled && m.deliveries.some((d) => d.status === 'scheduled') && new Date(m.sendAt).getTime() <= Date.now()) {
      m.deliveries = m.deliveries.map((d) => ({ ...d, ...outcome(`${d.id}:${d.channel}`, d.channel, m.sendAt) }));
      this.save();
    }
    const counts = { scheduled: 0, queued: 0, delivered: 0, read: 0, failed: 0, bounced: 0 } as Record<DeliveryStatus, number>;
    for (const d of m.deliveries) counts[d.status]++;
    const state = m.cancelled ? 'cancelled' : counts.scheduled ? 'scheduled' : counts.queued ? 'sending' : 'sent';
    return { message: m, scheme: this.db.scheme(m.schemeId), counts, state };
  }

  inScope(schemeIds: string[]): SentView[] {
    const ids = new Set(schemeIds);
    return this.sent.filter((m) => ids.has(m.schemeId)).map((m) => this.view(m)).sort((a, b) => b.message.sendAt.localeCompare(a.message.sendAt));
  }

  get(id: string): SentView | undefined {
    const m = this.sent.find((x) => x.id === id || x.ref === id);
    return m && this.view(m);
  }

  retry(id: string): void {
    const m = this.sent.find((x) => x.id === id)!;
    const now = new Date().toISOString();
    m.deliveries = m.deliveries.map((d) => (d.status === 'failed' || d.status === 'bounced' ? { ...d, status: d.channel === 'email' && d.status === 'bounced' ? 'bounced' : 'delivered', at: now, error: d.status === 'bounced' && d.channel === 'email' ? 'The address bounced again: update the person’s email.' : undefined } : d));
    m.version++;
    this.commit();
  }

  cancel(id: string, by: string): void {
    const m = this.sent.find((x) => x.id === id)!;
    m.cancelled = { at: new Date().toISOString(), by };
    m.version++;
    this.commit();
  }

  // =================================================================== Templates

  checkTemplate(t: TemplateInput, id?: string): FieldErrors | null {
    const e: FieldErrors = {};
    if (t.name.trim().length < 3) e['name'] = 'Give it a name your team will recognise.';
    if (this.templates.some((x) => x.id !== id && !x.archived && x.name.trim().toLowerCase() === t.name.trim().toLowerCase())) e['name'] = 'There’s already a template with that name.';
    if (!t.channels.length) e['channels'] = 'Which channels is it written for?';
    if (t.channels.includes('email') && t.subject.trim().length < 3) e['subject'] = 'Email templates need a subject.';
    if (t.body.trim().length < 10) e['body'] = 'Write the message.';
    if (t.channels.includes('sms') && t.body.length > 480) e['body'] = 'Too long for SMS (480 characters at most).';
    return Object.keys(e).length ? e : null;
  }

  saveTemplate(t: TemplateInput, by: string, id?: string): string {
    const now = new Date().toISOString();
    if (id) {
      const x = this.templates.find((y) => y.id === id)!;
      Object.assign(x, { ...t, name: t.name.trim(), subject: t.subject.trim(), body: t.body.trim(), updatedAt: now, updatedBy: by, version: x.version + 1 });
    } else {
      id = `tpl-${++this.seq}`;
      this.templates = [...this.templates, { id, version: 1, ...t, name: t.name.trim(), subject: t.subject.trim(), body: t.body.trim(), builtIn: false, updatedAt: now, updatedBy: by }];
    }
    this.commit();
    return id;
  }

  archiveTemplate(id: string): void {
    const x = this.templates.find((y) => y.id === id)!;
    x.archived = true;
    x.version++;
    this.commit();
  }

  // =================================================================== Seed

  private seedHistory(): void {
    const kc = 'kingfisher-court';
    const t = (id: string) => this.templates.find((x) => x.id === id)!;
    const ago = (d: number, h = 9) => new Date(Date.now() - d * DAY + (h - 9) * 3_600_000).toISOString();
    const owners = this.people({ schemeId: kc, kind: 'owners' });
    const residents = this.people({ schemeId: kc, kind: 'residents' });
    this.record({ kind: 'message', schemeId: kc, subject: t('tpl-agm').subject, body: t('tpl-agm').body, channels: ['email', 'portal'], audienceLabel: this.audienceLabel({ schemeId: kc, kind: 'owners' }), by: 'Johan van der Merwe', to: owners, at: ago(20) });
    this.record({ kind: 'notice', schemeId: kc, subject: 'Water off on Thursday, 09:00–13:00', body: 'The plumber is replacing the main valve on Block A’s riser. Water will be off in all units from 09:00 to 13:00 on Thursday.', channels: ['email', 'whatsapp', 'portal'], audienceLabel: this.audienceLabel({ schemeId: kc, kind: 'residents' }), by: 'Johan van der Merwe', to: residents, source: { label: 'Notice NTC-KC-9', route: '/communications/notices' }, at: ago(1, 15) });
    const arrears = this.people({ schemeId: kc, kind: 'arrears', minDays: 30 }).slice(0, 12);
    this.record({ kind: 'reminder', schemeId: kc, subject: t('tpl-reminder').subject, body: t('tpl-reminder').body, channels: ['sms', 'email'], audienceLabel: this.audienceLabel({ schemeId: kc, kind: 'arrears', minDays: 30 }), by: 'Zanele Dlamini', to: arrears, source: { label: 'Credit control', route: '/finance/credit-control' }, at: ago(6, 10) });
  }

  private save(): void {
    simulationStorage.save('comms', (): CommsSnapshot => ({ templates: this.templates, sent: this.sent, seq: this.seq }));
  }

  private commit(): void {
    this.save();
    this.db.touch();
  }
}

function isChannel(c: string): c is Channel {
  return ['email', 'sms', 'whatsapp', 'portal', 'push'].includes(c);
}

/** A simulated, repeatable delivery result: most arrive, a few bounce or fail. */
function outcome(key: string, channel: Channel, at: string): { status: DeliveryStatus; at: string; error?: string } {
  const r = seeded(key)();
  const later = (min: number) => new Date(new Date(at).getTime() + min * 60_000).toISOString();
  if (channel === 'email' && r < 0.03) return { status: 'bounced', at: later(1), error: 'Mailbox not found' };
  if (channel === 'sms' && r < 0.03) return { status: 'failed', at: later(2), error: 'Number not reachable' };
  if ((channel === 'portal' || channel === 'whatsapp') && r > 0.55) return { status: 'read', at: later(30 + Math.round(r * 300)) };
  return { status: 'delivered', at: later(1) };
}

function seedTemplates(): MessageTemplate[] {
  const at = new Date(Date.now() - 90 * DAY).toISOString();
  const t = (id: string, name: string, category: MessageTemplate['category'], channels: Channel[], subject: string, body: string): MessageTemplate => ({ id, version: 1, name, category, subject, body, channels, builtIn: true, updatedAt: at, updatedBy: 'Humo PM' });
  return [
    t('tpl-reminder', 'Levy reminder', 'collections', ['sms', 'email'], 'Your levy account {account.number}', 'Hi {person.firstName}, a friendly reminder that {account.overdue} is overdue on your levy account for unit {unit.number}, {scheme.name}. Please pay using reference {account.number}, or call {agency.name} on {agency.phone} to arrange.'),
    t('tpl-statement', 'Statement covering note', 'levies', ['email'], 'Your {scheme.name} levy statement', 'Dear {person.name},\n\nYour levy statement for unit {unit.number} is attached and in the resident portal. The balance owing is {account.balance}.\n\nKind regards,\n{agency.name}'),
    t('tpl-water', 'Water outage', 'maintenance', ['sms', 'whatsapp', 'email', 'portal'], 'Water off at {scheme.name}', 'Hi {person.firstName}, the water at {scheme.name} will be off on [day] from [time] to [time] for [reason]. Please keep some water aside. – {agency.name}'),
    t('tpl-agm', 'AGM date announcement', 'meetings', ['email', 'portal'], '{scheme.name}: AGM date', 'Dear {person.name},\n\nThe annual general meeting of {scheme.name} will be held on [date] at [venue]. The formal notice, agenda and proxy form follow at least 14 days before.\n\nKind regards,\n{agency.name}'),
    t('tpl-request', 'Request update', 'maintenance', ['sms', 'whatsapp', 'portal'], 'Update on your request', 'Hi {person.firstName}, an update on the problem you reported at unit {unit.number}: [update]. – {agency.name}'),
    t('tpl-welcome', 'Welcome to the portal', 'general', ['email'], 'Welcome to {scheme.name} on Humo Property Management', 'Dear {person.name},\n\nYou can now see your levy account, statements, notices and requests for unit {unit.number} in the resident portal.\n\nKind regards,\n{agency.name}'),
  ];
}
