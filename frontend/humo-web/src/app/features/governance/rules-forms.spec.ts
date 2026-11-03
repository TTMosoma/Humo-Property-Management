import { of } from 'rxjs';
import { ResolutionView, RulesDataSource, RulesView, SchemeRule } from '../../domain';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { FormField, FormSpec } from '../shared/form-drawer';
import { amendRuleForm, repealRuleForm } from './rules-forms';

// Ionic's components can't load in the test runner: a stand-in icon.
vi.mock('@ionic/angular/standalone', async () => {
  const { Component } = await import('@angular/core');
  // No decorator syntax: its helper isn't loaded yet when this runs ahead of the imports, in specs sharing form-drawer.
  return { IonIcon: Component({ selector: 'ion-icon', template: '', inputs: ['name'] })(class {}) };
});

const rule = { id: 'r-1', number: '2.1', title: 'Parking', versions: [{ text: 'Old wording of the parking rule.' }] } as unknown as SchemeRule;
const view = { scheme: { id: 's-1', name: 'Kingfisher Court' } } as unknown as RulesView;
const passed = { resolution: { id: 'res-1', ref: 'RES-KC-1', title: 'Parking', outcome: 'passed', decidedAt: '2026-03-12' } } as unknown as ResolutionView;

function amend(resolutions: ResolutionView[] | null) {
  let spec!: FormSpec;
  const drawer = { open: (_c: unknown, s: FormSpec) => (spec = s) } as unknown as DrawerService;
  const actRules = vi.fn(() => of(undefined));
  amendRuleForm(drawer, { actRules } as unknown as RulesDataSource, view, rule, resolutions);
  return { spec, actRules, field: (key: string) => spec.fields.find((f) => f.key === key) as FormField };
}

describe('citing a resolution on a rule (D31)', () => {
  it('offers the passed resolutions and one that isn’t in the register, with nothing chosen for you', () => {
    const { field } = amend([passed]);
    expect(field('resolutionId').options!.map((o) => o.value)).toEqual(['', 'res-1', 'not-in-register']);
    expect(field('resolutionId').help).toBeUndefined();
  });

  it('can still be typed when the scheme has no passed resolutions', () => {
    const { field } = amend([]);
    expect(field('resolutionId').options!.map((o) => o.value)).toEqual(['', 'not-in-register']);
    expect(field('resolutionId').help).toContain('No passed resolutions');
  });

  it('asks for the wording and the date only when it isn’t in the register', () => {
    const { field } = amend([passed]);
    for (const key of ['resolutionRef', 'adoptedOn']) {
      expect(field(key).required).toBe(true);
      expect(field(key).showIf!({ resolutionId: 'res-1' })).toBe(false);
      expect(field(key).showIf!({ resolutionId: 'not-in-register' })).toBe(true);
    }
  });

  it('sends what was typed, not the list’s choice', () => {
    const { spec, actRules } = amend([passed]);
    spec.submit({ text: 'New wording', resolutionId: 'not-in-register', resolutionRef: 'AGM 12 March 2026, special resolution 2', adoptedOn: '2026-03-12' }, {});
    expect(actRules).toHaveBeenCalledWith('s-1', { type: 'amend', ruleId: 'r-1', text: 'New wording', resolutionId: '', resolutionRef: 'AGM 12 March 2026, special resolution 2', adoptedOn: '2026-03-12' });
  });

  it('sends the chosen resolution alone, even after something was typed', () => {
    const { spec, actRules } = amend([passed]);
    spec.submit({ text: 'New wording', resolutionId: 'res-1', resolutionRef: 'Typed, then changed their mind', adoptedOn: '2026-03-12' }, {});
    expect(actRules).toHaveBeenCalledWith('s-1', { type: 'amend', ruleId: 'r-1', text: 'New wording', resolutionId: 'res-1' });
  });

  it('is the same on a repeal', () => {
    let spec!: FormSpec;
    const drawer = { open: (_c: unknown, s: FormSpec) => (spec = s) } as unknown as DrawerService;
    const actRules = vi.fn(() => of(undefined));
    repealRuleForm(drawer, { actRules } as unknown as RulesDataSource, view, rule, [passed]);
    spec.submit({ resolutionId: 'not-in-register', resolutionRef: 'AGM 2026, resolution 5', adoptedOn: '2026-03-12' }, {});
    expect(actRules).toHaveBeenCalledWith('s-1', { type: 'repeal', ruleId: 'r-1', resolutionId: '', resolutionRef: 'AGM 2026, resolution 5', adoptedOn: '2026-03-12' });
  });

  it('stays a text box with no register at all (D29)', () => {
    const { spec, field, actRules } = amend(null);
    expect(field('resolutionId')).toBeUndefined();
    expect(field('resolutionRef').showIf).toBeUndefined();
    spec.submit({ text: 'New wording', resolutionRef: 'AGM 2026, resolution 5', adoptedOn: '2026-03-12' }, {});
    expect(actRules).toHaveBeenCalledWith('s-1', { type: 'amend', ruleId: 'r-1', text: 'New wording', resolutionId: '', resolutionRef: 'AGM 2026, resolution 5', adoptedOn: '2026-03-12' });
  });
});
