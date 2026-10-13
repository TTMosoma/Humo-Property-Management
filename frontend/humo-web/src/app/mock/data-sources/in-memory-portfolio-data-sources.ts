import { Injectable, inject } from '@angular/core';
import { Observable, defer, map, switchMap, throwError } from 'rxjs';
import { AccountDataSource, ApiError, NewReceipt, StatementImportBatch, StatementImportResult, StatementLine, StatementMapping, StatementPreview, mappingProblems, parseCsv, readStatement, AccountDetail, FieldErrors, ListQuery, MatchView, NewRelationship, Note, Page, Person, PersonDataSource, PersonDetails, PersonSummary, ReceiptDataSource, ReceiptView, StatementView, TimelineDataSource, TimelineEvent, Unit, UnitDataSource, UnitDetails, UnitSummary, periodLabel, roundRands, todaySA, saDate } from '../../domain';
import { CommsStore } from '../db/comms-store';
import { ReceiptImportStore } from '../db/receipt-import-store';
import { LevyStore } from '../db/levy-store';
import { round2 } from '../db/random';
import { formatRand } from '../../ui/format/money';
import { MockAuthSession } from '../server/mock-auth-session';
import { MockDb } from '../db/mock-db';
import { mockResponder } from '../mock-latency';
import { toPage } from '../mock-page';
import { CommandSpec, MockGateway } from '../server/mock-gateway';

/** docs/22 §1: a receipt's date can't be in the future or more than 12 months old. */
function receiptDateProblem(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Enter the date the money arrived.';
  const today = todaySA();
  const yearAgo = saDate(new Date(Date.now() - 365 * 86_400_000));
  if (date > today) return 'The date can’t be in the future.';
  if (date < yearAgo) return 'That’s more than 12 months ago. Older receipts need a journal on the account instead.';
  return null;
}

/** Bank receipts are stored as a moment; a deposit's date reads as 09:00 that day. */
function atNine(date: string): string {
  return new Date(`${date.slice(0, 10)}T09:00:00`).toISOString();
}

/** Re-runs a query whenever the mock database changes, with simulated latency. */
function live<T>(db: MockDb, respond: <V>(v: V) => Observable<V>, query: () => T): Observable<T> {
  return db.changes$.pipe(switchMap(() => respond(query())));
}

/** Searches answer instantly (they run on every keystroke). */
function instant<T>(db: MockDb, query: () => T): Observable<T> {
  return db.changes$.pipe(map(() => query()));
}

const OCCUPANCY: Unit['occupancy'][] = ['owner-occupied', 'tenanted', 'vacant'];

@Injectable()
export class InMemoryUnitDataSource extends UnitDataSource {
  private readonly db = inject(MockDb);
  private readonly levies = inject(LevyStore);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  create(schemeId: string, details: UnitDetails): Observable<string> {
    const scheme = this.db.schemes.get(schemeId);
    return this.gateway.command(
      {
        action: `Added unit ${details.number} to ${scheme?.name ?? schemeId}`,
        resource: 'Unit',
        schemeId,
        permission: 'Units.Manage',
        validate: () => this.check(schemeId, details, null),
      },
      () => this.db.addUnit(schemeId, this.clean(details)).id,
    );
  }

  update(unitId: string, details: UnitDetails, expectedVersion?: number): Observable<void> {
    const unit = this.db.unitById.get(unitId);
    return this.gateway
      .command(
        {
          action: `Updated unit ${details.number} (${unit?.accountNo ?? unitId})`,
          resource: 'Unit',
          resourceId: unitId,
          schemeId: unit?.schemeId,
          amount: details.monthlyLevy,
          permission: 'Units.Manage',
          version: { expected: expectedVersion, current: unit?.version },
          validate: (): FieldErrors | null => {
            if (!unit) return { number: 'That unit no longer exists.' };
            // D13: in a scheme whose levies come from the budget, the levy changes only by applying a levy roll.
            if (this.levies.setting(unit.schemeId).method === 'budget' && Math.abs(roundRands(Number(details.monthlyLevy)) - unit.monthlyLevy) > 0.005) {
              return { monthlyLevy: 'This scheme’s levies come from its approved budget. Change them by applying a levy roll (Levies & billing › How levies are set).' };
            }
            return this.check(unit.schemeId, details, unitId);
          },
        },
        // The unit number is part of the account number, so it doesn't change once the unit exists.
        () => this.db.changeUnit(unitId, (u) => ({ ...u, ...this.clean({ ...details, number: u.number }) })),
      )
      .pipe(map(() => undefined));
  }

  private clean(d: UnitDetails): UnitDetails {
    return {
      number: d.number.trim(),
      block: d.block?.trim() || undefined,
      description: d.description.trim(),
      sizeM2: Number(d.sizeM2),
      participationQuota: Number(d.participationQuota),
      monthlyLevy: roundRands(Number(d.monthlyLevy)),
      occupancy: d.occupancy,
    };
  }

  private check(schemeId: string, d: UnitDetails, id: string | null): FieldErrors {
    const e: FieldErrors = {};
    const scheme = this.db.schemes.get(schemeId);
    if (!scheme) return { number: 'That scheme no longer exists.' };
    if (scheme.status === 'archived' || scheme.status === 'closed') e['number'] = `${scheme.name} is ${scheme.status}; reopen it to change its units.`;
    if (!/^[A-Za-z0-9-]{1,6}$/.test(d.number.trim())) e['number'] = 'Use the unit number as people say it, e.g. 42 or 12B.';
    else if (!id && this.db.findUnit(schemeId, d.number.trim())) e['number'] = `There’s already a unit ${d.number.trim()} in ${scheme.name}.`;
    if (d.description.trim().length < 2) e['description'] = 'Describe the unit, e.g. 2-bed apartment.';
    if (!(Number(d.sizeM2) > 0)) e['sizeM2'] = 'Enter the size in square metres.';
    if (!(Number(d.participationQuota) > 0 && Number(d.participationQuota) <= 100)) e['participationQuota'] = 'Enter the participation quota as a percentage (0–100).';
    if (!(Number(d.monthlyLevy) >= 0)) e['monthlyLevy'] = 'Enter the monthly levy in rands.';
    if (!OCCUPANCY.includes(d.occupancy)) e['occupancy'] = 'Choose who lives there.';
    return e;
  }

  list(schemeIds: string[], query?: ListQuery): Observable<Page<UnitSummary>> {
    return live(this.db, this.respond, () => toPage(this.db.unitsIn(schemeIds), query));
  }

  get(schemeId: string, unitNumber: string): Observable<UnitSummary | undefined> {
    return live(this.db, this.respond, () => {
      const unit = this.db.findUnit(schemeId, unitNumber);
      return unit ? this.db.unitSummary(unit) : undefined;
    });
  }

  byId(unitId: string): Observable<UnitSummary | undefined> {
    return live(this.db, this.respond, () => {
      const unit = this.db.units.find((u) => u.id === unitId);
      return unit ? this.db.unitSummary(unit) : undefined;
    });
  }

  search(query: string, schemeIds: string[], limit?: number): Observable<UnitSummary[]> {
    return instant(this.db, () => this.db.searchUnits(query, schemeIds, limit));
  }
}

@Injectable()
export class InMemoryPersonDataSource extends PersonDataSource {
  private readonly db = inject(MockDb);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  create(details: PersonDetails, link?: NewRelationship): Observable<string> {
    return this.gateway.command(
      {
        action: `Added ${details.firstName} ${details.lastName}${link ? ` as ${link.type}` : ''}`,
        resource: 'Person',
        schemeId: link?.schemeId,
        permission: 'People.Manage',
        validate: () => ({ ...this.checkPerson(details, null), ...(link ? this.checkLink(link, null) : {}) }),
      },
      () => {
        const id = this.db.nextId('per');
        this.db.addPerson({ id, version: 1, ...this.cleanPerson(details) });
        if (link) this.db.addRelationship({ id: this.db.nextId('rel'), personId: id, ...link });
        return id;
      },
    );
  }

  update(personId: string, details: PersonDetails, expectedVersion?: number): Observable<void> {
    const p = this.db.persons.get(personId);
    return this.gateway
      .command(
        {
          action: `Updated contact details for ${details.firstName} ${details.lastName}`,
          resource: 'Person',
          resourceId: personId,
          permission: 'People.Manage',
          version: { expected: expectedVersion, current: p?.version },
          validate: () => this.checkPerson(details, personId),
        },
        () => this.db.changePerson(personId, (x) => ({ ...x, ...this.cleanPerson(details) })),
      )
      .pipe(map(() => undefined));
  }

  addRelationship(personId: string, link: NewRelationship): Observable<void> {
    const p = this.db.persons.get(personId);
    return this.gateway
      .command(
        {
          action: `Linked ${p?.displayName ?? personId} as ${link.type}${link.unitId ? ` of ${this.db.unitById.get(link.unitId)?.accountNo}` : ''}`,
          resource: 'Relationship',
          resourceId: personId,
          schemeId: link.schemeId,
          permission: 'People.Manage',
          validate: () => (p ? this.checkLink(link, personId) : { type: 'That person no longer exists.' }),
        },
        () => this.db.addRelationship({ id: this.db.nextId('rel'), personId, ...link }),
      )
      .pipe(map(() => undefined));
  }

  endRelationship(relationshipId: string, until: string): Observable<void> {
    const r = this.db.relationship(relationshipId);
    return this.gateway
      .command(
        {
          action: `Ended ${r?.type ?? 'relationship'} of ${r ? this.db.persons.get(r.personId)?.displayName : relationshipId} (${until.slice(0, 10)})`,
          resource: 'Relationship',
          resourceId: relationshipId,
          schemeId: r?.schemeId,
          permission: 'People.Manage',
          validate: (): FieldErrors | null => {
            if (!r) return { until: 'That relationship no longer exists.' };
            if (!/^\d{4}-\d{2}-\d{2}/.test(until) || until.slice(0, 10) < r.since.slice(0, 10)) return { until: 'Choose a date on or after it started.' };
            return null;
          },
        },
        () => void this.db.endRelationship(relationshipId, until),
      )
      .pipe(map(() => undefined));
  }

  private cleanPerson(d: PersonDetails): Omit<Person, 'id' | 'version'> {
    const first = d.firstName.trim();
    const last = d.lastName.trim();
    const display = d.kind === 'individual' ? `${first} ${last}` : last || first;
    const initials = d.kind === 'individual' ? `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase() : display.slice(0, 2).toUpperCase();
    return { firstName: first, lastName: last, kind: d.kind, displayName: display, initials, email: d.email.trim(), phone: d.phone.trim(), preferredChannel: d.preferredChannel, postalAddress: d.postalAddress?.trim() || undefined };
  }

  private checkPerson(d: PersonDetails, id: string | null): FieldErrors {
    const e: FieldErrors = {};
    if (d.kind === 'individual' && d.firstName.trim().length < 1) e['firstName'] = 'Enter their first name.';
    if (d.lastName.trim().length < 2) e['lastName'] = d.kind === 'individual' ? 'Enter their surname.' : 'Enter the registered name.';
    if (d.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email.trim())) e['email'] = 'That doesn’t look like an email address.';
    else if (d.email.trim() && [...this.db.persons.values()].some((p) => p.id !== id && p.email.toLowerCase() === d.email.trim().toLowerCase())) e['email'] = 'Someone else in the directory already has this email.';
    if (!d.email.trim() && !d.phone.trim()) e['phone'] = 'Give at least a phone number or an email address.';
    if (d.preferredChannel === 'email' && !d.email.trim()) e['preferredChannel'] = 'Email is preferred, but there’s no email address.';
    return e;
  }

  private checkLink(l: NewRelationship, personId: string | null): FieldErrors {
    const e: FieldErrors = {};
    const scheme = this.db.schemes.get(l.schemeId);
    if (!scheme) return { schemeId: 'Choose the scheme.' };
    if (scheme.status === 'archived') e['schemeId'] = `${scheme.name} is archived.`;
    if (l.type === 'trustee') {
      // D2: trustees are appointed on the board (BoardDataSource), never linked as a relationship here.
      e['type'] = 'Trustees are appointed on the scheme’s board, from a resolution or by co-option.';
    } else {
      const unit = l.unitId ? this.db.unitById.get(l.unitId) : undefined;
      if (!unit || unit.schemeId !== l.schemeId) e['unitId'] = 'Choose the unit.';
      else if (l.type === 'tenant' && this.db.tenant(unit.id)) e['unitId'] = `Unit ${unit.number} already has a tenant. End that lease first.`;
      else if (personId && l.type === 'owner' && this.db.owners(unit.id).some((o) => o.id === personId)) e['unitId'] = 'They already own this unit.';
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(l.since)) e['since'] = 'Choose the date it started.';
    if (l.until && l.until < l.since) e['until'] = 'The lease can’t end before it starts.';
    return e;
  }

  list(schemeIds: string[], query?: ListQuery): Observable<Page<PersonSummary>> {
    return live(this.db, this.respond, () => toPage(this.db.peopleIn(schemeIds), query));
  }

  get(personId: string): Observable<PersonSummary | undefined> {
    return live(this.db, this.respond, () => {
      const p = this.db.persons.get(personId);
      return p ? this.db.personSummary(p) : undefined;
    });
  }

  search(query: string, schemeIds: string[], limit?: number): Observable<PersonSummary[]> {
    return instant(this.db, () => this.db.searchPeople(query, schemeIds, limit));
  }
}

@Injectable()
export class InMemoryAccountDataSource extends AccountDataSource {
  private readonly db = inject(MockDb);
  private readonly comms = inject(CommsStore);
  private readonly session = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  get(accountId: string): Observable<AccountDetail | undefined> {
    return live(this.db, this.respond, () => this.db.accountDetail(accountId));
  }

  statement(accountId: string, period: string): Observable<StatementView | undefined> {
    return live(this.db, this.respond, () => this.db.statement(accountId, period));
  }

  /** SIMULATED (docs/18 R-1): recorded in Sent with a simulated delivery; nothing leaves the browser. */
  sendStatement(accountId: string, period: string): Observable<string> {
    const v = this.db.statement(accountId, period);
    return this.gateway.command(
      {
        action: `Emailed the ${periodLabel(period)} statement for ${v?.account.accountNo ?? accountId}`,
        resource: 'Account',
        resourceId: accountId,
        permission: 'Collections.Manage',
        validate: (): FieldErrors | null => (!v ? { period: 'There’s no statement for that period.' } : !v.holder.email ? { email: `${v.holder.displayName} has no email address. Add one on their person record.` } : null),
      },
      () => {
        const to = this.comms.holderOf(accountId)!;
        return this.comms.record({
          kind: 'statement',
          schemeId: v!.scheme.id,
          subject: `Your ${v!.scheme.name} levy statement: ${periodLabel(period)}`,
          body: 'Dear {person.name},\n\nYour levy statement for unit {unit.number} is in the resident portal. The balance owing is {account.balance}.\n\nKind regards,\n{agency.name}',
          channels: ['email'],
          audienceLabel: `${v!.holder.displayName} · ${v!.account.accountNo}`,
          by: this.session.current.identity.name,
          to: [{ ...to, channel: 'email' }],
          source: { label: `Statement ${periodLabel(period)} · ${v!.account.accountNo}`, route: `/schemes/${v!.scheme.id}/units/${v!.unit.number}/account/statements/${period}` },
        });
      },
    );
  }
}

@Injectable()
export class InMemoryReceiptDataSource extends ReceiptDataSource {
  private readonly db = inject(MockDb);
  private readonly importStore = inject(ReceiptImportStore);
  private readonly session = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  list(schemeIds: string[], query?: ListQuery): Observable<Page<ReceiptView>> {
    return live(this.db, this.respond, () => toPage(this.db.receiptViews(schemeIds), query));
  }

  matches(receiptId: string): Observable<MatchView[]> {
    return instant(this.db, () => this.db.matches(receiptId));
  }

  suggestedFor(accountId: string): Observable<ReceiptView[]> {
    return instant(this.db, () => this.db.suggestedFor(accountId));
  }

  allocate(receiptId: string, allocations: { accountId: string; amount: number }[], rememberPayer: boolean, expectedVersion?: number): Observable<void> {
    const amount = allocations.reduce((n, a) => n + a.amount, 0);
    const to = allocations.map((a) => this.db.accounts.get(a.accountId)?.accountNo ?? a.accountId).join(', ');
    return this.command({ action: `Allocated receipt to ${to}`, amount, ...this.receiptSpec(receiptId, expectedVersion) }, () => this.db.allocate(receiptId, allocations, rememberPayer, this.session.current.identity.name));
  }

  unallocate(receiptId: string, expectedVersion?: number): Observable<void> {
    return this.command({ action: 'Reversed receipt allocation', ...this.receiptSpec(receiptId, expectedVersion) }, () => this.db.unallocate(receiptId));
  }

  moveToSuspense(receiptId: string, expectedVersion?: number): Observable<void> {
    return this.command({ action: 'Moved receipt to suspense', ...this.receiptSpec(receiptId, expectedVersion) }, () => this.db.moveToSuspense(receiptId, this.session.current.identity.name));
  }

  // ---- docs/22 §1: capture and bank-statement import

  capture(input: NewReceipt): Observable<string> {
    const reference = input.reference.trim();
    return this.gateway.command(
      {
        action: `Captured a receipt of ${formatRand(input.amount)} (“${reference}”)`,
        resource: 'Receipt',
        amount: input.amount,
        schemeId: input.schemeId,
        permission: 'Receipts.Allocate',
        validate: (): FieldErrors | null => {
          const e: FieldErrors = {};
          if (!this.db.schemes.has(input.schemeId)) e['schemeId'] = 'Choose the scheme.';
          const dateProblem = receiptDateProblem(input.date);
          if (dateProblem) e['date'] = dateProblem;
          if (!(input.amount > 0)) e['amount'] = 'Enter the amount received.';
          if (reference.length < 2) e['reference'] = 'Enter the reference exactly as it appears on the bank statement.';
          if (!Object.keys(e).length && this.existingKeys(input.schemeId).has(this.db.receiptKey(input.schemeId, input.date, input.amount, reference))) {
            e['reference'] = 'This receipt is already captured (same date, amount and reference).';
          }
          return Object.keys(e).length ? e : null;
        },
      },
      () =>
        this.db.addReceipts([
          {
            schemeId: input.schemeId,
            bankAccount: this.db.bankAccountLabel(input.schemeId),
            date: atNine(input.date),
            amount: round2(input.amount),
            reference,
            payer: input.payer?.trim() ?? '',
            source: 'captured',
            capturedBy: this.session.current.identity.name,
          },
        ])[0],
    );
  }

  statementMapping(schemeId: string): Observable<StatementMapping | undefined> {
    return this.respond(this.importStore.mappings().get(schemeId));
  }

  previewStatement(schemeId: string, fileName: string, csv: string, mapping: StatementMapping): Observable<StatementPreview> {
    return defer(() => {
      const problems = this.statementProblems(schemeId, csv, mapping);
      if (problems) return throwError(() => new ApiError('validation', 'The file or mapping needs attention', problems));
      return this.respond(this.preview(schemeId, fileName, csv, mapping));
    });
  }

  importStatement(schemeId: string, fileName: string, csv: string, mapping: StatementMapping): Observable<StatementImportResult> {
    return this.gateway.command(
      {
        action: `Imported bank statement “${fileName}”`,
        resource: 'Bank statement',
        schemeId,
        permission: 'Receipts.Allocate',
        validate: () => this.statementProblems(schemeId, csv, mapping),
      },
      (): StatementImportResult => {
        const p = this.preview(schemeId, fileName, csv, mapping);
        const by = this.session.current.identity.name;
        const bankAccount = this.db.bankAccountLabel(schemeId);
        const counts = { imported: p.receipts.length, duplicates: p.duplicates.length, debits: p.debits, invalid: p.invalid.length, total: p.total };
        const batchId = this.importStore.record({ schemeId, bankAccount, fileName, at: new Date().toISOString(), by, ...counts });
        this.db.addReceipts(
          p.receipts.map((l) => ({
            schemeId,
            bankAccount,
            date: atNine(l.date!),
            amount: l.amount!,
            reference: l.reference ?? '',
            payer: l.payer ?? '',
            source: 'statement-import' as const,
            importBatchId: batchId,
            capturedBy: by,
          })),
        );
        this.importStore.remember(schemeId, mapping);
        return { batchId, ...counts };
      },
    );
  }

  imports(schemeIds: string[]): Observable<StatementImportBatch[]> {
    const ids = new Set(schemeIds);
    return this.db.changes$.pipe(switchMap(() => this.respond(this.importStore.batches().filter((b) => ids.has(b.schemeId)))));
  }

  remove(receiptId: string, reason: string, expectedVersion?: number): Observable<void> {
    const r = this.db.receipts.find((x) => x.id === receiptId);
    return this.command(
      {
        action: `Removed receipt ${formatRand(r?.amount ?? 0)} (“${r?.reference ?? receiptId}”) — ${reason.trim()}`,
        ...this.receiptSpec(receiptId, expectedVersion),
        validate: (): FieldErrors | null => {
          if (!r) return { receiptId: 'That receipt no longer exists.' };
          if (r.status !== 'unallocated') return { status: r.status === 'allocated' ? 'It’s allocated. Reverse the allocation first.' : 'Only an unallocated receipt can be removed.' };
          return reason.trim().length < 5 ? { reason: 'Say why, in a few words. It goes in the audit log.' } : null;
        },
      },
      () => this.db.removeReceipt(receiptId),
    );
  }

  private existingKeys(schemeId: string): Set<string> {
    return new Set(this.db.receipts.filter((r) => r.schemeId === schemeId).map((r) => this.db.receiptKey(schemeId, r.date, r.amount, r.reference)));
  }

  private statementProblems(schemeId: string, csv: string, mapping: StatementMapping): FieldErrors | null {
    if (!this.db.schemes.has(schemeId)) return { schemeId: 'Choose the scheme.' };
    const rows = parseCsv(csv);
    if (rows.length < 2) return { file: 'The file has no rows under the header.' };
    const e = mappingProblems(rows[0], mapping);
    return Object.keys(e).length ? e : null;
  }

  /** The import's outcome, row by row. Dates outside the allowed range count as rows that can't be read. */
  private preview(schemeId: string, fileName: string, csv: string, mapping: StatementMapping): StatementPreview {
    const rows = parseCsv(csv);
    const lines = readStatement(rows, mapping).map((l) => {
      const dateProblem = l.date && l.kind === 'credit' ? receiptDateProblem(l.date) : null;
      return dateProblem ? { ...l, kind: 'invalid' as const, problem: dateProblem } : l;
    });
    const seen = this.existingKeys(schemeId);
    const receipts: StatementLine[] = [];
    const duplicates: StatementLine[] = [];
    for (const l of lines.filter((x) => x.kind === 'credit')) {
      const key = this.db.receiptKey(schemeId, l.date!, l.amount!, l.reference ?? '');
      if (seen.has(key)) duplicates.push(l);
      else {
        seen.add(key);
        receipts.push(l);
      }
    }
    return {
      fileName,
      header: rows[0] ?? [],
      receipts,
      duplicates,
      debits: lines.filter((l) => l.kind === 'debit').length,
      invalid: lines.filter((l) => l.kind === 'invalid'),
      total: round2(receipts.reduce((sum, l) => sum + (l.amount ?? 0), 0)),
    };
  }

  /** Commands apply only after the simulated request succeeds (and the API's policy allows them). */
  private command(spec: CommandSpec, apply: () => void): Observable<void> {
    return this.gateway.command(spec, apply).pipe(map(() => undefined));
  }

  private receiptSpec(receiptId: string, expectedVersion?: number): Omit<CommandSpec, 'action'> {
    const r = this.db.receipts.find((x) => x.id === receiptId);
    return { resource: 'Receipt', resourceId: receiptId, amount: r?.amount, schemeId: r?.schemeId, permission: 'Receipts.Allocate', version: { expected: expectedVersion, current: r?.version } };
  }
}

@Injectable()
export class InMemoryTimelineDataSource extends TimelineDataSource {
  private readonly db = inject(MockDb);
  private readonly session = inject(MockAuthSession);
  private readonly gateway = inject(MockGateway);
  private readonly respond = mockResponder();

  forUnit(unitId: string): Observable<TimelineEvent[]> {
    return live(this.db, this.respond, () => this.db.timelineForUnit(unitId));
  }

  forPerson(personId: string): Observable<TimelineEvent[]> {
    return live(this.db, this.respond, () => this.db.timelineForPerson(personId));
  }

  addNote(note: Omit<Note, 'id' | 'at' | 'author'>): Observable<void> {
    return this.gateway
      .command({ action: 'Logged a note', resource: 'Note', permission: 'Notes.Add' }, () => this.db.addNote(note, this.session.current.identity.name))
      .pipe(map(() => undefined));
  }
}
