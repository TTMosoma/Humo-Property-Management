import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { IonIcon } from '@ionic/angular/standalone';
import { Observable, catchError, throwError } from 'rxjs';
import { FieldErrors, PolicyError, StepUpRequest, describeFailure, fieldErrorsOf } from '../../domain';
import { FeedbackService } from '../../core/feedback/feedback.service';
import { StepUpService } from '../../core/security/step-up.service';
import { Drawer } from '../../ui/drawer/drawer';
import { DrawerService } from '../../ui/drawer/drawer.service';
import { FieldError } from '../../ui/form/field-error';

export type FormValues = Record<string, string>;

export interface FormField {
  key: string;
  label: string;
  /** `checks`: several options; the value is the chosen values joined with commas. */
  type: 'text' | 'email' | 'tel' | 'number' | 'date' | 'textarea' | 'select' | 'color' | 'file' | 'checks' | 'datetime-local';
  /** File fields: what the picker offers, e.g. ".pdf,.jpg". */
  accept?: string;
  required?: boolean;
  /** Required only for some values of the other fields (overrides `required`), e.g. an expiry date that Compliance needs. */
  requiredIf?: (values: FormValues) => boolean;
  options?: { value: string; label: string }[];
  /** Options that depend on the other fields' values (overrides `options`). */
  optionsFor?: (values: FormValues) => { value: string; label: string }[];
  help?: string;
  placeholder?: string;
  /** Shown only when this returns true for the current values. */
  showIf?: (values: FormValues) => boolean;
  /** Two short fields share a row on wide screens. */
  half?: boolean;
}

export interface FormSpec<R = unknown> {
  eyebrow: string;
  title: string;
  intro?: string;
  fields: FormField[];
  initial?: FormValues;
  submitLabel: string;
  /**
   * Sends the form. The API validates again; its field errors appear next to the fields.
   * A file field's value is the file name; the file itself is in `files`.
   */
  submit: (values: FormValues, files: Record<string, File>) => Observable<R>;
  /** Fills in other fields when one changes (e.g. a title from the chosen file's name). */
  changed?: (key: string, values: FormValues) => FormValues;
  /** What to say when it worked. */
  success: (result: R, values: FormValues) => string;
  /** E.g. go to the new record. */
  done?: (result: R) => void;
  /** Sensitive changes ask for a fresh passkey / Humo Mobile proof first (the API refuses them otherwise). */
  stepUp?: StepUpRequest | ((values: FormValues) => StepUpRequest);
  /** Shown when the attempt fails, e.g. "The scheme wasn’t added". */
  failure: string;
}

/** Opens a create / edit form in the side drawer. */
export function openForm<R>(drawer: DrawerService, spec: FormSpec<R>): void {
  drawer.open(FormDrawer, spec as FormSpec<unknown>, spec.title);
}

/**
 * One drawer for every create and edit form: labelled fields, required-field
 * checks before sending, the server's field errors after, a busy state, and
 * the person's input kept on any failure. Nothing here knows which record it
 * edits — the spec does.
 */
@Component({
  selector: 'app-form-drawer',
  imports: [Drawer, IonIcon, FieldError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-drawer [eyebrow]="spec.eyebrow" [title]="spec.title">
      @if (spec.intro) {
        <p class="intro">{{ spec.intro }}</p>
      }
      @if (otherErrors().length) {
        <div class="form-errors" role="alert">
          @for (m of otherErrors(); track m) {
            <p>{{ m }}</p>
          }
        </div>
      }
      <form class="form" (submit)="$event.preventDefault(); send()" novalidate>
        @for (f of visibleFields(); track f.key) {
          @if (f.type === 'checks') {
            <!-- Several checkboxes: a group, not a label (labels can't nest). -->
            <div class="field" [class.half]="f.half" role="group" [attr.aria-labelledby]="'fl-' + f.key">
              <span class="f-label" [attr.id]="'fl-' + f.key">{{ f.label }}@if (!f.required) { <span class="opt">(optional)</span> }</span>
              <span class="checks">
                @for (o of f.optionsFor ? f.optionsFor(values()) : (f.options ?? []); track o.value) {
                  <label class="check"><input type="checkbox" [checked]="isChecked(f.key, o.value)" (change)="toggleCheck(f.key, o.value, $any($event.target).checked)" /> {{ o.label }}</label>
                }
              </span>
              @if (f.help) {
                <span class="f-help">{{ f.help }}</span>
              }
              <ui-field-error [errors]="errors()" [field]="f.key" />
            </div>
          } @else {
          <label class="field" [class.half]="f.half">
            <span class="f-label">{{ f.label }}@if (!f.required) { <span class="opt">(optional)</span> }</span>
            @switch (f.type) {
              @case ('textarea') {
                <textarea rows="3" [attr.id]="'f-' + f.key" [placeholder]="f.placeholder ?? ''" [value]="values()[f.key] ?? ''" (input)="set(f.key, $event)" [attr.aria-invalid]="!!errors()[f.key]"></textarea>
              }
              @case ('file') {
                <input type="file" [attr.id]="'f-' + f.key" [attr.accept]="f.accept ?? null" (change)="pick(f.key, $event)" [attr.aria-invalid]="!!errors()[f.key]" />
              }
              @case ('select') {
                <select [attr.id]="'f-' + f.key" (change)="set(f.key, $event)" [attr.aria-invalid]="!!errors()[f.key]">
                  @if (!f.required) {
                    <option value="" [selected]="!values()[f.key]">—</option>
                  }
                  @for (o of f.optionsFor ? f.optionsFor(values()) : (f.options ?? []); track o.value) {
                    <option [value]="o.value" [selected]="o.value === values()[f.key]">{{ o.label }}</option>
                  }
                </select>
              }
              @default {
                <input [type]="f.type" [attr.id]="'f-' + f.key" [placeholder]="f.placeholder ?? ''" [value]="values()[f.key] ?? ''" (input)="set(f.key, $event)" [attr.aria-invalid]="!!errors()[f.key]" />
              }
            }
            @if (f.help) {
              <span class="f-help">{{ f.help }}</span>
            }
            <ui-field-error [errors]="errors()" [field]="f.key" />
          </label>
          }
        }
        <button type="submit" hidden></button>
      </form>
      <div drawerFooter>
        <button type="button" class="btn btn-primary" (click)="send()" [disabled]="busy()">
          @if (spec.stepUp) {
            <ion-icon name="finger-print-outline" aria-hidden="true" />
          }
          {{ busy() ? 'Saving…' : spec.submitLabel }}
        </button>
        <button type="button" class="btn btn-ghost" (click)="ref.close()" [disabled]="busy()">Cancel</button>
      </div>
    </ui-drawer>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .intro { margin: 0 0 var(--s-4); font-size: var(--fs-sm); color: var(--c-text-muted); }
    .form-errors { margin: 0 0 var(--s-4); padding: var(--s-3); font-size: var(--fs-sm); color: var(--c-danger); background: var(--c-danger-soft); border-radius: var(--r); }
    .form-errors p { margin: 0; }
    .form-errors p + p { margin-top: var(--s-1); }
    .form { display: flex; flex-wrap: wrap; gap: var(--s-4) var(--s-3); }
    .field { display: flex; flex-direction: column; gap: 6px; flex: 1 1 100%; min-width: 0; }
    .field.half { flex: 1 1 calc(50% - var(--s-3)); min-width: 140px; }
    .f-label { font-size: var(--fs-sm); font-weight: var(--fw-medium); color: var(--c-text-2); }
    .opt { margin-left: 4px; font-weight: var(--fw-regular); color: var(--c-text-faint); }
    .f-help { font-size: var(--fs-xs); color: var(--c-text-muted); }
    input, select, textarea { width: 100%; }
    .checks { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow-y: auto; padding: var(--s-2); border: 1px solid var(--c-border); border-radius: var(--r); }
    .check { display: flex; gap: var(--s-2); align-items: center; font-size: var(--fs-sm); }
    .check input { width: auto; }
  `,
})
export class FormDrawer {
  protected readonly spec = inject<FormSpec>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef);
  private readonly feedback = inject(FeedbackService);
  private readonly stepUpService = inject(StepUpService);

  protected readonly values = signal<FormValues>({ ...(this.spec.initial ?? {}) });
  protected readonly errors = signal<FieldErrors>({});
  protected readonly busy = signal(false);
  protected readonly visibleFields = computed(() => {
    const values = this.values();
    return this.spec.fields.filter((f) => !f.showIf || f.showIf(values)).map((f) => (f.requiredIf ? { ...f, required: f.requiredIf(values) } : f));
  });
  /** The server's messages about things that aren't a field on this form (e.g. "needs 7 days' notice"). */
  protected readonly otherErrors = computed(() => {
    const shown = new Set(this.visibleFields().map((f) => f.key));
    return Object.entries(this.errors())
      .filter(([k]) => !shown.has(k))
      .map(([, m]) => m);
  });

  private readonly files: Record<string, File> = {};

  protected set(key: string, e: Event): void {
    this.apply(key, (e.target as HTMLInputElement).value);
  }

  protected isChecked(key: string, value: string): boolean {
    return (this.values()[key] ?? '').split(',').includes(value);
  }

  protected toggleCheck(key: string, value: string, on: boolean): void {
    const current = (this.values()[key] ?? '').split(',').filter(Boolean);
    this.apply(key, (on ? [...new Set([...current, value])] : current.filter((v) => v !== value)).join(','));
  }

  protected pick(key: string, e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.files[key] = file;
    else delete this.files[key];
    this.apply(key, file?.name ?? '');
  }

  private apply(key: string, value: string): void {
    this.values.update((v) => {
      const next = { ...v, [key]: value };
      return this.spec.changed ? this.spec.changed(key, next) : next;
    });
    if (this.errors()[key]) this.errors.update(({ [key]: _gone, ...rest }) => rest);
  }

  protected send(): void {
    if (this.busy()) return;
    const values = this.values();
    // The quick checks the browser can do; the API checks everything again.
    const missing = Object.fromEntries(
      this.visibleFields()
        .filter((f) => f.required && !(values[f.key] ?? '').trim())
        .map((f) => [f.key, `${f.label} is needed.`]),
    );
    if (Object.keys(missing).length) {
      this.errors.set(missing);
      return;
    }
    this.busy.set(true);
    const run = () => this.spec.submit(values, this.files);
    const stepUp = typeof this.spec.stepUp === 'function' ? this.spec.stepUp(values) : this.spec.stepUp;
    // Send first: the API validates before it asks for step-up, so field errors arrive without a
    // passkey prompt. A "step-up required" answer is a challenge: verify, then send again.
    const request$ = run().pipe(
      catchError((e: unknown) =>
        stepUp && e instanceof PolicyError && e.code === 'step-up-required' ? this.stepUpService.guard(stepUp, run) : throwError(() => e),
      ),
    );
    let sent = false;
    request$.subscribe({
      next: (result) => {
        sent = true;
        this.busy.set(false);
        this.feedback.success(this.spec.success(result, values));
        this.ref.close();
        this.spec.done?.(result);
      },
      error: (e) => {
        this.busy.set(false);
        this.errors.set(fieldErrorsOf(e));
        this.feedback.error(describeFailure(e, this.spec.failure));
      },
      // Step-up cancelled: nothing was sent, the form stays as it was.
      complete: () => {
        if (!sent) this.busy.set(false);
      },
    });
  }
}

export const PROVINCE_OPTIONS = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'].map((p) => ({ value: p, label: p }));

/** The one field a lifecycle change needs: why. It goes in the audit log. */
export const REASON_FIELD: FormField = {
  key: 'reason',
  label: 'Reason',
  type: 'textarea',
  required: true,
  help: 'Recorded in the audit log with your name and the time.',
};

/** Today as yyyy-mm-dd, for date fields. */
export const today = (): string => new Date().toISOString().slice(0, 10);
