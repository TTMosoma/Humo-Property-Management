import contract from '../../../../../../contracts/entitlements.json';
import { FEATURES, PACKAGES } from './entitlement';

/**
 * The API resolves entitlements from `contracts/entitlements.json`. If this
 * fails, the frontend and the backend disagree about what a package includes:
 * update the contract file in the same change (docs/23 §1).
 */
describe('Entitlements contract (frontend ⇄ API)', () => {
  it('lists every feature the same way', () => {
    expect(contract.features).toEqual(FEATURES.map((f) => ({ key: f.key, module: f.module, label: f.label, description: f.description, baseline: !!f.baseline })));
  });

  it('gives every package the same features', () => {
    expect(contract.packages).toEqual(PACKAGES.map((p) => ({ id: p.id, product: p.product, name: p.name, tagline: p.tagline, extends: p.extends ?? null, features: p.features })));
  });
});
