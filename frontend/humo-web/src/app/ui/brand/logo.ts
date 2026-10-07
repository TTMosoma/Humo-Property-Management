import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The Humo logo, from the supplied artwork (public/brand).
 * - full:     wordmark + "PROPERTY MANAGEMENT" tagline
 * - wordmark: "Humo" only (sidebar, compact headers)
 * - mark:     the "o + leaf" symbol (collapsed sidebar, favicon, app icon)
 * `reverse` is for navy backgrounds (cream letters).
 */
@Component({
  selector: 'ui-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<img [src]="src()" [alt]="alt()" [style.height.px]="height()" />`,
  styles: `
    :host { display: inline-flex; flex: none; }
    img { display: block; width: auto; }
  `,
})
export class Logo {
  readonly variant = input<'full' | 'wordmark' | 'mark'>('wordmark');
  readonly reverse = input(false);
  readonly height = input(28);

  protected readonly src = computed(() => {
    const base = this.variant() === 'full' ? 'humo-logo' : this.variant() === 'mark' ? 'humo-mark' : 'humo-wordmark';
    return `brand/${base}${this.reverse() ? '-reverse' : ''}.png`;
  });

  protected readonly alt = computed(() => (this.variant() === 'full' ? 'Humo Property Management' : 'Humo'));
}
