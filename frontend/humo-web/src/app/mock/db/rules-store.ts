import { Injectable, inject } from '@angular/core';
import {
  BREACH_STATUS_LABELS,
  Breach,
  BreachAction,
  BreachView,
  FieldErrors,
  NewBreach,
  RULE_CATEGORY_LABELS,
  RuleAction,
  RuleBook,
  RuleCategory,
  RulesView,
  SchemeRule,
  warningLetter,
} from '../../domain';
import { formatDate } from '../../ui/format/money';
import { portfolioManagerOf } from '../fixtures/staff';
import { simulationStorage } from '../simulation/simulation-storage';
import { AccessStore } from './access-store';
import { OpsStore } from './ops-store';
import { CommsStore } from './comms-store';
import { GovernanceStore } from './governance-store';
import { LibraryStore } from './library-store';
import { MockDb } from './mock-db';
import { seeded } from './random';
import { StaffStore } from './staff-store';

interface RulesSnapshot {
  rules: SchemeRule[];
  books: RuleBook[];
  breaches: Breach[];
  seq: number;
}

const DAY = 86_400_000;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

/** A typical sectional-title rule book (the wording is Humo PM's sample, not any scheme's registered rules). */
const STANDARD_RULES: [string, string, RuleCategory, string][] = [
  ['1.1', 'Keeping pets', 'pets', 'An owner or occupier may keep a pet only with the trustees’ written consent. The trustees may set reasonable conditions, and may withdraw consent if the animal is a nuisance to other occupiers.'],
  ['2.1', 'Parking in allocated bays', 'parking', 'Occupiers park only in the bays allocated to their section. Vehicles may not block driveways, gates or other bays.'],
  ['2.2', 'Visitor parking', 'parking', 'Visitor bays are for visitors only and for no more than 24 hours at a time. Occupiers may not use visitor bays for their own vehicles.'],
  ['2.3', 'Vehicle repairs', 'parking', 'No vehicle may be repaired or serviced on the common property, other than in an emergency. Owners are responsible for oil leaks from their vehicles.'],
  ['3.1', 'Quiet hours', 'noise', 'Between 22:00 and 07:00 on weekdays, and 23:00 and 08:00 on weekends and public holidays, occupiers keep noise to a level that doesn’t disturb others.'],
  ['4.1', 'Alterations', 'alterations', 'No structural alteration, or change to the outside of a section, may be made without the trustees’ written approval and, where needed, approved building plans.'],
  ['4.2', 'Appearance of the building', 'alterations', 'Washing may not be hung where it is visible from outside the section. Awnings, satellite dishes and burglar bars must be of a type the trustees approved.'],
  ['5.1', 'Refuse', 'refuse', 'Refuse is placed, in sealed bags, only in the bins provided at the refuse area. Large items are removed by the occupier at their own cost.'],
  ['6.1', 'Use of the pool and common areas', 'common-property', 'The pool and clubhouse are open from 07:00 to 21:00. Children under 12 must be supervised. Glass is not allowed at the pool.'],
  ['7.1', 'Letting', 'letting', 'An owner who lets their section gives the managing agent the tenant’s details before the tenant moves in. Tenants are bound by these rules, and the owner remains responsible for their conduct.'],
  ['7.2', 'Short-term letting', 'letting', 'Sections may not be let for periods of less than three months.'],
  ['8.1', 'Fire safety', 'safety', 'Open fires and braais are allowed only in the designated braai area. Gas bottles larger than 9 kg may not be kept in a section.'],
];

/**
 * DEVELOPMENT / SIMULATION ONLY. Scheme rules (a register with versions,
 * each change citing the owners' resolution) and the breach log: breaches
 * reported, warning letters (sent through Communications), referral to the
 * trustees. Humo PM doesn't levy fines.
 */
@Injectable({ providedIn: 'root' })
export class RulesStore {
  private readonly db = inject(MockDb);
  private readonly comms = inject(CommsStore);
  private readonly governance = inject(GovernanceStore);
  private readonly library = inject(LibraryStore);
  private readonly staff = inject(StaffStore);
  private readonly access = inject(AccessStore);
  private readonly ops = inject(OpsStore);

  rules: SchemeRule[] = [];
  books: RuleBook[] = [];
  breaches: Breach[] = [];
  private seq = 1000;

  constructor() {
    const saved = simulationStorage.load<RulesSnapshot>('rules');
    if (saved) {
      this.rules = saved.rules;
      this.books = saved.books;
      this.breaches = saved.breaches;
      this.seq = saved.seq;
    } else this.seed();
  }

  // =================================================================== Rules

  book(schemeId: string): RuleBook {
    const b = this.books.find((x) => x.schemeId === schemeId) ?? { schemeId, changedSinceShared: false };
    const shared = b.shared?.at ?? '';
    const changed = this.rules.some((r) => r.schemeId === schemeId && (r.versions[0].adoptedAt > shared.slice(0, 10) || (r.repealed?.at ?? '') > shared.slice(0, 10)));
    // When owners have the registered rules PDF, the register is the agency's working copy: no "share again" nudge.
    const sharedIsPdf = !!b.shared && b.sources?.[0]?.documentId === b.shared.documentId;
    return { ...b, changedSinceShared: !!b.shared && changed && !sharedIsPdf };
  }

  view(schemeId: string): RulesView | undefined {
    const scheme = this.db.schemes.get(schemeId);
    if (!scheme) return undefined;
    const openBreaches: Record<string, number> = {};
    for (const x of this.breaches.filter((b) => b.schemeId === schemeId && b.status !== 'resolved')) openBreaches[x.ruleId] = (openBreaches[x.ruleId] ?? 0) + 1;
    return {
      scheme,
      rules: this.rules.filter((r) => r.schemeId === schemeId).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
      book: this.book(schemeId),
      openBreaches,
    };
  }

  private resolution(schemeId: string, id: string) {
    const r = this.governance.resolutions.find((x) => x.id === id);
    return r && r.schemeId === schemeId && r.outcome === 'passed' ? r : undefined;
  }

  checkRules(schemeId: string, a: RuleAction): FieldErrors | null {
    if (!this.db.schemes.has(schemeId)) return { schemeId: 'No such scheme.' };
    const e: FieldErrors = {};
    const uploadLimitMb = this.ops.config.uploadLimitMb;
    const needsResolution = (id: string) => {
      if (!this.resolution(schemeId, id)) e['resolutionId'] = 'Rules change only by resolution of the owners: choose the passed resolution.';
    };
    switch (a.type) {
      case 'add':
        if (!/^\d+(\.\d+)*$/.test(a.number.trim())) e['number'] = 'A number like 4 or 4.3.';
        else if (this.rules.some((r) => r.schemeId === schemeId && r.status === 'in-force' && r.number === a.number.trim())) e['number'] = `Rule ${a.number.trim()} already exists: amend it instead.`;
        if (a.title.trim().length < 3) e['title'] = 'Give the rule a short title.';
        if (a.text.trim().length < 20) e['text'] = 'Write the rule as adopted.';
        // No resolution: the rule is being captured from the registered rules (onboarding).
        if (a.resolutionId) needsResolution(a.resolutionId);
        break;
      case 'amend': {
        const r = this.rules.find((x) => x.id === a.ruleId && x.schemeId === schemeId);
        if (!r || r.status !== 'in-force') return { ruleId: 'That rule isn’t in force.' };
        if (a.text.trim() === r.versions[0].text) e['text'] = 'The wording hasn’t changed.';
        else if (a.text.trim().length < 20) e['text'] = 'Write the rule as amended.';
        needsResolution(a.resolutionId);
        break;
      }
      case 'repeal': {
        const r = this.rules.find((x) => x.id === a.ruleId && x.schemeId === schemeId);
        if (!r || r.status !== 'in-force') return { ruleId: 'That rule isn’t in force.' };
        if (this.breaches.some((b) => b.ruleId === r.id && b.status !== 'resolved')) e['resolutionId'] = 'Resolve the open breaches of this rule first.';
        else needsResolution(a.resolutionId);
        break;
      }
      case 'share':
        if (!this.rules.some((r) => r.schemeId === schemeId && r.status === 'in-force')) return { schemeId: 'There are no rules to share yet.' };
        break;
      case 'upload': {
        const isPdf = a.mimeType === 'application/pdf' || a.fileName.toLowerCase().endsWith('.pdf');
        if (!a.fileName) e['file'] = 'Choose the rules PDF.';
        else if (!isPdf) e['file'] = 'Upload the rules as a PDF.';
        else if (a.sizeBytes > uploadLimitMb * 1024 * 1024) e['file'] = `Files can be up to ${uploadLimitMb} MB.`;
        else if (a.sizeBytes <= 0) e['file'] = 'The file is empty.';
        const today = iso(new Date());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(a.adoptedOn) || a.adoptedOn > today) e['adoptedOn'] = 'When did these rules take effect? Not in the future.';
        if (a.resolutionRef.trim().length < 3) e['resolutionRef'] = 'How were they adopted? E.g. “Registered with the CSOS” or the AGM resolution.';
        break;
      }
    }
    return Object.keys(e).length ? e : null;
  }

  actRules(schemeId: string, a: RuleAction, by: string, file?: File): string | void {
    const today = iso(new Date());
    switch (a.type) {
      case 'add': {
        const res = a.resolutionId ? this.resolution(schemeId, a.resolutionId) : undefined;
        const id = `rule-${++this.seq}`;
        this.rules.push({
          id,
          version: 1,
          schemeId,
          number: a.number.trim(),
          title: a.title.trim(),
          category: a.category,
          status: 'in-force',
          versions: [{ text: a.text.trim(), adoptedAt: res ? (res.decidedAt ?? res.proposedAt).slice(0, 10) : today, resolutionRef: res?.ref ?? `Captured from the registered rules by ${by}`, resolutionId: res?.id }],
        });
        this.commit();
        return id;
      }
      case 'amend': {
        const r = this.rules.find((x) => x.id === a.ruleId)!;
        const res = this.resolution(schemeId, a.resolutionId)!;
        r.versions.unshift({ text: a.text.trim(), adoptedAt: (res.decidedAt ?? res.proposedAt).slice(0, 10), resolutionRef: res.ref, resolutionId: res.id });
        r.version++;
        this.commit();
        return;
      }
      case 'repeal': {
        const r = this.rules.find((x) => x.id === a.ruleId)!;
        const res = this.resolution(schemeId, a.resolutionId)!;
        r.status = 'repealed';
        r.repealed = { at: (res.decidedAt ?? res.proposedAt).slice(0, 10), resolutionRef: res.ref };
        r.version++;
        this.commit();
        return;
      }
      case 'share':
        return this.share(schemeId, by);
      case 'upload':
        return this.upload(schemeId, a, by, file);
    }
  }

  /**
   * The registered rules as a PDF: stored in Documents and kept with its
   * history. Shared with owners, it replaces the copy they had before.
   */
  private upload(schemeId: string, a: Extract<RuleAction, { type: 'upload' }>, by: string, file?: File): string {
    const scheme = this.db.scheme(schemeId);
    const book = this.book(schemeId);
    // Earlier PDFs are superseded. What owners have is replaced only if this one is shared with them.
    const earlier = new Set((book.sources ?? []).map((x) => x.documentId));
    if (book.shared && a.shareWithOwners) earlier.add(book.shared.documentId);
    if (book.shared && !a.shareWithOwners) earlier.delete(book.shared.documentId);
    const documentId = this.library.upload(
      {
        title: `Registered conduct rules (in force from ${formatDate(a.adoptedOn)})`,
        fileName: a.fileName,
        mimeType: 'application/pdf',
        sizeBytes: a.sizeBytes,
        category: 'rules',
        record: { kind: 'scheme', id: schemeId },
        visibility: a.shareWithOwners ? 'owners' : 'staff',
        notes: `${scheme.name}: ${a.resolutionRef.trim()}. Uploaded in Governance › Scheme rules.`,
      },
      by,
      file,
    );
    // The earlier rules documents stay on record (archived), so what owners had before is still known.
    for (const d of this.library.documents.filter((x) => !x.archived && earlier.has(x.id))) {
      d.archived = { at: new Date().toISOString(), by, reason: 'Replaced by the registered rules PDF uploaded in Scheme rules' };
      d.version++;
    }
    const now = new Date().toISOString();
    const source = { documentId, fileName: a.fileName, sizeBytes: a.sizeBytes, adoptedOn: a.adoptedOn, resolutionRef: a.resolutionRef.trim(), uploadedAt: now, uploadedBy: by, shared: a.shareWithOwners };
    const next: RuleBook = {
      schemeId,
      sources: [source, ...(book.sources ?? [])],
      shared: a.shareWithOwners ? { at: now, by, documentId, rulesVersion: a.adoptedOn } : book.shared,
      changedSinceShared: false,
    };
    this.books = [...this.books.filter((b) => b.schemeId !== schemeId), next];
    this.commit();
    return documentId;
  }

  /** Publishes the rule book to Documents (owners and residents see it) and replaces the copy shared before. */
  private share(schemeId: string, by: string): string {
    const scheme = this.db.scheme(schemeId);
    const rules = this.rules.filter((r) => r.schemeId === schemeId && r.status === 'in-force').sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    const latest = rules.map((r) => r.versions[0].adoptedAt).sort().at(-1) ?? iso(new Date());
    const html = ruleBookHtml(scheme.name, rules, latest);
    for (const d of this.library.documents.filter((x) => !x.archived && x.category === 'rules' && x.links[0]?.kind === 'scheme' && x.links[0]?.id === schemeId)) {
      d.archived = { at: new Date().toISOString(), by, reason: 'Replaced by the rule book shared from Scheme rules' };
      d.version++;
    }
    const fileName = `${scheme.code.toLowerCase()}-conduct-rules-${latest}.html`;
    const file = new File([html], fileName, { type: 'text/html' });
    const documentId = this.library.upload(
      { title: `Conduct rules (as at ${formatDate(latest)})`, fileName, mimeType: 'text/html', sizeBytes: file.size, category: 'rules', record: { kind: 'scheme', id: schemeId }, visibility: 'owners', notes: `${rules.length} rules in force. Shared from Governance › Scheme rules.` },
      by,
      file,
    );
    const book: RuleBook = { ...this.book(schemeId), shared: { at: new Date().toISOString(), by, documentId, rulesVersion: latest }, changedSinceShared: false };
    this.books = [...this.books.filter((b) => b.schemeId !== schemeId), book];
    this.commit();
    return documentId;
  }

  // =================================================================== Breaches

  breachView(b: Breach): BreachView | undefined {
    const rule = this.rules.find((r) => r.id === b.ruleId);
    const unit = this.db.unitById.get(b.unitId);
    const person = this.db.persons.get(b.personId);
    if (!rule || !unit || !person) return undefined;
    const isTenant = this.db.tenant(unit.id)?.id === person.id;
    const assignee = this.access.identities().find((i) => i.staffId === b.assigneeId);
    return {
      breach: b,
      scheme: this.db.scheme(b.schemeId),
      rule,
      unit,
      person,
      personRole: isTenant ? 'tenant' : 'owner',
      assigneeName: assignee?.name ?? 'Unassigned',
      repeats: this.breaches.filter((x) => x.id !== b.id && x.ruleId === b.ruleId && x.unitId === b.unitId && x.occurredAt < b.occurredAt).length,
    };
  }

  inScope(schemeIds: string[]): BreachView[] {
    const ids = new Set(schemeIds);
    return this.breaches
      .filter((b) => ids.has(b.schemeId))
      .map((b) => this.breachView(b))
      .filter((v): v is BreachView => !!v);
  }

  get(id: string): Breach | undefined {
    return this.breaches.find((b) => b.id === id);
  }

  checkLog(input: NewBreach): FieldErrors | null {
    const e: FieldErrors = {};
    const rule = this.rules.find((r) => r.id === input.ruleId);
    if (!rule || rule.schemeId !== input.schemeId || rule.status !== 'in-force') e['ruleId'] = 'Choose a rule in force at this scheme.';
    const unit = this.db.unitById.get(input.unitId);
    if (!unit || unit.schemeId !== input.schemeId) e['unitId'] = 'Choose a unit in this scheme.';
    else if (input.against === 'tenant' && !this.db.tenant(unit.id)) e['against'] = 'This unit has no tenant on record: the letter goes to the owner.';
    if (input.description.trim().length < 10) e['description'] = 'Describe what happened: when, where, what was seen or heard.';
    if (!input.occurredAt || input.occurredAt > iso(new Date())) e['occurredAt'] = 'A date on or before today.';
    return Object.keys(e).length ? e : null;
  }

  log(input: NewBreach, by: string, at = new Date().toISOString()): string {
    const unit = this.db.unitById.get(input.unitId)!;
    const person = input.against === 'tenant' ? this.db.tenant(unit.id)! : this.db.owners(unit.id)[0];
    const id = `br-${++this.seq}`;
    this.breaches.push({
      id,
      version: 1,
      ref: `BR-${this.seq}`,
      schemeId: input.schemeId,
      ruleId: input.ruleId,
      unitId: unit.id,
      personId: person.id,
      description: input.description.trim(),
      occurredAt: input.occurredAt,
      reportedBy: by,
      status: 'open',
      events: [{ at, by, kind: 'reported', text: `Reported: ${input.description.trim()}` }],
      assigneeId: this.staff.routeTo(portfolioManagerOf(input.schemeId)?.staffId) ?? '',
    });
    this.commit();
    return id;
  }

  checkBreach(id: string, a: BreachAction): FieldErrors | null {
    const b = this.get(id);
    if (!b) return { id: 'This breach no longer exists.' };
    switch (a.type) {
      case 'warn':
        if (b.status === 'resolved') return { id: 'It’s resolved: reopen it first.' };
        if (b.status === 'with-trustees') return { id: 'It’s with the trustees now.' };
        if (a.final && b.status === 'open') return { final: 'Send a first warning before a final one.' };
        if (!(a.remedyDays >= 1 && a.remedyDays <= 60)) return { remedyDays: 'Between 1 and 60 days.' };
        if (a.message.trim().length < 20) return { message: 'Write the letter.' };
        return null;
      case 'note':
        return a.text.trim().length >= 3 ? null : { text: 'Write a note.' };
      case 'refer':
        if (b.status === 'resolved' || b.status === 'with-trustees') return { id: 'It can’t be referred now.' };
        return a.note.trim().length >= 5 ? null : { note: 'Tell the trustees what’s happened so far and what you recommend.' };
      case 'resolve':
        if (b.status === 'resolved') return { id: 'Already resolved.' };
        return a.note.trim().length >= 5 ? null : { note: 'How was it resolved?' };
      case 'reopen':
        if (b.status !== 'resolved') return { id: 'It’s still open.' };
        return a.note.trim().length >= 5 ? null : { note: 'Why is it being reopened?' };
    }
  }

  actBreach(id: string, a: BreachAction, by: string, at = new Date().toISOString()): void {
    const b = this.get(id)!;
    const v = this.breachView(b)!;
    switch (a.type) {
      case 'warn': {
        const remedyBy = iso(new Date(new Date(at).getTime() + a.remedyDays * DAY));
        const subject = `${a.final ? 'Final warning' : 'Warning'}: rule ${v.rule.number} (${v.rule.title}) — Unit ${v.unit.number}`;
        // The letter states the date: before the sign-off when it has one.
        const dateLine = `Please put this right by ${formatDate(remedyBy)}.`;
        const signOff = '\n\nKind regards';
        const body = a.message.trim().includes(signOff) ? a.message.trim().replace(signOff, `\n\n${dateLine}${signOff}`) : `${a.message.trim()}\n\n${dateLine}`;
        // Post isn't a Humo PM channel: the letter is printed and posted; Humo PM records that it was.
        const sentId =
          a.channel === 'email'
            ? this.comms.record({ kind: 'letter', schemeId: b.schemeId, subject, body, channels: ['email'], audienceLabel: `${v.person.displayName} · Unit ${v.unit.number}`, by, at, to: [{ person: v.person, unit: this.db.unitSummary(v.unit), channel: 'email' }], source: { label: b.ref, route: `/governance/rules/breaches/${b.id}` } })
            : undefined;
        b.status = a.final ? 'final-warning' : 'warned';
        b.remedyBy = remedyBy;
        b.events.push({ at, by, kind: a.final ? 'final-warning' : 'warning', text: `${a.final ? 'Final warning' : 'Warning'} sent ${a.channel === 'email' ? 'by email' : 'by post'}: put it right by ${formatDate(remedyBy)}.`, sentId });
        this.followUp(b, v, remedyBy, by);
        break;
      }
      case 'note':
        b.events.push({ at, by, kind: 'note', text: a.text.trim() });
        break;
      case 'refer': {
        b.status = 'with-trustees';
        b.events.push({ at, by, kind: 'referred', text: `Referred to the trustees: ${a.note.trim()}` });
        this.closeFollowUp(b, by);
        // The trustees see it on their Tasks: the board decides the next step.
        this.db.addWork({
          id: `w-${b.id}-trustees-${b.events.length}`,
          ref: `${b.ref}-TR`,
          kind: 'task',
          type: 'follow-up',
          title: `Decide on breach ${b.ref}: rule ${v.rule.number}, Unit ${v.unit.number}`,
          detail: a.note.trim(),
          schemeId: b.schemeId,
          personName: v.person.displayName,
          createdAt: at,
          dueAt: new Date(new Date(at).getTime() + 14 * DAY).toISOString(),
          assigneeId: b.assigneeId,
          status: 'open',
          route: `/governance/rules/breaches/${b.id}`,
        });
        break;
      }
      case 'resolve':
        b.status = 'resolved';
        b.events.push({ at, by, kind: 'resolved', text: `Resolved: ${a.note.trim()}` });
        this.closeFollowUp(b, by);
        for (const w of this.db.workItems.filter((x) => x.status === 'open' && x.ref === `${b.ref}-TR`)) this.db.closeWork(w.id, by);
        break;
      case 'reopen':
        b.status = 'open';
        b.remedyBy = undefined;
        b.events.push({ at, by, kind: 'reopened', text: `Reopened: ${a.note.trim()}` });
        break;
    }
    b.version++;
    this.commit();
  }

  /** A Task to check, on the remedy date, whether it was put right. */
  private followUp(b: Breach, v: BreachView, remedyBy: string, by: string): void {
    this.closeFollowUp(b, by);
    this.db.addWork({
      id: `w-${b.id}-check-${b.events.length}`,
      ref: `${b.ref}-CHK`,
      kind: 'task',
      type: 'follow-up',
      title: `Check whether Unit ${v.unit.number} has put right: ${v.rule.title.toLowerCase()}`,
      detail: `${b.ref} · rule ${v.rule.number}. If not, send a final warning or refer it to the trustees.`,
      schemeId: b.schemeId,
      personName: v.person.displayName,
      createdAt: new Date().toISOString(),
      dueAt: new Date(`${remedyBy}T17:00:00`).toISOString(),
      assigneeId: b.assigneeId,
      status: 'open',
      route: `/governance/rules/breaches/${b.id}`,
    });
  }

  private closeFollowUp(b: Breach, by: string): void {
    for (const w of this.db.workItems.filter((x) => x.status === 'open' && x.ref === `${b.ref}-CHK`)) this.db.closeWork(w.id, by);
  }

  // =================================================================== Seed

  private seed(): void {
    const schemes = [...this.db.schemes.values()].filter((s) => s.organisationId === 'acacia' && s.status === 'active');
    for (const s of schemes) {
      const r = seeded(`rules:${s.id}`);
      const registered = iso(new Date(2015 + Math.floor(r() * 7), Math.floor(r() * 12), 1));
      for (const [number, title, category, text] of STANDARD_RULES) {
        if (number === '7.2' && s.id !== 'kingfisher-court' && r() < 0.4) continue; // not every scheme restricts short-term letting
        this.rules.push({ id: `rule-${s.code.toLowerCase()}-${number}`, version: 1, schemeId: s.id, number, title, category, status: 'in-force', versions: [{ text, adoptedAt: registered, resolutionRef: 'Registered rules' }] });
      }
      const doc = this.library.documents.find((d) => !d.archived && d.category === 'rules' && d.links[0]?.kind === 'scheme' && d.links[0]?.id === s.id);
      if (doc) this.books.push({ schemeId: s.id, shared: { at: doc.uploadedAt, by: doc.uploadedBy, documentId: doc.id, rulesVersion: registered }, changedSinceShared: false });
    }

    // Kingfisher Court changed its pets rule before moving to Humo PM.
    const pets = this.rules.find((x) => x.id === 'rule-kc-1.1');
    if (pets) {
      pets.versions.unshift({
        text: 'An owner or occupier may keep one dog of up to 15 kg, or up to two cats, with the trustees’ written consent. The trustees may set reasonable conditions, and may withdraw consent if the animal is a nuisance to other occupiers.',
        adoptedAt: '2024-11-20',
        resolutionRef: 'Special resolution, AGM Nov 2024 (before Humo Property Management)',
      });
      pets.version = 2;
    }

    // Breaches: mostly Kingfisher Court, so the walkthrough has history.
    const units = (schemeId: string) => this.db.unitsIn([schemeId]);
    const kc = units('kingfisher-court');
    const anele = kc.find((u) => u.unit.accountNo === 'KC-042');
    const others = kc.filter((u) => !u.tenant && u.unit.accountNo !== 'KC-042');
    const by = 'Johan van der Merwe';
    // Seeded events happen in working hours.
    const at = (n: number) => {
      const d = daysAgo(n);
      d.setHours(8 + (n % 8), (n * 17) % 60, 0, 0);
      return d.toISOString();
    };

    if (others[3]) {
      const id = this.log({ schemeId: 'kingfisher-court', ruleId: 'rule-kc-3.1', unitId: others[3].unit.id, against: 'owner', description: 'Loud music past midnight on two Saturdays running; complaints from the units either side.', occurredAt: iso(daysAgo(19)) }, by, at(18));
      this.actBreach(id, { type: 'warn', final: false, remedyDays: 14, channel: 'email', message: warningLetter(others[3].owners[0]?.displayName ?? 'Owner', '3.1', 'Quiet hours', 'loud music after midnight on two Saturdays') }, by, at(12));
    }
    if (anele) {
      this.log({ schemeId: 'kingfisher-court', ruleId: 'rule-kc-2.2', unitId: anele.unit.id, against: 'owner', description: 'A grey Polo (CA 123-456) has been parked in visitor bay V3 overnight most of this week.', occurredAt: iso(daysAgo(3)) }, 'Thandeka Mokoena', at(2));
    }
    const shortStay = others[5];
    if (shortStay) {
      const id = this.log({ schemeId: 'kingfisher-court', ruleId: 'rule-kc-7.2', unitId: shortStay.unit.id, against: 'owner', description: 'The unit is listed on a short-stay booking site; guests change every few days and have been using the pool after hours.', occurredAt: iso(daysAgo(50)) }, by, at(49));
      this.actBreach(id, { type: 'warn', final: false, remedyDays: 14, channel: 'email', message: warningLetter(shortStay.owners[0]?.displayName ?? 'Owner', '7.2', 'Short-term letting', 'letting the unit for short stays') }, by, at(45));
      this.actBreach(id, { type: 'warn', final: true, remedyDays: 7, channel: 'email', message: warningLetter(shortStay.owners[0]?.displayName ?? 'Owner', '7.2', 'Short-term letting', 'letting the unit for short stays', true) }, by, at(28));
      this.actBreach(id, { type: 'refer', note: 'Still listed after the final warning (checked on the booking site). Recommend the trustees consider a CSOS application for an order to stop.' }, by, at(18));
    }
    if (others[8]) {
      const id = this.log({ schemeId: 'kingfisher-court', ruleId: 'rule-kc-4.2', unitId: others[8].unit.id, against: 'owner', description: 'A satellite dish was mounted on the front balcony wall without approval.', occurredAt: iso(daysAgo(80)) }, by, at(79));
      this.actBreach(id, { type: 'warn', final: false, remedyDays: 21, channel: 'post', message: warningLetter(others[8].owners[0]?.displayName ?? 'Owner', '4.2', 'Appearance of the building', 'a satellite dish on the front balcony wall') }, by, at(76));
      this.actBreach(id, { type: 'resolve', note: 'The owner moved the dish to the approved position on the roof bracket. Checked on site.' }, by, at(52));
    }
    for (const [schemeId, rule, n, text] of [
      ['jacaranda-heights', '4.2', 6, 'Washing hung over the balcony rail, visible from the street.'],
      ['silverlakes-manor', '3.1', 9, 'Renovation noise (drilling) on a Sunday morning, before 09:00.'],
    ] as const) {
      const s = this.db.schemes.get(schemeId);
      const u = s ? units(schemeId).find((x) => !x.tenant) : undefined;
      if (s && u && this.rules.some((x) => x.id === `rule-${s.code.toLowerCase()}-${rule}`)) {
        this.log({ schemeId, ruleId: `rule-${s.code.toLowerCase()}-${rule}`, unitId: u.unit.id, against: 'owner', description: text, occurredAt: iso(daysAgo(n + 1)) }, by, at(n));
      }
    }
    this.save();
  }

  private save(): void {
    simulationStorage.save('rules', (): RulesSnapshot => ({ rules: this.rules, books: this.books, breaches: this.breaches, seq: this.seq }));
  }

  private commit(): void {
    this.save();
    this.db.touch();
  }
}

function ruleBookHtml(scheme: string, rules: SchemeRule[], asAt: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const rows = rules
    .map((r) => `<section><h3>${esc(r.number)} ${esc(r.title)}</h3><p>${esc(r.versions[0].text)}</p><p class="m">${esc(RULE_CATEGORY_LABELS[r.category])} · adopted ${esc(formatDate(r.versions[0].adoptedAt))} · ${esc(r.versions[0].resolutionRef)}</p></section>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(scheme)} conduct rules</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#1d1d1f}h1{margin-bottom:4px}.m{color:#666;font-size:13px}section{border-top:1px solid #ddd;padding-top:8px}</style></head><body><h1>${esc(scheme)}</h1><p class="m">Conduct rules as at ${esc(formatDate(asAt))}. ${rules.length} rules in force.</p>${rows}</body></html>`;
}

/** For labels outside this file. */
export const breachStatusLabel = (s: Breach['status']) => BREACH_STATUS_LABELS[s];
