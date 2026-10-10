import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Small, dependency-free SVG charts. Calm by design: no gridline clutter,
 * one accent, values readable without hovering. Colours come from CSS
 * (`currentColor` and custom properties) so each screen can theme them.
 */

const W = 100;

function path(values: number[], h: number, pad = 2, min?: number, max?: number): { line: string; area: string; points: [number, number][] } {
  if (!values.length) return { line: '', area: '', points: [] };
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i): [number, number] => [
    values.length === 1 ? W / 2 : (i / (values.length - 1)) * W,
    pad + (1 - (v - lo) / span) * (h - pad * 2),
  ]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  return { line, area: `${line} L${W},${h} L0,${h} Z`, points: pts };
}

/** A trend line without axes, for tiles and table cells. */
@Component({
  selector: 'ui-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 100 ' + height()" preserveAspectRatio="none" role="img" [attr.aria-label]="label()">
      <path class="area" [attr.d]="geo().area" />
      <path class="line" [attr.d]="geo().line" vector-effect="non-scaling-stroke" />
    </svg>
  `,
  styles: `
    :host { display: block; width: 100%; height: var(--spark-h, 32px); color: var(--spark, var(--c-accent)); }
    svg { width: 100%; height: 100%; overflow: visible; }
    .line { fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linejoin: round; stroke-linecap: round; }
    .area { fill: currentColor; opacity: 0.12; }
  `,
})
export class Sparkline {
  readonly values = input.required<number[]>();
  readonly label = input('Trend');
  readonly height = input(32);
  protected readonly geo = computed(() => path(this.values(), this.height()));
}

/** Area chart with month labels and a highlighted last value. */
@Component({
  selector: 'ui-area-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 100 60" preserveAspectRatio="none" role="img" [attr.aria-label]="label()">
      <defs>
        <linearGradient [attr.id]="gid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.32" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
        </linearGradient>
      </defs>
      @for (y of [15, 30, 45]; track y) {
        <line class="grid" x1="0" x2="100" [attr.y1]="y" [attr.y2]="y" vector-effect="non-scaling-stroke" />
      }
      <path [attr.d]="geo().area" [attr.fill]="'url(#' + gid + ')'" />
      <path class="line" [attr.d]="geo().line" vector-effect="non-scaling-stroke" />
    </svg>
    @if (geo().points.length; as n) {
      <span class="dot" [style.left.%]="geo().points[n - 1][0]" [style.top.%]="(geo().points[n - 1][1] / 60) * 100"></span>
    }
    <div class="labels">
      @for (l of labels(); track $index) {
        <span>{{ l }}</span>
      }
    </div>
  `,
  styles: `
    :host { position: relative; display: block; color: var(--chart, var(--c-accent)); }
    svg { display: block; width: 100%; height: var(--chart-h, 180px); overflow: visible; }
    .grid { stroke: var(--chart-grid, var(--c-border)); stroke-width: 1; stroke-dasharray: 2 4; }
    .line { fill: none; stroke: currentColor; stroke-width: 2.25; stroke-linejoin: round; }
    .dot { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; background: currentColor; border: 2px solid var(--chart-bg, var(--c-surface)); border-radius: 50%; }
    .labels { display: flex; justify-content: space-between; margin-top: 8px; font-size: 11px; color: var(--chart-muted, var(--c-text-muted)); }
  `,
})
export class AreaChart {
  readonly values = input.required<number[]>();
  readonly labels = input<string[]>([]);
  readonly label = input('Trend');
  protected readonly gid = `ag-${Math.random().toString(36).slice(2, 8)}`;
  protected readonly geo = computed(() => {
    const v = this.values();
    const lo = Math.min(...v);
    return path(v, 60, 4, lo - (Math.max(...v) - lo) * 0.25);
  });
}

export interface BarDatum {
  label: string;
  value: number;
  /** Optional second series drawn below the axis (e.g. churn). */
  negative?: number;
}

/** Vertical bars, with an optional mirrored negative series. */
@Component({
  selector: 'ui-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="plot" role="img" [attr.aria-label]="label()">
      @for (d of data(); track d.label) {
        <div class="col" [title]="d.label + ': ' + d.value + (d.negative ? ' / −' + d.negative : '')">
          <div class="pos"><span [style.height.%]="(d.value / max()) * 100"></span></div>
          @if (hasNegative()) {
            <div class="neg"><span [style.height.%]="((d.negative ?? 0) / max()) * 100"></span></div>
          }
          <div class="lbl">{{ d.label }}</div>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; color: var(--chart, var(--c-accent)); }
    .plot { display: flex; gap: 6px; align-items: stretch; height: var(--chart-h, 150px); }
    .col { display: flex; flex: 1; flex-direction: column; min-width: 0; }
    .pos { display: flex; flex: 3; align-items: flex-end; border-bottom: 1px solid var(--chart-grid, var(--c-border)); }
    .neg { display: flex; flex: 1; align-items: flex-start; }
    .pos span, .neg span { display: block; width: 100%; min-height: 2px; border-radius: 3px 3px 0 0; background: currentColor; }
    .neg span { border-radius: 0 0 3px 3px; background: var(--chart-negative, var(--c-danger)); opacity: 0.85; }
    .lbl { margin-top: 6px; overflow: hidden; font-size: 10px; text-align: center; white-space: nowrap; color: var(--chart-muted, var(--c-text-muted)); }
  `,
})
export class BarChart {
  readonly data = input.required<BarDatum[]>();
  readonly label = input('Bar chart');
  protected readonly max = computed(() => Math.max(1, ...this.data().map((d) => Math.max(d.value, d.negative ?? 0))));
  protected readonly hasNegative = computed(() => this.data().some((d) => d.negative !== undefined));
}

/** A circular score (0–100), coloured by band. */
@Component({
  selector: 'ui-score-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-band]': 'band()' },
  template: `
    <svg viewBox="0 0 36 36" role="img" [attr.aria-label]="label() + ': ' + score() + ' out of 100'">
      <circle class="track" cx="18" cy="18" r="15.5" />
      <circle class="value" cx="18" cy="18" r="15.5" [attr.stroke-dasharray]="score() * 0.974 + ' 100'" />
    </svg>
    <span class="num">{{ score() }}<small>/100</small></span>
  `,
  styles: `
    :host { --ring: var(--c-success); position: relative; display: inline-grid; place-items: center; width: var(--ring-size, 88px); aspect-ratio: 1; }
    :host([data-band='at-risk']) { --ring: var(--c-warning); }
    :host([data-band='critical']) { --ring: var(--c-danger); }
    svg { position: absolute; inset: 0; transform: rotate(-90deg); }
    circle { fill: none; stroke-width: 3.2; }
    .track { stroke: var(--ring-track, var(--c-surface-sunken)); }
    .value { stroke: var(--ring); stroke-linecap: round; transition: stroke-dasharray 400ms var(--ease); }
    .num { font-family: var(--font-display); font-size: calc(var(--ring-size, 88px) * 0.3); font-weight: 600; line-height: 1; color: var(--c-text); }
    small { font-size: 0.4em; font-weight: 500; color: var(--c-text-muted); margin-left: 1px; }
  `,
})
export class ScoreRing {
  readonly score = input.required<number>();
  readonly label = input('Health');
  protected readonly band = computed(() => (this.score() >= 75 ? 'healthy' : this.score() >= 50 ? 'at-risk' : 'critical'));
}

/** A labelled horizontal meter (adoption, utilisation). */
@Component({
  selector: 'ui-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.off]': 'off()' },
  template: `
    <span class="name">{{ label() }}</span>
    <span class="bar" role="meter" [attr.aria-valuenow]="value()" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="label()">
      <span [style.width.%]="value()"></span>
    </span>
    <span class="val">{{ off() ? (offText() || 'Off') : value() + '%' }}</span>
  `,
  styles: `
    :host { display: grid; grid-template-columns: minmax(90px, 140px) 1fr 56px; gap: 10px; align-items: center; font-size: var(--fs-sm); }
    .name { color: var(--c-text-2); text-transform: capitalize; }
    .bar { height: 8px; overflow: hidden; background: var(--c-surface-sunken); border-radius: 99px; }
    .bar span { display: block; height: 100%; background: var(--meter, var(--c-accent)); border-radius: 99px; }
    .val { font-variant-numeric: tabular-nums; text-align: right; color: var(--c-text); font-weight: 500; }
    :host(.off) .bar span { background: repeating-linear-gradient(-45deg, var(--c-border-strong) 0 4px, transparent 4px 8px); }
    :host(.off) .val { color: var(--c-text-muted); font-weight: 400; }
  `,
})
export class Meter {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly off = input(false);
  readonly offText = input('');
}
