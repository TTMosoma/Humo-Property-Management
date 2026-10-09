import { Injectable, inject } from '@angular/core';
import { Channel, FieldErrors, NewNotice, Notice, NoticeView } from '../../domain';
import { simulationStorage } from '../simulation/simulation-storage';
import { MockDb } from './mock-db';
import { CommsStore } from './comms-store';
import { OpsStore } from './ops-store';
import { SettingsStore } from './settings-store';

/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface NoticeSnapshot {
  notices: Notice[];
  seq: number;
}

const DAY = 86_400_000;
const at = (days: number, hour = 9) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

/**
 * Notices for the prototype: published by staff to a scheme's residents,
 * owners or trustees; sent by the channels the agency's rules set for
 * new notices at the moment of publishing.
 */
@Injectable({ providedIn: 'root' })
export class NoticeStore {
  private readonly db = inject(MockDb);
  private readonly settings = inject(SettingsStore);
  private readonly ops = inject(OpsStore);
  private readonly comms = inject(CommsStore);

  notices: Notice[];
  private seq: number;

  constructor() {
    const saved = simulationStorage.load<NoticeSnapshot>('notices');
    this.notices = saved?.notices ?? this.seed();
    this.seq = saved?.seq ?? 100;
  }

  view(n: Notice): NoticeView {
    const now = Date.now();
    return { notice: n, scheme: this.db.scheme(n.schemeId), current: !n.withdrawn && (!n.expiresAt || new Date(n.expiresAt).getTime() > now) };
  }

  inScope(schemeIds: string[]): NoticeView[] {
    const ids = new Set(schemeIds);
    return this.notices.filter((n) => ids.has(n.schemeId)).map((n) => this.view(n)).sort(byPinnedThenNewest);
  }

  /** What a resident sees: current notices for their scheme and audience. */
  forResident(schemeId: string, role: 'owner' | 'tenant'): NoticeView[] {
    return this.notices
      .filter((n) => n.schemeId === schemeId && (n.audience === 'residents' || (n.audience === 'owners' && role === 'owner')))
      .map((n) => this.view(n))
      .filter((v) => v.current)
      .sort(byPinnedThenNewest);
  }

  /** How many people a notice reaches: every unit's owner, plus tenants of let units, or the trustees. */
  recipients(schemeId: string, audience: Notice['audience']): number {
    const units = this.db.units.filter((u) => u.schemeId === schemeId);
    if (audience === 'trustees') return this.db.trustees(schemeId).length;
    return units.length + (audience === 'residents' ? units.filter((u) => u.occupancy === 'tenanted').length : 0);
  }

  check(input: NewNotice): FieldErrors | null {
    const e: FieldErrors = {};
    if (!this.db.schemes.has(input.schemeId)) e['schemeId'] = 'Choose a scheme.';
    if (input.title.trim().length < 5) e['title'] = 'A short headline people will understand at a glance.';
    if (input.body.trim().length < 20) e['body'] = 'Say what’s happening, when, and what people should do.';
    if (input.expiresAt && new Date(input.expiresAt).getTime() < Date.now()) e['expiresAt'] = 'The end date has already passed.';
    return Object.keys(e).length ? e : null;
  }

  publish(input: NewNotice, by: string): string {
    const scheme = this.db.scheme(input.schemeId);
    const rule = this.settings.rule(scheme.organisationId, 'notice-published');
    const id = `ntc-${++this.seq}`;
    const n = Math.max(0, ...this.notices.filter((x) => x.schemeId === scheme.id).map((x) => Number(x.ref.split('-').at(-1)) || 0)) + 1;
    this.notices = [
      {
        id,
        version: 1,
        ref: `NTC-${scheme.code}-${n}`,
        schemeId: scheme.id,
        title: input.title.trim(),
        body: input.body.trim(),
        audience: input.audience,
        category: input.category,
        publishedAt: new Date().toISOString(),
        publishedBy: by,
        pinned: input.pinned,
        expiresAt: input.expiresAt ? new Date(`${input.expiresAt.slice(0, 10)}T23:59:00`).toISOString() : undefined,
        // A channel switched off by Humo's kill switch is skipped; the others still go.
        sentBy: (rule.enabled ? rule.channels : (['portal'] as Channel[])).filter((c) => c !== 'whatsapp' || this.ops.isOn('channels.whatsapp', scheme.organisationId)),
        recipients: this.recipients(scheme.id, input.audience),
      },
      ...this.notices,
    ];
    const n0 = this.notices[0];
    this.comms.record({
      kind: 'notice',
      schemeId: scheme.id,
      subject: n0.title,
      body: n0.body,
      channels: n0.sentBy,
      audienceLabel: this.comms.audienceLabel({ schemeId: scheme.id, kind: n0.audience === 'residents' ? 'residents' : n0.audience === 'owners' ? 'owners' : 'trustees' }),
      by,
      to: this.comms.addressees({ schemeId: scheme.id, kind: n0.audience === 'residents' ? 'residents' : n0.audience === 'owners' ? 'owners' : 'trustees' }),
      source: { label: `Notice ${n0.ref}`, route: '/communications/notices' },
    });
    this.commit();
    return id;
  }

  act(id: string, action: { type: 'pin' | 'unpin' } | { type: 'withdraw'; reason: string }, by: string): void {
    const n = this.notices.find((x) => x.id === id)!;
    if (action.type === 'withdraw') n.withdrawn = { at: new Date().toISOString(), by, reason: action.reason.trim() };
    else n.pinned = action.type === 'pin';
    n.version++;
    this.commit();
  }

  private seed(): Notice[] {
    const mk = (n: Partial<Notice> & Pick<Notice, 'id' | 'ref' | 'schemeId' | 'title' | 'body' | 'audience' | 'category' | 'publishedAt' | 'publishedBy'>): Notice => ({
      version: 1,
      pinned: false,
      sentBy: ['email', 'whatsapp', 'portal'],
      recipients: this.recipients(n.schemeId, n.audience),
      ...n,
    });
    return [
      mk({ id: 'ntc-001', ref: 'NTC-KC-9', schemeId: 'kingfisher-court', category: 'maintenance', audience: 'residents', pinned: true, publishedAt: at(-1, 15), publishedBy: 'Johan van der Merwe', expiresAt: at(2, 23), title: 'Water off on Thursday, 09:00–13:00', body: 'The plumber is replacing the main valve on Block A’s riser. Water will be off in all units from 09:00 to 13:00 on Thursday. Please keep some water aside, and switch your geyser off until the water is back on.' }),
      mk({ id: 'ntc-002', ref: 'NTC-KC-8', schemeId: 'kingfisher-court', category: 'rules', audience: 'owners', publishedAt: at(-6, 10), publishedBy: 'Johan van der Merwe', title: 'Revised pet rule from 1 November', body: 'The trustees revised the pet rule at their September meeting: one dog or two cats per unit with written consent from the trustees. Owners with tenants: please share this with them. Apply for consent through the managing agent.' }),
      mk({ id: 'ntc-003', ref: 'NTC-KC-7', schemeId: 'kingfisher-court', category: 'security', audience: 'residents', publishedAt: at(-12, 9), publishedBy: 'Thandeka Mokoena', title: 'New gate remotes', body: 'The gate motor has been replaced and old remotes no longer work. Collect new remotes from the guardhouse between 08:00 and 17:00 on weekdays; bring your ID. The first two per unit are free.' }),
      mk({ id: 'ntc-004', ref: 'NTC-TW-5', schemeId: 'the-willows', category: 'maintenance', audience: 'residents', pinned: true, publishedAt: at(-3, 11), publishedBy: 'Johan van der Merwe', expiresAt: at(10, 23), title: 'Pool closed for repairs', body: 'The pool pump has failed and the pool is closed until the new pump is installed, expected next week. We’ll post again when it reopens.' }),
      mk({ id: 'ntc-005', ref: 'NTC-RT-3', schemeId: 'rosebank-terraces', category: 'maintenance', audience: 'residents', publishedAt: at(-2, 14), publishedBy: 'Johan van der Merwe', title: 'Lift out of service', body: 'Lift 2 is out of service while Liftco replaces its motor. Lift 1 is working. We expect Lift 2 back in service within ten working days.' }),
      mk({ id: 'ntc-006', ref: 'NTC-KC-6', schemeId: 'kingfisher-court', category: 'finance', audience: 'owners', publishedAt: at(-40, 10), publishedBy: 'Priya Naidoo', expiresAt: at(-10, 23), title: 'Special levy instalment 3 of 6', body: 'A reminder that the third instalment of the roof waterproofing special levy is on your September statement.' }),
    ];
  }

  private commit(): void {
    simulationStorage.save('notices', (): NoticeSnapshot => ({ notices: this.notices, seq: this.seq }));
    this.db.touch();
  }
}

function byPinnedThenNewest(a: NoticeView, b: NoticeView): number {
  return Number(b.current && b.notice.pinned) - Number(a.current && a.notice.pinned) || b.notice.publishedAt.localeCompare(a.notice.publishedAt);
}
