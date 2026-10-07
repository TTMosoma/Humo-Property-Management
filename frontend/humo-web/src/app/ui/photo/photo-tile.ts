import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';

/**
 * Photo placeholder for the prototype: a calm tile with the caption, so photo
 * flows (report → completion) can be reviewed without real images.
 * Replace with real thumbnails when the document store exists.
 */
@Component({
  selector: 'ui-photo-tile',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="img" [style.background]="bg()" role="img" [attr.aria-label]="'Photo: ' + caption()">
      <ion-icon name="image-outline" aria-hidden="true" />
      @if (badge()) {
        <span class="badge">{{ badge() }}</span>
      }
    </div>
    <div class="cap">{{ caption() }}</div>
  `,
  styles: `
    :host { display: block; width: 132px; }
    .img {
      position: relative; display: grid; place-items: center; height: 96px; border-radius: var(--r);
      border: 1px solid var(--c-border); color: rgba(255,255,255,0.85); font-size: 26px;
    }
    .badge { position: absolute; left: 6px; top: 6px; padding: 1px 6px; font-size: 10px; font-weight: var(--fw-semibold); color: var(--brand-navy-900); background: rgba(255,255,255,0.85); border-radius: var(--r-pill); }
    .cap { margin-top: 4px; font-size: var(--fs-xs); color: var(--c-text-muted); line-height: 1.3; }
  `,
})
export class PhotoTile {
  readonly caption = input.required<string>();
  readonly seed = input('');
  readonly badge = input<string>();

  protected readonly bg = computed(() => {
    let h = 0;
    for (const ch of this.seed() + this.caption()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const palettes = [
      ['#6b7f99', '#3d4f68'],
      ['#8a9a7b', '#55684a'],
      ['#9c8a74', '#6a5a46'],
      ['#7a8fa6', '#4a5f79'],
      ['#a39e8f', '#6f6a5c'],
    ];
    const [a, b] = palettes[h % palettes.length];
    return `linear-gradient(135deg, ${a}, ${b})`;
  });
}
