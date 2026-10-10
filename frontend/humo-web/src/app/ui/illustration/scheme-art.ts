import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SchemeType } from '../../domain';

interface Block {
  x: number;
  w: number;
  h: number;
  floors: number;
  cols: number;
  roof: 'flat' | 'pitched';
  tone: 'a' | 'b';
}

/**
 * Generated "cover art" for a scheme: a calm architectural silhouette in brand
 * colours, varied deterministically by scheme id. Sectional title schemes get
 * apartment blocks; HOAs get houses with pitched roofs; share blocks a single
 * older block. Gives every scheme a recognisable face without photos.
 */
@Component({
  selector: 'ui-scheme-art',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 240 120" preserveAspectRatio="xMidYMax slice">
      <rect width="240" height="120" class="sky" />
      <circle [attr.cx]="sun().x" [attr.cy]="sun().y" r="16" class="sun" />
      <rect y="104" width="240" height="16" class="ground" />
      @for (b of blocks(); track $index) {
        <g [attr.class]="'block tone-' + b.tone">
          <rect [attr.x]="b.x" [attr.y]="104 - b.h" [attr.width]="b.w" [attr.height]="b.h" rx="2" class="wall" />
          @if (b.roof === 'pitched') {
            <path [attr.d]="roof(b)" class="roof" />
          }
          @for (f of range(b.floors); track f) {
            @for (c of range(b.cols); track c) {
              <rect
                [attr.x]="b.x + 6 + c * ((b.w - 12) / b.cols) + 1"
                [attr.y]="104 - b.h + 8 + f * ((b.h - 16) / b.floors)"
                [attr.width]="(b.w - 12) / b.cols - 4"
                [attr.height]="Math.min(9, (b.h - 16) / b.floors - 5)"
                rx="1"
                class="window"
                [class.lit]="lit(b, f, c)"
              />
            }
          }
        </g>
      }
      @for (t of trees(); track $index) {
        <path [attr.d]="leaf(t)" class="tree" />
      }
    </svg>
  `,
  styles: `
    :host { display: block; overflow: hidden; }
    svg { display: block; width: 100%; height: 100%; }
    .sky { fill: var(--c-illo-sky); }
    .sun { fill: var(--c-illo-accent-soft); }
    .ground { fill: var(--c-illo-fill); }
    .tone-a .wall { fill: var(--c-illo-fill-2); }
    .tone-b .wall { fill: var(--c-illo-fill); }
    .roof { fill: var(--brand-navy-700); opacity: 0.85; }
    .window { fill: var(--c-surface); opacity: 0.9; }
    .window.lit { fill: var(--c-illo-accent-soft); opacity: 1; }
    .tree { fill: var(--c-illo-accent); opacity: 0.85; }
  `,
})
export class SchemeArt {
  readonly seed = input.required<string>();
  readonly type = input<SchemeType>('Sectional Title');

  protected readonly Math = Math;

  private readonly rand = computed(() => {
    let h = 2166136261;
    for (const ch of this.seed()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const values: number[] = [];
    for (let i = 0; i < 64; i++) {
      h = Math.imul(h ^ (h >>> 15), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      values.push(((h ^= h >>> 16) >>> 0) / 4294967296);
    }
    return values;
  });

  protected readonly sun = computed(() => ({ x: 30 + this.rand()[0] * 180, y: 24 + this.rand()[1] * 14 }));

  protected readonly blocks = computed<Block[]>(() => {
    const r = this.rand();
    const type = this.type();
    const out: Block[] = [];
    if (type === 'Home Owners Association') {
      let x = 14 + r[2] * 10;
      for (let i = 0; x < 220 && i < 6; i++) {
        const w = 34 + r[3 + i] * 10;
        out.push({ x, w, h: 26 + r[10 + i] * 10, floors: 1, cols: 2, roof: 'pitched', tone: i % 2 ? 'a' : 'b' });
        x += w + 8 + r[20 + i] * 6;
      }
    } else if (type === 'Share Block') {
      out.push({ x: 60, w: 120, h: 70, floors: 5, cols: 6, roof: 'flat', tone: 'a' });
    } else {
      let x = 10 + r[2] * 14;
      for (let i = 0; x < 214 && i < 4; i++) {
        const w = 48 + r[3 + i] * 22;
        const floors = 3 + Math.floor(r[10 + i] * 4);
        out.push({ x, w, h: 22 + floors * 13, floors, cols: 3 + Math.floor(r[16 + i] * 2), roof: 'flat', tone: i % 2 ? 'a' : 'b' });
        x += w + 6 + r[24 + i] * 10;
      }
    }
    return out;
  });

  protected readonly trees = computed(() => {
    const r = this.rand();
    return [0, 1, 2].map((i) => ({ x: 10 + r[30 + i] * 220, s: 0.8 + r[40 + i] * 0.5 }));
  });

  protected range(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i);
  }

  protected lit(b: Block, f: number, c: number): boolean {
    return this.rand()[(f * 7 + c * 3 + Math.round(b.x)) % 64] > 0.72;
  }

  protected roof(b: Block): string {
    const top = 104 - b.h;
    return `M${b.x - 3} ${top + 1} L${b.x + b.w / 2} ${top - 14} L${b.x + b.w + 3} ${top + 1} Z`;
  }

  /** The Humo leaf, reused as stylised shrubs. */
  protected leaf(t: { x: number; s: number }): string {
    const s = 14 * t.s;
    const x = t.x;
    const y = 104;
    return `M${x} ${y} L${x} ${y - s * 0.55} Q${x} ${y - s} ${x + s * 0.45} ${y - s} L${x + s * 0.9} ${y - s} Q${x + s} ${y - s} ${x + s} ${y - s * 0.9} L${x + s} ${y - s * 0.45} Q${x + s} ${y} ${x + s * 0.55} ${y} Z`;
  }
}
