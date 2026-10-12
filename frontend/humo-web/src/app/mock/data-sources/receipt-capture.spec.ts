import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { ApiError, PolicyError, ReceiptDataSource, StatementMapping, parseAmount, parseCsv, parseStatementDate, readStatement } from '../../domain';
import { AccessStore } from '../db/access-store';
import { MockDb } from '../db/mock-db';
import { provideMockData } from '../provide-mock-data';
import { MockAuthSession } from '../server/mock-auth-session';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const dmy = (iso: string) => iso.split('-').reverse().join('/');

describe('Bank statement reading (docs/22 §1)', () => {
  it('reads South African and international amounts', () => {
    expect(parseAmount('R 1 234,50')).toBe(1234.5);
    expect(parseAmount('1,234.50')).toBe(1234.5);
    expect(parseAmount('(500.00)')).toBe(-500);
    expect(parseAmount('-75')).toBe(-75);
    expect(parseAmount('abc')).toBeNull();
  });

  it('reads dates in the chosen format and refuses impossible ones', () => {
    expect(parseStatementDate('07/10/2026', 'dd/mm/yyyy')).toBe('2026-10-07');
    expect(parseStatementDate('10/07/2026', 'mm/dd/yyyy')).toBe('2026-10-07');
    expect(parseStatementDate('2026-10-07', 'yyyy-mm-dd')).toBe('2026-10-07');
    expect(parseStatementDate('31/02/2026', 'dd/mm/yyyy')).toBeNull();
  });

  it('parses quoted CSV fields, semicolons and credit/debit columns', () => {
    const rows = parseCsv('Date;Description;Credit;Debit\n07/10/2026;"KC042; levy";2950,00;\n08/10/2026;Bank fees;;45,00\n');
    expect(rows[1][1]).toBe('KC042; levy');
    const lines = readStatement(rows, { date: 'Date', dateFormat: 'dd/mm/yyyy', credit: 'Credit', debit: 'Debit', reference: 'Description' });
    expect(lines.map((l) => [l.kind, l.amount])).toEqual([
      ['credit', 2950],
      ['debit', -45],
    ]);
  });
});

describe('Receipt capture and import (docs/22 §1)', () => {
  let auth: MockAuthSession;
  let receipts: ReceiptDataSource;
  let db: MockDb;
  let access: AccessStore;
  const run = <T>(o: Observable<T>) => firstValueFrom(o);
  const KC = 'kingfisher-court';
  const mapping: StatementMapping = { date: 'Date', dateFormat: 'dd/mm/yyyy', amount: 'Amount', reference: 'Description', payer: 'Name' };
  const csv = () =>
    [
      'Date,Description,Name,Amount',
      `${dmy(day(-2))},KC042 LEVY,A MTHEMBU,"2,950.00"`,
      `${dmy(day(-2))},KC042 LEVY,A MTHEMBU,"2,950.00"`, // the same deposit twice in one file
      `${dmy(day(-1))},UNIT 12 OCT,P NAIDOO,1840.00`,
      `${dmy(day(-1))},BANK CHARGES,,-35.00`,
      `not a date,ODD ROW,,100.00`,
    ].join('\n');

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
    auth = TestBed.inject(MockAuthSession);
    receipts = TestBed.inject(ReceiptDataSource);
    db = TestBed.inject(MockDb);
    access = TestBed.inject(AccessStore);
    auth.signIn('p-priya');
  });

  it('captures a receipt, unallocated, and refuses an exact duplicate', async () => {
    const before = db.receipts.length;
    const id = await run(receipts.capture({ schemeId: KC, date: day(-1), amount: 1500, reference: 'KC007 OCT', payer: 'T NKOSI' }));
    const r = db.receipts.find((x) => x.id === id)!;
    expect(db.receipts.length).toBe(before + 1);
    expect(r).toMatchObject({ status: 'unallocated', source: 'captured', capturedBy: 'Priya Naidoo', amount: 1500 });
    expect(access.audit()[0].action).toContain('Captured a receipt');
    await expect(run(receipts.capture({ schemeId: KC, date: day(-1), amount: 1500, reference: 'kc007 oct' }))).rejects.toBeInstanceOf(ApiError);
  });

  it('refuses future dates, dates over 12 months old, and zero amounts', async () => {
    await expect(run(receipts.capture({ schemeId: KC, date: day(1), amount: 100, reference: 'FUTURE' }))).rejects.toBeInstanceOf(ApiError);
    await expect(run(receipts.capture({ schemeId: KC, date: day(-400), amount: 100, reference: 'OLD' }))).rejects.toBeInstanceOf(ApiError);
    await expect(run(receipts.capture({ schemeId: KC, date: day(-1), amount: 0, reference: 'ZERO' }))).rejects.toBeInstanceOf(ApiError);
  });

  it('previews an import: new receipts, duplicates, debits and unreadable rows', async () => {
    const p = await run(receipts.previewStatement(KC, 'oct.csv', csv(), mapping));
    expect(p.receipts.map((l) => l.reference)).toEqual(['KC042 LEVY', 'UNIT 12 OCT']);
    expect(p.duplicates.length).toBe(1);
    expect(p.debits).toBe(1);
    expect(p.invalid.length).toBe(1);
    expect(p.total).toBe(4790);
  });

  it('imports, remembers the mapping, and skips everything on a second import', async () => {
    const before = db.receipts.length;
    const r = await run(receipts.importStatement(KC, 'oct.csv', csv(), mapping));
    expect(r).toMatchObject({ imported: 2, duplicates: 1, debits: 1, invalid: 1 });
    expect(db.receipts.length).toBe(before + 2);
    expect(db.receipts.filter((x) => x.importBatchId === r.batchId).every((x) => x.status === 'unallocated' && x.source === 'statement-import')).toBe(true);
    expect(await run(receipts.statementMapping(KC))).toEqual(mapping);
    expect((await run(receipts.imports([KC])))[0]).toMatchObject({ fileName: 'oct.csv', imported: 2 });
    const again = await run(receipts.importStatement(KC, 'oct-again.csv', csv(), mapping));
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(3);
  });

  it('refuses a mapping whose columns aren’t in the file', async () => {
    await expect(run(receipts.previewStatement(KC, 'x.csv', csv(), { ...mapping, date: 'Posting date' }))).rejects.toBeInstanceOf(ApiError);
  });

  it('removes an unallocated receipt with a reason, but never an allocated one', async () => {
    const id = await run(receipts.capture({ schemeId: KC, date: day(-1), amount: 999, reference: 'MISTAKE' }));
    await expect(run(receipts.remove(id, 'no'))).rejects.toBeInstanceOf(ApiError);
    await run(receipts.remove(id, 'Captured twice by mistake'));
    expect(db.receipts.some((x) => x.id === id)).toBe(false);
    expect(access.audit()[0].action).toContain('Captured twice by mistake');
    const allocated = db.receipts.find((x) => x.status === 'allocated')!;
    await expect(run(receipts.remove(allocated.id, 'Should not be possible'))).rejects.toBeInstanceOf(ApiError);
  });

  it('needs Receipts.Allocate', async () => {
    auth.signIn('p-johan'); // Portfolio Manager: no Receipts.Allocate
    await expect(run(receipts.capture({ schemeId: KC, date: day(-1), amount: 100, reference: 'NOPE' }))).rejects.toBeInstanceOf(PolicyError);
  });
});
