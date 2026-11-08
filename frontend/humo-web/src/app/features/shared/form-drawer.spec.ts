import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { StepUpService } from '../../core/security/step-up.service';
import { FormDrawer, FormField, FormSpec } from './form-drawer';

// Ionic's components can't load in the test runner: a stand-in icon.
vi.mock('@ionic/angular/standalone', async () => (await import('../../testing-ionic')).ionicStandin());

const RULES = [
  { value: 'r-1', label: '1.1 Pets' },
  { value: 'r-2', label: '2.1 Parking' },
];

describe('FormDrawer lists', () => {
  function open(field: Partial<FormField>, initial?: Record<string, string>) {
    const submit = vi.fn(() => of(undefined));
    const spec: FormSpec = { eyebrow: '', title: 'A form', fields: [{ key: 'rule', label: 'Rule', type: 'select', ...field }], initial, submitLabel: 'Save', submit, success: () => 'Saved', failure: 'Not saved' };
    TestBed.configureTestingModule({ imports: [FormDrawer], providers: [provideRouter([]), { provide: DIALOG_DATA, useValue: spec }, { provide: DialogRef, useValue: { close: vi.fn() } }, { provide: FeedbackService, useValue: { success: vi.fn(), error: vi.fn() } }, { provide: StepUpService, useValue: {} }] });
    const fixture = TestBed.createComponent(FormDrawer);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const select = () => el.querySelector('select') as HTMLSelectElement;
    return {
      submit,
      select,
      labels: () => [...select().options].map((o) => o.text.trim()),
      save: () => {
        (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
        fixture.detectChanges();
      },
      pick: (value: string) => {
        select().value = value;
        select().dispatchEvent(new Event('change'));
        fixture.detectChanges();
      },
      text: () => el.textContent ?? '',
    };
  }

  it('starts a required list with nothing chosen on “Choose…”, so its first option can be picked', () => {
    const f = open({ required: true, options: RULES });
    expect(f.labels()).toEqual(['Choose…', '1.1 Pets', '2.1 Parking']);
    expect(f.select().value).toBe('');

    f.save();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.text()).toContain('Rule is needed.');

    f.pick('r-1');
    expect(f.labels()).toEqual(['1.1 Pets', '2.1 Parking']);
    f.save();
    expect(f.submit).toHaveBeenCalledWith({ rule: 'r-1' }, {});
  });

  it('lets a list of one be chosen', () => {
    const f = open({ required: true, options: [RULES[0]] });
    expect(f.labels()).toEqual(['Choose…', '1.1 Pets']);
    f.pick('r-1');
    f.save();
    expect(f.submit).toHaveBeenCalledWith({ rule: 'r-1' }, {});
  });

  it('shows a value chosen in advance, with no empty entry', () => {
    const f = open({ required: true, options: RULES }, { rule: 'r-2' });
    expect(f.labels()).toEqual(['1.1 Pets', '2.1 Parking']);
    expect(f.select().value).toBe('r-2');
    f.save();
    expect(f.submit).toHaveBeenCalledWith({ rule: 'r-2' }, {});
  });

  it('asks again when the chosen value is no longer on offer', () => {
    const f = open({ required: true, optionsFor: () => [RULES[0]] }, { rule: 'r-2' });
    expect(f.labels()).toEqual(['Choose…', '1.1 Pets']);
    f.save();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.text()).toContain('Rule is needed.');
  });

  it('adds no second empty entry to a list with its own', () => {
    expect(open({ required: true, options: [{ value: '', label: 'Choose the resolution' }, ...RULES] }).labels()).toEqual(['Choose the resolution', '1.1 Pets', '2.1 Parking']);
    TestBed.resetTestingModule();
    expect(open({ options: [{ value: '', label: 'Captured from the registered rules' }, ...RULES] }, { rule: '' }).labels()).toEqual(['Captured from the registered rules', '1.1 Pets', '2.1 Parking']);
  });

  it('keeps the dash on an optional list', () => {
    expect(open({ options: RULES }).labels()).toEqual(['—', '1.1 Pets', '2.1 Parking']);
  });
});
