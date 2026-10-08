import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  Account,
  AccountDetail,
  MatchView,
  Note,
  PayerRule,
  Person,
  PersonSummary,
  Receipt,
  ReceiptView,
  Relationship,
  Scheme,
  StatementView,
  TimelineEvent,
  Unit,
  UnitSummary,
  WorkItem,
} from '../../domain';
import { SCHEMES } from '../fixtures/schemes';
import { portfolioManagerOf } from '../fixtures/staff';
import { createWorkItems } from '../fixtures/work-items';
import { Ledger, RawTransaction, buildStatement, generateLedger, withBalances } from './ledger';
import { daysAgo, periodLabel, periodOf, round2, seeded } from './random';
import { ageingFor, monthlyCharges, seedPortfolio, statusFor } from './seed-portfolio';

function hasWord(text: string, word: string): boolean {
  const w = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return w.length > 2 && new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(text);
}

/**
 * The prototype's in-memory "database". It plays the role the .NET API and
 * database will play later: it holds the data, joins read models, and applies
 * commands with their side effects (an allocation updates the account, its
 * ageing, the receipt, and the "receipts to allocate" work item).
 *
 * Data sources (mock/data-sources) are thin adapters over this class.
 */
@Injectable({ providedIn: 'root' })
export class MockDb {
  /** Emits after every change; live queries re-run on it. */
  readonly changes$ = new BehaviorSubject(0);

  /** With each scheme's manager joined in from role assignments, as the API's read models do. */
  readonly schemes = new Map<string, Scheme>(SCHEMES.map((s) => [s.id, { ...s, portfolioManager: portfolioManagerOf(s.id) }]));
  readonly units: Unit[];
  readonly unitById = new Map<string, Unit>();
  readonly persons = new Map<string, Person>();
  readonly accounts = new Map<string, Account>();
  private readonly accountByUnit = new Map<string, Account>();
  private readonly relsByUnit = new Map<string, Relationship[]>();
  private readonly relsByPerson = new Map<string, Relationship[]>();
  private readonly ledgers = new Map<string, Ledger>();
  private readonly extraTx = new Map<string, RawTransaction[]>();

  receipts: Receipt[] = [];
  payerRules: PayerRule[] = [];
  notes: Note[] = [];
  workItems: WorkItem[] = createWorkItems();

  constructor() {
    const seed = seedPortfolio();
    this.units = seed.units;
    for (const u of seed.units) this.unitById.set(u.id, u);
    for (const p of seed.persons) this.persons.set(p.id, p);
    for (const a of seed.accounts) {
      this.accounts.set(a.id, a);
      this.accountByUnit.set(a.unitId, a);
    }
    for (const r of seed.relationships) {
      if (r.unitId) this.push(this.relsByUnit, r.unitId, r);
      this.push(this.relsByPerson, r.personId, r);
    }
    this.receipts = this.seedReceipts();
    this.syncReceiptWork();
  }

  touch(): void {
    this.changes$.next(this.changes$.value + 1);
  }

  // =====================================================================
  // Reads
  // =====================================================================

  scheme(id: string): Scheme {
    return this.schemes.get(id)!;
  }

  owners(unitId: string): Person[] {
    return (this.relsByUnit.get(unitId) ?? []).filter((r) => r.type === 'owner').map((r) => this.persons.get(r.personId)!);
  }

  tenant(unitId: string): Person | undefined {
    const rel = (this.relsByUnit.get(unitId) ?? []).find((r) => r.type === 'tenant');
    return rel ? this.persons.get(rel.personId) : undefined;
  }

  unitSummary(unit: Unit): UnitSummary {
    return {
      unit,
      scheme: this.scheme(unit.schemeId),
      owners: this.owners(unit.id),
      tenant: this.tenant(unit.id),
      account: this.accountByUnit.get(unit.id)!,
    };
  }

  unitsIn(schemeIds: string[]): UnitSummary[] {
    const ids = new Set(schemeIds);
    return this.units.filter((u) => ids.has(u.schemeId)).map((u) => this.unitSummary(u));
  }

  findUnit(schemeId: string, number: string): Unit | undefined {
    return this.units.find((u) => u.schemeId === schemeId && u.number === number);
  }

  personSummary(person: Person, schemeIds?: Set<string>): PersonSummary {
    const relationships = (this.relsByPerson.get(person.id) ?? [])
      .filter((r) => !schemeIds || schemeIds.has(r.schemeId))
      .map((relationship) => {
        const unit = relationship.unitId ? this.unitById.get(relationship.unitId) : undefined;
        const account = unit && relationship.type === 'owner' ? this.accountByUnit.get(unit.id) : undefined;
        return { relationship, scheme: this.scheme(relationship.schemeId), unit, account };
      });
    const balance = round2(relationships.reduce((s, r) => s + (r.account?.balance ?? 0), 0));
    return { person, relationships, balance };
  }

  peopleIn(schemeIds: string[]): PersonSummary[] {
    const ids = new Set(schemeIds);
    const out: PersonSummary[] = [];
    for (const person of this.persons.values()) {
      const rels = this.relsByPerson.get(person.id) ?? [];
      if (rels.some((r) => ids.has(r.schemeId))) out.push(this.personSummary(person, ids));
    }
    return out;
  }

  ledger(accountId: string): Ledger {
    let base = this.ledgers.get(accountId);
    const account = this.accounts.get(accountId)!;
    if (!base) {
      const unit = this.unitById.get(account.unitId)!;
      const holder = this.persons.get(account.holderPersonId)!;
      // Generate against the *seeded* balance, before any allocations made in this session.
      const extras = (this.extraTx.get(accountId) ?? []).reduce((s, t) => s + t.amount, 0);
      base = generateLedger({ ...account, balance: round2(account.balance - extras) }, unit, holder.lastName);
      this.ledgers.set(accountId, base);
    }
    return { opening: base.opening, transactions: [...base.transactions, ...(this.extraTx.get(accountId) ?? [])] };
  }

  accountDetail(accountId: string): AccountDetail | undefined {
    const account = this.accounts.get(accountId);
    if (!account) return undefined;
    const unit = this.unitById.get(account.unitId)!;
    const { opening, transactions } = this.ledger(accountId);
    const tx = withBalances(opening, transactions);
    const periods = [...new Set(tx.map((t) => periodOf(t.date)))].sort().reverse();
    return {
      account,
      unit,
      scheme: this.scheme(account.schemeId),
      holder: this.persons.get(account.holderPersonId)!,
      transactions: tx,
      statementPeriods: periods,
      lastPayment: tx.find((t) => t.type === 'payment'),
    };
  }

  statement(accountId: string, period: string): StatementView | undefined {
    const account = this.accounts.get(accountId);
    if (!account) return undefined;
    const { opening, transactions } = this.ledger(accountId);
    const statement = buildStatement(accountId, opening, transactions, period);
    if (!statement) return undefined;
    return {
      statement,
      account,
      unit: this.unitById.get(account.unitId)!,
      scheme: this.scheme(account.schemeId),
      holder: this.persons.get(account.holderPersonId)!,
    };
  }

  // ---- Search ----

  /** Understands "KC 42", "kc42", "KC-042", "kingfisher 42", "unit 42", "42". */
  searchUnits(query: string, schemeIds: string[], limit = 8): UnitSummary[] {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const ids = new Set(schemeIds);
    const num = /(\d+)/.exec(q)?.[1];
    const words = q.replace(/[-\d]/g, ' ').split(/\s+/).filter((w) => w && w !== 'unit' && w !== 'erf' && w !== 'flat');
    if (!num) return [];
    const n = String(Number(num));
    return this.units
      .filter((u) => ids.has(u.schemeId) && u.number === n)
      .filter((u) => {
        const s = this.scheme(u.schemeId);
        const hay = `${s.code} ${s.name}`.toLowerCase();
        return words.every((w) => hay.includes(w) || s.code.toLowerCase() === w);
      })
      .slice(0, limit)
      .map((u) => this.unitSummary(u));
  }

  searchPeople(query: string, schemeIds: string[], limit = 8): PersonSummary[] {
    const q = query.toLowerCase().trim();
    if (q.length < 2) return [];
    const digits = q.replace(/\D/g, '');
    const tokens = q.split(/\s+/).filter(Boolean);
    const ids = new Set(schemeIds);
    const out: PersonSummary[] = [];
    for (const p of this.persons.values()) {
      const rels = this.relsByPerson.get(p.id) ?? [];
      if (!rels.some((r) => ids.has(r.schemeId))) continue;
      const hay = `${p.displayName} ${p.firstName} ${p.lastName} ${p.email}`.toLowerCase();
      const byName = tokens.every((t) => hay.includes(t));
      const byPhone = digits.length >= 4 && p.phone.replace(/\D/g, '').includes(digits);
      if (byName || byPhone) out.push(this.personSummary(p, ids));
      if (out.length >= limit) break;
    }
    return out;
  }

  // ---- Receipts ----

  receiptViews(schemeIds: string[]): ReceiptView[] {
    const ids = new Set(schemeIds);
    return this.receipts
      .filter((r) => ids.has(r.schemeId))
      .map((receipt) => ({
        receipt,
        scheme: this.scheme(receipt.schemeId),
        allocatedTo: receipt.allocations.map((a) => {
          const account = this.accounts.get(a.accountId)!;
          return { account, unit: this.unitById.get(account.unitId)!, amount: a.amount };
        }),
      }));
  }

  /**
   * Suggests accounts for a receipt, each with a confidence and the reasons —
   * an agent should never have to trust a black box with owners' money.
   */
  matches(receiptId: string): MatchView[] {
    const receipt = this.receipts.find((r) => r.id === receiptId);
    if (!receipt) return [];
    const scheme = this.scheme(receipt.schemeId);
    const ref = receipt.reference.toLowerCase();
    const payer = receipt.payer.toLowerCase();
    const text = `${ref} ${payer}`;
    const compact = text.replace(/[\s-]/g, '');
    const results: MatchView[] = [];

    for (const unit of this.units.filter((u) => u.schemeId === scheme.id)) {
      const account = this.accountByUnit.get(unit.id)!;
      const reasons: string[] = [];
      let score = 0;

      const rule = this.payerRules.find((p) => p.accountId === account.id && text.includes(p.pattern.toLowerCase()));
      if (rule) {
        score += 95;
        reasons.push(`Remembered payer rule “${rule.pattern}”`);
      }

      const code = scheme.code.toLowerCase();
      const unitRef =
        compact.includes(account.accountNo.toLowerCase().replace('-', '')) ||
        new RegExp(`\\b${code}\\s*-?\\s*0*${unit.number}\\b`).test(text) ||
        new RegExp(`\\b(unit|flat|erf|nr|no)\\.?\\s*0*${unit.number}\\b`).test(text);
      if (unitRef) {
        score += 55;
        reasons.push(`Reference mentions Unit ${unit.number}`);
      }

      // Names match as whole words ("Nel" must not match "Anele"); a different initial weakens the match.
      const payerInitial = /^([a-z])\s/.exec(payer)?.[1];
      for (const owner of this.owners(unit.id)) {
        if (!hasWord(text, owner.lastName)) continue;
        const first = owner.firstName.toLowerCase();
        const sameInitial = !payerInitial || payerInitial === first[0];
        score += sameInitial ? 30 : 15;
        reasons.push(sameInitial ? `Payer name matches owner ${owner.displayName}` : `Surname matches owner ${owner.displayName} (different initial)`);
        if (hasWord(text, owner.firstName)) score += 10;
      }

      const tenant = this.tenant(unit.id);
      if (tenant && hasWord(text, tenant.lastName)) {
        score += 12;
        reasons.push(`Payer matches the tenant (${tenant.displayName}), not the owner`);
      }

      const monthly = monthlyCharges(unit);
      if (Math.abs(receipt.amount - unit.monthlyLevy) < 0.01) {
        score += 20;
        reasons.push('Amount equals the monthly levy');
      } else if (Math.abs(receipt.amount - monthly) < 1) {
        score += 15;
        reasons.push('Amount equals the usual monthly charges');
      }
      if (account.balance > 0 && Math.abs(receipt.amount - account.balance) < 0.01) {
        score += 25;
        reasons.push('Amount clears the outstanding balance');
      }
      if (receipt.amount > monthly * 1.6 && unitRef) {
        reasons.push(`Amount is ${(receipt.amount / unit.monthlyLevy).toFixed(1)}× the levy — check before allocating`);
      }

      if (score >= 20) results.push({ accountId: account.id, confidence: Math.min(99, score), reasons, summary: this.unitSummary(unit) });
    }
    return results.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  }

  suggestedFor(accountId: string): ReceiptView[] {
    const account = this.accounts.get(accountId);
    if (!account) return [];
    return this.receiptViews([account.schemeId]).filter(
      (v) => v.receipt.status === 'unallocated' && this.matches(v.receipt.id)[0]?.accountId === accountId,
    );
  }

  // ---- Timeline ----

  timelineForUnit(unitId: string): TimelineEvent[] {
    const unit = this.unitById.get(unitId);
    if (!unit) return [];
    const account = this.accountByUnit.get(unitId)!;
    const holder = this.persons.get(account.holderPersonId)!;
    const scheme = this.scheme(unit.schemeId);
    const accountLink = `/schemes/${scheme.id}/units/${unit.number}/account`;
    const events: TimelineEvent[] = [];
    const { transactions } = this.ledger(account.id);

    const byPeriod = new Map<string, RawTransaction[]>();
    for (const t of transactions) {
      if (t.type === 'payment' || t.type === 'adjustment') {
        events.push({
          id: 'ev-' + t.id,
          at: t.date,
          kind: 'payment',
          title: t.type === 'payment' ? 'Payment received' : 'Adjustment',
          detail: t.reference ? `Reference “${t.reference}”` : t.description,
          amount: -t.amount,
          link: accountLink,
        });
      } else {
        const p = periodOf(t.date);
        byPeriod.set(p, [...(byPeriod.get(p) ?? []), t]);
      }
    }
    for (const [period, lines] of byPeriod) {
      const total = round2(lines.reduce((s, l) => s + l.amount, 0));
      const interest = lines.find((l) => l.type === 'interest');
      events.push({
        id: `ev-charges-${account.id}-${period}`,
        at: lines[0].date,
        kind: 'charge',
        title: `${periodLabel(period, false)} charges raised`,
        detail: lines.map((l) => l.description.split(' — ')[0]).join(' · ') + (interest ? ' (incl. interest)' : ''),
        amount: total,
        link: accountLink,
      });
      const [y, m] = period.split('-').map(Number);
      events.push({
        id: `ev-statement-${account.id}-${period}`,
        at: new Date(y, m - 1, 1, 8).toISOString(),
        kind: 'statement',
        title: `${periodLabel(period, false)} statement ${account.statementBy === 'post' ? 'posted' : account.statementBy === 'portal' ? 'published to the portal' : 'emailed'} to ${holder.displayName}`,
        link: `${accountLink}/statements/${period}`,
      });
    }

    const label = `Unit ${unit.number}`;
    for (const w of this.workItems.filter((w) => w.schemeId === unit.schemeId && w.unitLabel === label)) {
      events.push({
        id: 'ev-' + w.id,
        at: w.createdAt,
        kind: w.type.startsWith('maintenance') ? 'maintenance' : w.type === 'owner-message' ? 'message' : 'status',
        title: w.title,
        detail: w.detail,
        link: w.route,
      });
    }

    for (const n of this.notes.filter((n) => n.unitId === unitId)) {
      events.push({ id: n.id, at: n.at, kind: n.kind, title: n.kind === 'call' ? 'Call logged' : 'Note', detail: n.text, actor: n.author });
    }
    return events.sort((a, b) => b.at.localeCompare(a.at));
  }

  timelineForPerson(personId: string): TimelineEvent[] {
    const rels = this.relsByPerson.get(personId) ?? [];
    const events: TimelineEvent[] = [];
    for (const r of rels.filter((r) => r.type === 'owner' && r.unitId)) {
      const unit = this.unitById.get(r.unitId!)!;
      const prefix = `${this.scheme(unit.schemeId).code} ${unit.number} · `;
      events.push(...this.timelineForUnit(unit.id).map((e) => ({ ...e, id: `${e.id}-${personId}`, title: prefix + e.title })));
    }
    for (const n of this.notes.filter((n) => n.personId === personId && !n.unitId)) {
      events.push({ id: n.id, at: n.at, kind: n.kind, title: n.kind === 'call' ? 'Call logged' : 'Note', detail: n.text, actor: n.author });
    }
    const unique = new Map(events.map((e) => [e.id, e]));
    return [...unique.values()].sort((a, b) => b.at.localeCompare(a.at));
  }

  // =====================================================================
  // Commands
  // =====================================================================

  allocate(receiptId: string, allocations: { accountId: string; amount: number }[], remember: boolean, by: string): void {
    const receipt = this.receipts.find((r) => r.id === receiptId);
    if (!receipt || receipt.status === 'allocated') return;
    for (const a of allocations) {
      const account = this.accounts.get(a.accountId)!;
      this.ledger(account.id); // make sure history is generated before the balance changes
      this.push(this.extraTx, account.id, {
        id: `${receipt.id}-${account.id}`,
        accountId: account.id,
        date: receipt.date,
        type: 'payment',
        description: 'Payment received — thank you',
        reference: receipt.reference,
        amount: -a.amount,
        receiptId: receipt.id,
      });
      this.rebalance(account, -a.amount);
    }
    receipt.status = 'allocated';
    receipt.allocations = allocations;
    receipt.allocatedBy = by;
    if (remember && allocations.length === 1) {
      const pattern = (receipt.payer || receipt.reference).trim();
      if (pattern && !this.payerRules.some((p) => p.pattern === pattern && p.accountId === allocations[0].accountId)) {
        this.payerRules.push({ id: `rule-${this.payerRules.length + 1}`, schemeId: receipt.schemeId, pattern, accountId: allocations[0].accountId, createdBy: by });
      }
    }
    this.syncReceiptWork();
    this.touch();
  }

  unallocate(receiptId: string): void {
    const receipt = this.receipts.find((r) => r.id === receiptId);
    if (!receipt) return;
    for (const a of receipt.allocations) {
      const account = this.accounts.get(a.accountId)!;
      this.extraTx.set(account.id, (this.extraTx.get(account.id) ?? []).filter((t) => t.receiptId !== receipt.id));
      this.rebalance(account, a.amount);
    }
    receipt.status = 'unallocated';
    receipt.allocations = [];
    receipt.allocatedBy = undefined;
    this.syncReceiptWork();
    this.touch();
  }

  moveToSuspense(receiptId: string, by: string): void {
    const receipt = this.receipts.find((r) => r.id === receiptId);
    if (!receipt) return;
    receipt.status = 'suspense';
    receipt.allocatedBy = by;
    this.syncReceiptWork();
    this.touch();
  }

  addNote(note: Omit<Note, 'id' | 'at' | 'author'>, author: string): void {
    this.notes.push({ ...note, id: `note-${this.notes.length + 1}`, at: new Date().toISOString(), author });
    this.touch();
  }

  // ---- Work items (Attention model store) ----

  /** Other stores react to decisions made anywhere (e.g. approving a quote moves its job on). */
  readonly workHooks: ((before: WorkItem, after: WorkItem) => void)[] = [];

  updateWork(ids: string[], change: (w: WorkItem) => WorkItem): void {
    const set = new Set(ids);
    const changed: [WorkItem, WorkItem][] = [];
    this.workItems = this.workItems.map((w) => {
      if (!set.has(w.id)) return w;
      const next = change(w);
      changed.push([w, next]);
      return next;
    });
    for (const [before, after] of changed) {
      if (before.status !== after.status) this.workHooks.forEach((h) => h(before, after));
    }
    this.touch();
  }

  addWork(item: WorkItem): void {
    this.workItems = [...this.workItems.filter((w) => w.id !== item.id), item];
  }

  /** Marks open work items for a reference as done (e.g. the job moved on, so "overdue" no longer applies). */
  resolveWork(ref: string, types: WorkItem['type'][], by: string): void {
    this.workItems = this.workItems.map((w) =>
      w.ref === ref && types.includes(w.type) && w.status === 'open' ? { ...w, status: 'done', decidedBy: by, decidedAt: new Date().toISOString() } : w,
    );
  }

  // =====================================================================
  // Internals
  // =====================================================================

  private rebalance(account: Account, delta: number): void {
    const unit = this.unitById.get(account.unitId)!;
    account.balance = round2(account.balance + delta);
    account.ageing = ageingFor(account.balance, monthlyCharges(unit));
    account.status = statusFor(account.balance, account.ageing, account.status === 'arrangement' ? 'arrangement' : undefined);
  }

  /** Keeps each scheme's "N receipts to allocate" work item in step with the receipts. */
  private syncReceiptWork(): void {
    this.workItems = this.workItems.map((w) => {
      if (w.type !== 'receipt-allocation') return w;
      const open = this.receipts.filter((r) => r.schemeId === w.schemeId && r.status === 'unallocated');
      const amount = round2(open.reduce((s, r) => s + r.amount, 0));
      return {
        ...w,
        count: open.length,
        amount,
        title: open.length === 1 ? '1 receipt to allocate' : `${open.length} receipts to allocate`,
        status: open.length === 0 ? 'done' : 'open',
      };
    });
  }

  private push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  }

  private seedReceipts(): Receipt[] {
    const receipts: Receipt[] = [];
    const bank: Record<string, string> = {
      'kingfisher-court': 'FNB Trust ••4471',
      'the-willows': 'Nedbank Trust ••0932',
      'waterkloof-ridge': 'ABSA Trust ••7718',
    };
    const add = (schemeId: string, amount: number, reference: string, payer: string, ago: number) =>
      receipts.push({
        id: `rcpt-${receipts.length + 1}`,
        schemeId,
        bankAccount: bank[schemeId] ?? 'Standard Bank Trust ••2205',
        date: daysAgo(ago, 9 + (receipts.length % 6)),
        amount,
        reference,
        payer,
        status: 'unallocated',
        allocations: [],
      });

    // Kingfisher Court — the demo story.
    add('kingfisher-court', 3480, 'ANELE M', 'A MTHEMBU', 2);
    add('kingfisher-court', 2000, 'UNIT 31', 'L NDLOVU', 1);
    const kcLevy = this.units.filter((u) => u.schemeId === 'kingfisher-court').find((u, i, all) => all.filter((x) => x.monthlyLevy === u.monthlyLevy).length > 1);
    add('kingfisher-court', kcLevy?.monthlyLevy ?? 2950, 'LEVY OCT', '', 1);
    add('kingfisher-court', 6500, 'KC17 RENT OCT', 'R BOTHA', 2);
    add('kingfisher-court', 1840, 'J SMITH 0821234567', 'J SMITH', 3);

    // The Willows (4) and Waterkloof Ridge (8): generated from real accounts.
    const generic = (schemeId: string, count: number) => {
      const r = seeded('receipts-' + schemeId);
      const units = this.units.filter((u) => u.schemeId === schemeId);
      for (let i = 0; i < count; i++) {
        const unit = units[Math.floor(r() * units.length)];
        const owner = this.owners(unit.id)[0];
        const style = i % 4;
        const reference =
          style === 0 ? `${this.scheme(schemeId).code}${unit.number}` : style === 1 ? `${owner.lastName.toUpperCase()} LEVY` : style === 2 ? `UNIT ${unit.number} OCT` : 'CASH DEPOSIT';
        const amount = style === 3 ? round2(500 + r() * 2500) : unit.monthlyLevy;
        add(schemeId, amount, reference, style === 3 ? '' : `${owner.firstName[0]} ${owner.lastName}`.toUpperCase(), 1 + (i % 3));
      }
    };
    generic('the-willows', 4);
    generic('waterkloof-ridge', 8);

    // Receipts already matched automatically this week, linked to real ledger payments.
    const paidAccounts = [...this.accounts.values()].filter((a) => a.balance === 0 && !a.debitOrder).slice(0, 400);
    const r = seeded('auto-receipts');
    for (let i = 0; i < 14; i++) {
      const account = paidAccounts[Math.floor(r() * paidAccounts.length)];
      const payment = this.ledger(account.id).transactions.filter((t) => t.type === 'payment').at(-1);
      if (!payment || receipts.some((x) => x.allocations[0]?.accountId === account.id)) continue;
      const holder = this.persons.get(account.holderPersonId)!;
      const receipt: Receipt = {
        id: `rcpt-${receipts.length + 1}`,
        schemeId: account.schemeId,
        bankAccount: bank[account.schemeId] ?? 'Standard Bank Trust ••2205',
        date: payment.date,
        amount: -payment.amount,
        reference: payment.reference ?? account.accountNo,
        payer: `${holder.firstName[0]} ${holder.lastName}`.toUpperCase(),
        status: 'allocated',
        allocations: [{ accountId: account.id, amount: -payment.amount }],
        allocatedBy: 'Humo PM (automatic match)',
        autoMatched: true,
      };
      payment.receiptId = receipt.id;
      receipts.push(receipt);
    }
    return receipts;
  }
}
