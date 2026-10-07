import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { DialogRef } from '@angular/cdk/dialog';
import { IonIcon } from '@ionic/angular/standalone';

/**
 * Frame for preview drawer content: header (eyebrow, title, close, open full page),
 * scrolling body, and a sticky footer for the primary actions.
 *
 *   <ui-drawer eyebrow="Quote approval" title="Roof waterproofing" openLink="/maintenance/MR-1042">
 *     …body…
 *     <div drawerFooter>…buttons…</div>
 *   </ui-drawer>
 */
@Component({
  selector: 'ui-drawer',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header>
      <div class="head-text">
        @if (eyebrow()) {
          <div class="label-caps">{{ eyebrow() }}</div>
        }
        <h2>{{ title() }}</h2>
        <ng-content select="[drawerMeta]" />
      </div>
      <div class="head-actions">
        @if (openLink()) {
          <button type="button" class="btn btn-ghost btn-sm" (click)="openFull()">
            Open <ion-icon name="open-outline" aria-hidden="true" />
          </button>
        }
        <button type="button" class="btn btn-ghost btn-icon" (click)="ref.close()" aria-label="Close preview">
          <ion-icon name="close-outline" aria-hidden="true" />
        </button>
      </div>
    </header>
    <div class="body"><ng-content /></div>
    <footer><ng-content select="[drawerFooter]" /></footer>
  `,
  styles: `
    :host {
      display: flex; flex-direction: column; height: 100%;
      background: var(--c-surface); border-left: 1px solid var(--c-border);
      box-shadow: var(--shadow-overlay);
      animation: slide-in var(--dur) var(--ease);
    }
    header {
      display: flex; gap: var(--s-3); align-items: flex-start; justify-content: space-between;
      padding: var(--s-5) var(--s-5) var(--s-4) var(--s-6); border-bottom: 1px solid var(--c-border);
    }
    .head-text { min-width: 0; }
    .head-text .label-caps { margin-bottom: var(--s-1); }
    h2 { font-size: var(--fs-xl); line-height: 1.25; }
    .head-actions { display: flex; flex: none; align-items: center; gap: var(--s-1); }
    .head-actions ion-icon { font-size: 15px; }
    .head-actions .btn-icon ion-icon { font-size: 20px; }
    .body { flex: 1; overflow-y: auto; padding: var(--s-5) var(--s-6); }
    footer { display: flex; flex-wrap: wrap; gap: var(--s-2); padding: var(--s-4) var(--s-6); border-top: 1px solid var(--c-border); background: var(--c-surface-2); }
    footer:empty { display: none; }
    @keyframes slide-in { from { transform: translateX(24px); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { :host { animation: none; } }
  `,
})
export class Drawer {
  protected readonly ref = inject(DialogRef);
  private readonly router = inject(Router);

  readonly eyebrow = input<string>();
  readonly title = input.required<string>();
  readonly openLink = input<string>();

  protected openFull(): void {
    const link = this.openLink();
    this.ref.close();
    if (link) this.router.navigateByUrl(link);
  }
}
