import contract from '../../../../../../contracts/role-permissions.json';
import { PERMISSIONS, ROLE_PERMISSIONS } from './permission';

/**
 * The API reads the same table from `contracts/role-permissions.json`. If this
 * fails, the frontend and the backend disagree about who may do what: update
 * the contract file in the same change (D4: fixed roles, every check by permission).
 */
describe('Role permissions contract (frontend ⇄ API)', () => {
  it('lists every permission with the same mutates and step-up flags', () => {
    expect(contract.permissions).toEqual(PERMISSIONS.map((p) => ({ id: p.id, mutates: p.mutates, stepUp: !!p.stepUp })));
  });

  it('gives every role the same permissions', () => {
    expect(contract.roles).toEqual(Object.fromEntries(Object.entries(ROLE_PERMISSIONS).map(([role, list]) => [role, [...list]])));
  });
});
