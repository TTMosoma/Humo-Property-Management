import contract from '../../../../../../contracts/document-templates.json';
import { PLATFORM_TEMPLATES } from './document-catalogue';

/**
 * The API serves Humo's template catalogue from `contracts/document-templates.json`. If this
 * fails, the app and the API disagree about which templates exist or how they look: update the
 * contract file in the same change (docs/23 §1).
 */
describe('Document templates contract (frontend ⇄ API)', () => {
  it('lists the same platform templates, version for version', () => {
    expect(contract.templates).toEqual(JSON.parse(JSON.stringify(PLATFORM_TEMPLATES)));
  });

  it('has one default per document type', () => {
    const defaults = PLATFORM_TEMPLATES.filter((t) => t.isDefault).map((t) => t.documentType);
    expect(new Set(defaults).size).toBe(defaults.length);
  });
});
