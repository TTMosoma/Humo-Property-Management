import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IllustrationName =
  | 'all-done'
  | 'empty-tray'
  | 'no-results'
  | 'error'
  | 'no-access'
  | 'not-found'
  | 'building'
  | 'approvals'
  | 'coming-soon';

/**
 * Humo spot illustrations. Flat, calm, drawn from the brand palette
 * (navy ink, soft blue fills, the leaf accent) via CSS variables, so they
 * adapt to light and dark themes. The leaf appears in each as a quiet signature.
 */
@Component({
  selector: 'ui-illustration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 160 120" [attr.width]="size()" [attr.height]="size() * 0.75">
      <ellipse cx="80" cy="108" rx="58" ry="6" class="shadow" />
      @switch (name()) {
        @case ('all-done') {
          <circle cx="80" cy="58" r="40" class="fill" />
          <circle cx="80" cy="58" r="28" class="paper" />
          <path d="M66 58l10 10 19-21" class="ink-stroke" stroke-width="6" />
          <path d="M112 22c0-8 6-12 14-12h4v4c0 8-6 12-14 12h-4z" class="leaf" />
        }
        @case ('empty-tray') {
          <rect x="34" y="30" width="92" height="56" rx="8" class="fill" />
          <path d="M34 62h26l6 10h28l6-10h26v18a8 8 0 0 1-8 8H42a8 8 0 0 1-8-8z" class="fill-2" />
          <path d="M34 62h26l6 10h28l6-10h26" class="ink-line" />
          <rect x="52" y="40" width="56" height="5" rx="2.5" class="paper" />
          <rect x="52" y="50" width="38" height="5" rx="2.5" class="paper" />
          <path d="M118 16c0-7 5-11 12-11h4v4c0 7-5 11-12 11h-4z" class="leaf" />
        }
        @case ('no-results') {
          <rect x="30" y="26" width="72" height="62" rx="8" class="fill" />
          <rect x="42" y="38" width="44" height="5" rx="2.5" class="paper" />
          <rect x="42" y="50" width="32" height="5" rx="2.5" class="paper" />
          <rect x="42" y="62" width="38" height="5" rx="2.5" class="paper" />
          <circle cx="106" cy="68" r="20" class="paper ink-line" />
          <path d="M120 82l14 14" class="ink-stroke" stroke-width="7" />
          <path d="M100 66a7 7 0 0 1 7-7" class="accent-stroke" stroke-width="3" />
        }
        @case ('error') {
          <path d="M46 84a20 20 0 0 1 2-40 28 28 0 0 1 53-6 22 22 0 0 1 13 46z" class="fill" />
          <path d="M78 46v20" class="ink-stroke" stroke-width="6" />
          <circle cx="78" cy="76" r="3.5" class="ink" />
          <path d="M120 24c0-7 5-11 12-11h4v4c0 7-5 11-12 11h-4z" class="leaf" />
        }
        @case ('no-access') {
          <rect x="50" y="52" width="60" height="44" rx="8" class="fill-2" />
          <path d="M62 52V40a18 18 0 0 1 36 0v12" class="ink-line" stroke-width="6" fill="none" />
          <circle cx="80" cy="70" r="6" class="ink" />
          <rect x="77" y="72" width="6" height="12" rx="3" class="ink" />
          <path d="M116 26c0-7 5-11 12-11h4v4c0 7-5 11-12 11h-4z" class="leaf" />
        }
        @case ('not-found') {
          <rect x="76" y="34" width="6" height="70" rx="3" class="ink" />
          <path d="M44 36h58l12 10-12 10H44z" class="fill-2" />
          <path d="M116 64H58l-12 10 12 10h58z" class="fill" />
          <rect x="56" y="43" width="34" height="5" rx="2.5" class="paper" />
          <rect x="68" y="71" width="34" height="5" rx="2.5" class="paper" />
          <path d="M84 30c0-8 6-12 14-12h4v4c0 8-6 12-14 12h-4z" class="leaf" />
        }
        @case ('approvals') {
          <rect x="42" y="22" width="70" height="80" rx="8" class="fill" />
          <rect x="54" y="36" width="46" height="5" rx="2.5" class="paper" />
          <rect x="54" y="48" width="34" height="5" rx="2.5" class="paper" />
          <rect x="54" y="60" width="40" height="5" rx="2.5" class="paper" />
          <circle cx="108" cy="84" r="17" class="leaf-solid" />
          <path d="M100 84l6 6 11-12" class="paper-stroke" stroke-width="4.5" />
        }
        @case ('coming-soon') {
          <rect x="36" y="30" width="88" height="62" rx="8" class="fill" />
          <rect x="36" y="30" width="88" height="14" rx="7" class="fill-2" />
          <rect x="48" y="54" width="30" height="26" rx="4" class="paper" />
          <rect x="84" y="54" width="28" height="11" rx="3" class="paper" />
          <rect x="84" y="69" width="20" height="11" rx="3" class="paper" />
          <path d="M112 20c0-8 6-12 14-12h4v4c0 8-6 12-14 12h-4z" class="leaf" />
        }
        @default {
          <!-- building -->
          <rect x="44" y="34" width="44" height="70" rx="3" class="fill-2" />
          <rect x="88" y="54" width="32" height="50" rx="3" class="fill" />
          @for (r of [0, 1, 2, 3]; track r) {
            <rect [attr.x]="52" [attr.y]="44 + r * 14" width="10" height="8" rx="1.5" class="paper" />
            <rect [attr.x]="70" [attr.y]="44 + r * 14" width="10" height="8" rx="1.5" class="paper" />
          }
          <rect x="96" y="64" width="16" height="8" rx="1.5" class="paper" />
          <rect x="96" y="80" width="16" height="8" rx="1.5" class="paper" />
          <path d="M112 28c0-8 6-12 14-12h4v4c0 8-6 12-14 12h-4z" class="leaf" />
        }
      }
    </svg>
  `,
  styles: `
    :host { display: inline-flex; }
    .shadow { fill: var(--c-illo-fill); opacity: 0.6; }
    .fill { fill: var(--c-illo-fill); }
    .fill-2 { fill: var(--c-illo-fill-2); }
    .paper { fill: var(--c-surface); }
    .ink { fill: var(--c-illo-ink); }
    .ink-line { stroke: var(--c-illo-ink); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; fill: none; }
    circle.paper.ink-line { fill: var(--c-surface); }
    .ink-stroke { stroke: var(--c-illo-ink); stroke-linecap: round; stroke-linejoin: round; fill: none; }
    .paper-stroke { stroke: var(--c-surface); stroke-linecap: round; stroke-linejoin: round; fill: none; }
    .accent-stroke { stroke: var(--c-illo-accent); stroke-linecap: round; fill: none; }
    .leaf { fill: var(--c-illo-accent); }
    .leaf-solid { fill: var(--c-illo-accent); }
  `,
})
export class Illustration {
  readonly name = input<IllustrationName>('empty-tray');
  readonly size = input(140);
}
