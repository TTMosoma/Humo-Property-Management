import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';

/**
 * Field mode (review finding F31): complex screens — billing runs, reports,
 * the compliance matrix, configuration — say so on a phone and keep their
 * key facts readable, rather than pretending to fit. Hidden above 700px.
 *
 *   <ui-desktop-hint what="Preparing and posting a billing run" />
 */
@Component({
  selector: 'ui-desktop-hint',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'note', class: 'no-print' },
  template: `
    <ion-icon name="desktop-outline" aria-hidden="true" />
    <span><strong>Best on a bigger screen.</strong> {{ what() }} works best on a laptop or tablet. The key facts are below.</span>
  `,
  styles: `
    :host { display: none; gap: var(--s-2); align-items: flex-start; margin-bottom: var(--s-3); padding: var(--s-3); font-size: var(--fs-sm); color: var(--c-text-2); background: var(--c-info-soft); border-radius: var(--r); }
    ion-icon { flex: none; margin-top: 2px; font-size: 18px; color: var(--c-info); }
    @media (max-width: 700px) { :host { display: flex; } }
  `,
})
export class DesktopHint {
  readonly what = input.required<string>();
}
