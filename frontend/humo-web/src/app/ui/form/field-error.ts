import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { FieldErrors } from '../../domain';

/**
 * The server's message for one field, shown under it:
 *   <ui-field-error [errors]="errors()" field="title" />
 * Renders nothing when the field is fine.
 */
@Component({
  selector: 'ui-field-error',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (message(); as m) {
      <span class="f-error" role="alert"><ion-icon name="alert-circle-outline" aria-hidden="true" /> {{ m }}</span>
    }
  `,
  styles: `
    :host { display: contents; }
    .f-error { display: flex; gap: 6px; align-items: flex-start; margin-top: 4px; font-size: var(--fs-xs); color: var(--c-danger); }
    ion-icon { flex: none; margin-top: 2px; font-size: 14px; }
  `,
})
export class FieldError {
  readonly errors = input<FieldErrors>({});
  readonly field = input.required<string>();
  protected readonly message = computed(() => this.errors()[this.field()]);
}
