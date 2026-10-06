import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Placeholder blocks shown while data loads. Mirrors the rough shape of the real content. */
@Component({
  selector: 'ui-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-busy': 'true', 'aria-label': 'Loading' },
  template: `
    @if (variant() === 'tiles') {
      <div class="tiles">
        @for (i of items(); track i) {
          <div class="tile"><span class="bar w40"></span><span class="bar big w60"></span></div>
        }
      </div>
    } @else {
      <div class="rows">
        @for (i of items(); track i) {
          <div class="row">
            <span class="bar w30"></span><span class="bar w20"></span><span class="bar w15"></span><span class="bar w10"></span>
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--s-4); }
    .tile {
      display: flex; flex-direction: column; gap: var(--s-3);
      padding: var(--s-5); background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-lg);
    }
    .rows { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-lg); }
    .row { display: flex; gap: var(--s-6); padding: var(--s-4) var(--s-5); border-bottom: 1px solid var(--c-border); }
    .row:last-child { border-bottom: 0; }
    .bar {
      display: block; height: 10px; border-radius: var(--r-sm);
      background: linear-gradient(90deg, var(--c-surface-sunken) 0%, var(--c-surface-hover) 50%, var(--c-surface-sunken) 100%);
      background-size: 200% 100%;
      animation: shimmer 1.4s linear infinite;
    }
    .bar.big { height: 22px; }
    .w10 { width: 10%; } .w15 { width: 15%; } .w20 { width: 20%; } .w30 { width: 30%; } .w40 { width: 40%; } .w60 { width: 60%; }
    @keyframes shimmer { to { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .bar { animation: none; } }
  `,
})
export class Skeleton {
  readonly variant = input<'rows' | 'tiles'>('rows');
  readonly count = input(5);
  protected readonly items = computed(() => Array.from({ length: this.count() }, (_, i) => i));
}
