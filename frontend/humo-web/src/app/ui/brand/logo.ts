import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Humo mark: a roofline over a level — "one roof, everything in order". */
@Component({
  selector: 'ui-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 32 32" [attr.width]="size()" [attr.height]="size()" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#0b5f5c" />
      <path d="M9 23V12.5L16 8l7 4.5V23" fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" />
      <path d="M9 17h14" stroke="#5cc6ba" stroke-width="2.4" />
    </svg>
  `,
  styles: `:host { display: inline-flex; flex: none; }`,
})
export class Logo {
  readonly size = input(28);
}
