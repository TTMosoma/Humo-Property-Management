import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideMockData } from '../provide-mock-data';
import { CollectionsStore } from './collections-store';
import { MockDb } from './mock-db';

/** D43 in the prototype: a case is closed by hand only once nothing is overdue, as on the API. */
describe('Collections store: closing a case (D43)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('humo.latency', 'off');
    TestBed.configureTestingModule({ providers: [provideMockData(), provideRouter([])] });
  });

  it('refuses while something is overdue, and closes once it’s paid', () => {
    const store = TestBed.inject(CollectionsStore);
    const db = TestBed.inject(MockDb);
    const view = store.list([...db.schemes.keys()])[0];
    const id = view.account.id;
    store.act(id, { type: 'send-letter', kind: 'reminder', channel: 'post' }, 'Priya Naidoo');

    expect(store.check(id, { type: 'close', reason: 'Owner promised to pay' })?.['stage']).toContain('still overdue');

    const account = db.accounts.get(id)!;
    account.ageing = { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 };
    account.balance = 0;
    expect(store.check(id, { type: 'close', reason: 'ok' })?.['reason']).toBeTruthy();
    expect(store.check(id, { type: 'close', reason: 'Paid in cash at the office' })).toBeNull();

    store.act(id, { type: 'close', reason: 'Paid in cash at the office' }, 'Priya Naidoo');
    const closed = store.caseFor(id);
    expect(closed.stage).toBe('not-started');
    expect(closed.steps[0].text).toBe('Closed: Paid in cash at the office');
    expect(store.check(id, { type: 'close', reason: 'Again, just in case' })?.['stage']).toContain('no collection to close');
  });
});
