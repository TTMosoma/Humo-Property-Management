import { Injectable, inject } from '@angular/core';
import { Channel, Conversation, ConversationAction, ConversationView, FieldErrors, Person, ResidentMessage, WorkItem } from '../../domain';
import { personName, portfolioManagerOf } from '../fixtures/staff';
import { simulationStorage } from '../simulation/simulation-storage';
import { CommsStore } from './comms-store';
import { MaintenanceStore } from './maintenance-store';
import { MockDb } from './mock-db';
import { StaffStore } from './staff-store';

/** DEVELOPMENT / SIMULATION ONLY: the shape saved to localStorage. */
interface InboxSnapshot {
  conversations: Conversation[];
  seq: number;
}

const DAY = 86_400_000;

/**
 * The Inbox "backend" for the prototype. A conversation that needs a reply
 * has an open `owner-message` work item (so Tasks, badges and the dashboard
 * count it); replying closes the item, and a new message from the person
 * opens another. Replies are recorded in Sent.
 */
@Injectable({ providedIn: 'root' })
export class InboxStore {
  private readonly db = inject(MockDb);
  private readonly maintenance = inject(MaintenanceStore);
  private readonly comms = inject(CommsStore);
  private readonly staff = inject(StaffStore);

  conversations: Conversation[];
  private seq: number;

  constructor() {
    const saved = simulationStorage.load<InboxSnapshot>('inbox');
    this.conversations = saved?.conversations ?? [];
    this.seq = saved?.seq ?? 5600;
    if (!saved) this.seed();
  }

  // =================================================================== Reads

  view(c: Conversation): ConversationView | undefined {
    const person = this.db.persons.get(c.personId);
    const scheme = this.db.schemes.get(c.schemeId);
    if (!person || !scheme) return undefined;
    const unit = c.unitId ? this.db.unitById.get(c.unitId) : undefined;
    const account = c.unitId ? this.db.accountForUnit(c.unitId) : undefined;
    const openJobs = this.maintenance.jobs
      .filter((j) => !['closed', 'cancelled', 'paid'].includes(j.stage) && ((unit && j.unitId === unit.id) || j.reportedBy.personId === person.id))
      .map((j) => this.maintenance.summary(j));
    return { conversation: c, person, scheme, unit, account, openJobs, assigneeName: personName(c.assigneeId), lastAt: c.messages.at(-1)?.at ?? '' };
  }

  inScope(schemeIds: string[]): ConversationView[] {
    const ids = new Set(schemeIds);
    return this.conversations
      .filter((c) => ids.has(c.schemeId))
      .map((c) => this.view(c))
      .filter((v): v is ConversationView => !!v)
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }

  get(id: string): Conversation | undefined {
    return this.conversations.find((c) => c.id === id || c.ref === id);
  }

  forPerson(personId: string): ConversationView[] {
    return this.conversations.filter((c) => c.personId === personId).map((c) => this.view(c)!).filter(Boolean).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }

  // =================================================================== Commands

  check(id: string, a: ConversationAction): FieldErrors | null {
    const c = this.get(id);
    if (!c) return { id: 'This conversation no longer exists.' };
    switch (a.type) {
      case 'reply':
        return a.body.trim().length < 2 ? { body: 'Write your reply.' } : null;
      case 'close':
        return c.status === 'closed' ? { id: 'Already closed.' } : null;
      case 'reopen':
        return c.status !== 'closed' ? { id: 'It’s not closed.' } : null;
      case 'to-job':
        return a.title.trim().length < 5 ? { title: 'Describe the problem in a few words.' } : a.location.trim().length < 2 ? { location: 'Where is it?' } : null;
      case 'to-task':
        return a.title.trim().length < 5 ? { title: 'What has to be done?' } : !a.dueAt ? { dueAt: 'When by?' } : null;
      default:
        return null;
    }
  }

  act(id: string, a: ConversationAction, by: string, byId: string | null): string {
    const c = this.get(id)!;
    let result = c.id;
    const now = new Date().toISOString();
    switch (a.type) {
      case 'reply': {
        const person = this.db.persons.get(c.personId)!;
        const channel: Channel = a.channel ?? (person.preferredChannel === 'email' && person.email ? 'email' : person.phone ? person.preferredChannel : 'email');
        const unit = c.unitId ? this.db.unitsIn([c.schemeId]).find((u) => u.unit.id === c.unitId) : undefined;
        const sentId = this.comms.record({ kind: 'reply', schemeId: c.schemeId, subject: `Re: ${c.subject}`, body: a.body.trim(), channels: [channel], audienceLabel: `${person.displayName} · ${c.ref}`, by, to: [{ person, unit, channel }], source: { label: `Conversation ${c.ref}`, route: `/inbox?c=${c.id}` } });
        c.messages.push({ id: `cm-${++this.seq}`, at: now, from: 'us', by, body: a.body.trim(), channel, sentId });
        c.status = a.close ? 'closed' : 'waiting';
        this.closeWork(c, by);
        break;
      }
      case 'assign':
        c.assigneeId = a.assigneeId;
        if (c.workItemId) this.db.updateWork([c.workItemId], (w) => ({ ...w, assigneeId: a.assigneeId }));
        break;
      case 'close':
        c.status = 'closed';
        this.closeWork(c, by);
        break;
      case 'reopen':
        c.status = 'open';
        this.openWork(c, 'Reopened');
        break;
      case 'to-job': {
        const person = this.db.persons.get(c.personId)!;
        const unit = c.unitId ? this.db.unitById.get(c.unitId) : undefined;
        const tenant = unit ? this.db.unitsIn([c.schemeId]).find((u) => u.unit.id === unit.id)?.tenant?.id === person.id : false;
        result = this.maintenance.create(
          {
            schemeId: c.schemeId,
            unitId: unit?.id,
            location: a.location.trim(),
            title: a.title.trim(),
            description: [...c.messages].reverse().find((m) => m.from === 'them')?.body ?? c.subject,
            category: 'Building',
            priority: 'normal',
            reportedBy: { name: person.displayName, role: tenant ? 'tenant' : unit ? 'owner' : 'trustee', personId: person.id },
            photoCaptions: [],
          },
          by,
        );
        c.links.push({ label: `Job ${result}`, route: `/maintenance/${result}` });
        break;
      }
      case 'to-task': {
        result = `w-fu-${++this.seq}`;
        this.db.addWork({ id: result, ref: `${c.ref}-T`, kind: 'task', type: 'follow-up', title: a.title.trim(), detail: `From ${c.ref}: ${c.subject}`, schemeId: c.schemeId, personName: this.db.persons.get(c.personId)?.displayName, createdAt: now, dueAt: new Date(`${a.dueAt.slice(0, 10)}T17:00:00`).toISOString(), assigneeId: byId, status: 'open', route: `/inbox?c=${c.id}` });
        c.links.push({ label: `Task: ${a.title.trim()}`, route: '/tasks' });
        break;
      }
    }
    c.version++;
    this.commit();
    return result;
  }

  checkResident(m: ResidentMessage): FieldErrors | null {
    const e: FieldErrors = {};
    if (!m.conversationId && m.subject.trim().length < 3) e['subject'] = 'What is it about?';
    if (m.body.trim().length < 5) e['body'] = 'Write your message.';
    return Object.keys(e).length ? e : null;
  }

  /** A resident writes from the portal: a new conversation, or a reply to theirs. Either way it needs an answer. */
  fromResident(person: Person, schemeId: string, unitId: string | undefined, m: ResidentMessage): string {
    const now = new Date().toISOString();
    let c = m.conversationId ? this.conversations.find((x) => x.id === m.conversationId && x.personId === person.id) : undefined;
    if (!c) {
      c = { id: `cv-${++this.seq}`, version: 1, ref: `MSG-${this.seq}`, schemeId, personId: person.id, unitId, subject: m.subject.trim(), status: 'open', assigneeId: this.staff.routeTo(portfolioManagerOf(schemeId)?.staffId), messages: [], links: [] };
      this.conversations = [c, ...this.conversations];
    }
    c.messages.push({ id: `cm-${++this.seq}`, at: now, from: 'them', by: person.displayName, body: m.body.trim(), channel: 'portal' });
    c.status = 'open';
    c.version++;
    this.openWork(c, m.body.trim());
    this.commit();
    return c.id;
  }

  private openWork(c: Conversation, detail: string): void {
    const person = this.db.persons.get(c.personId);
    const unit = c.unitId ? this.db.unitById.get(c.unitId) : undefined;
    const id = `w-${c.id}-${++this.seq}`;
    const item: WorkItem = {
      id,
      ref: c.ref,
      kind: 'message',
      type: 'owner-message',
      title: c.subject,
      detail: detail.length > 120 ? `${detail.slice(0, 117)}…` : detail,
      schemeId: c.schemeId,
      unitLabel: unit ? `Unit ${unit.number}` : undefined,
      personName: person?.displayName,
      createdAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + DAY).toISOString(),
      assigneeId: c.assigneeId,
      status: 'open',
      route: `/inbox?c=${c.id}`,
    };
    this.db.addWork(item);
    c.workItemId = id;
  }

  private closeWork(c: Conversation, by: string): void {
    if (c.workItemId) this.db.closeWork(c.workItemId, by);
    c.workItemId = undefined;
  }

  // =================================================================== Seed

  /** The fixture's six owner messages become real conversations with the right people. */
  private seed(): void {
    for (const w of this.db.workItems.filter((x) => x.type === 'owner-message')) {
      const number = w.unitLabel?.replace('Unit ', '');
      const unit = number ? this.db.unitsIn([w.schemeId]).find((u) => u.unit.number === number) : undefined;
      const fromTenant = /^tenant/i.test(w.detail);
      const person = unit ? (fromTenant ? unit.tenant ?? unit.owners[0] : unit.owners[0]) : [...this.db.persons.values()].find((p) => p.displayName === w.personName);
      if (!person) continue;
      // When it arrived: before it fell due, and never in the future.
      const at = new Date(Math.min(new Date(w.dueAt).getTime() - DAY, Date.now() - 3 * 3_600_000, new Date(w.createdAt).getTime() + DAY)).toISOString();
      const c: Conversation = {
        id: `cv-${w.id}`,
        version: 1,
        ref: w.ref,
        schemeId: w.schemeId,
        personId: person.id,
        unitId: unit?.unit.id,
        subject: w.title,
        status: 'open',
        assigneeId: w.assigneeId,
        workItemId: w.id,
        messages: [{ id: `cm-${w.id}`, at, from: 'them', by: person.displayName, body: firstMessage(w.title, w.detail), channel: person.preferredChannel === 'email' ? 'email' : 'whatsapp' }],
        links: [],
      };
      this.conversations.push(c);
      // The queue item now names the real person and opens the conversation.
      w.personName = person.displayName;
      w.route = `/inbox?c=${c.id}`;
    }
    // One answered conversation, to show the thread.
    const kc = this.db.unitsIn(['kingfisher-court']).find((u) => u.unit.number === '23');
    const p = kc?.owners[0];
    if (kc && p) {
      this.conversations.push({
        id: 'cv-geyser', version: 2, ref: 'MSG-5498', schemeId: 'kingfisher-court', personId: p.id, unitId: kc.unit.id, subject: 'Geyser still leaking', status: 'waiting', assigneeId: 'staff-johan', links: [{ label: 'Job MR-1012', route: '/maintenance/MR-1012' }],
        messages: [
          { id: 'cm-g1', at: new Date(Date.now() - 6 * DAY).toISOString(), from: 'them', by: p.displayName, body: 'The plumber came on Wednesday but the geyser is still dripping into the ceiling. Can someone come back?', channel: 'email' },
          { id: 'cm-g2', at: new Date(Date.now() - 5 * DAY).toISOString(), from: 'us', by: 'Johan van der Merwe', body: `Hi ${p.firstName}, sorry about that. I’ve asked Rand Plumbing to come back and will confirm a time today.`, channel: 'email' },
        ],
      });
    }
    this.commit();
  }

  private commit(): void {
    simulationStorage.save('inbox', (): InboxSnapshot => ({ conversations: this.conversations, seq: this.seq }));
    this.db.touch();
  }
}

function firstMessage(title: string, detail: string): string {
  return `${title.replace(/^Dispute: /, 'I want to dispute: ')}. ${detail}`.replace(/\.\./g, '.');
}
