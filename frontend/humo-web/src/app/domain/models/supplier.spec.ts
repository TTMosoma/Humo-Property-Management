import { Supplier, supplierCompliance, suppliersFor } from './supplier';

describe('supplierCompliance', () => {
  it('doesn’t call a supplier with no documents on record vetted', () => {
    expect(supplierCompliance({ documents: [] } as unknown as Supplier)).toBe('missing');
  });
});

describe('suppliersFor', () => {
  const supplier = (id: string, trades: Supplier['trades']) => ({ id, trades }) as Supplier;
  const job = { candidates: [supplier('plumber', ['Plumbing']), supplier('roofer', ['Roofing & waterproofing']), supplier('both', ['Plumbing', 'Building'])] };

  it('picks the scheme’s suppliers for the trade chosen, so changing the trade at triage changes the list', () => {
    expect(suppliersFor(job, 'Plumbing').map((s) => s.id)).toEqual(['plumber', 'both']);
    expect(suppliersFor(job, 'Roofing & waterproofing').map((s) => s.id)).toEqual(['roofer']);
    expect(suppliersFor(job, 'Lifts')).toEqual([]);
  });
});
