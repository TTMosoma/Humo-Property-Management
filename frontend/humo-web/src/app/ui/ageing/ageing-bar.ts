import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Ageing } from '../../domain';
import { RandPipe } from '../format/money';

const BUCKETS: { key: keyof Ageing; label: string }[] = [
  { key: 'current', label: 'Current' },
  { key: 'd30', label: '30 days' },
  { key: 'd60', label: '60 days' },
  { key: 'd90', label: '90 days' },
  { key: 'd120', label: '120+ days' },
];

/** Debt ageing as one stacked bar with amounts: Current · 30 · 60 · 90 · 120+. */
@Component({
  selector: 'ui-ageing-bar',
  imports: [RandPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar" role="img" [attr.aria-label]="label()">
      @for (b of parts(); track b.key) {
        @if (b.pct > 0) {
          <span [class]="b.key" [style.width.%]="b.pct"></span>
        }
      }
    </div>
    <dl>
      @for (b of parts(); track b.key) {
        <div [class.zero]="b.value === 0">
          <dt><i [class]="b.key"></i>{{ b.label }}</dt>
          <dd class="money">{{ b.value | rand: 'whole' }}</dd>
        </div>
      }
    </dl>
  `,
  styles: `
    :host { display: block; }
    .bar { display: flex; height: 10px; overflow: hidden; background: var(--c-surface-sunken); border-radius: var(--r-pill); }
    .bar span { display: block; height: 100%; }
    .current { background: var(--c-info); }
    .d30 { background: #e0a641; }
    .d60 { background: #d9822b; }
    .d90 { background: #c8553d; }
    .d120 { background: var(--c-danger); }
    dl { display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--s-2); margin: var(--s-3) 0 0; }
    dt { display: flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--c-text-muted); white-space: nowrap; }
    dt i { width: 8px; height: 8px; border-radius: 2px; flex: none; }
    dd { margin: 2px 0 0; font-size: var(--fs-sm); font-weight: var(--fw-semibold); }
    .zero dd { color: var(--c-text-faint); font-weight: var(--fw-regular); }
    @media (max-width: 600px) { dl { grid-template-columns: repeat(3, 1fr); } }
  `,
})
export class AgeingBar {
  readonly ageing = input.required<Ageing>();

  protected readonly parts = computed(() => {
    const a = this.ageing();
    const total = BUCKETS.reduce((s, b) => s + a[b.key], 0) || 1;
    return BUCKETS.map((b) => ({ ...b, value: a[b.key], pct: (a[b.key] / total) * 100 }));
  });

  protected readonly label = computed(() =>
    this.parts()
      .filter((p) => p.value > 0)
      .map((p) => `${p.label}: R ${p.value.toFixed(2)}`)
      .join(', ') || 'Nothing outstanding',
  );
}
