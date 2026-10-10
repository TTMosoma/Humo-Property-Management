import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { ScopeService } from './scope.service';

/** A slim reminder on portfolio-wide pages that results are limited to one scheme. */
@Component({
  selector: 'app-scope-notice',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (scope.canChangeScope() && scope.scheme(); as s) {
      <div class="notice" role="status">
        <ion-icon name="funnel-outline" aria-hidden="true" />
        <span>Showing <strong>{{ s.name }}</strong> only</span>
        <button type="button" (click)="scope.setScope(null)">Show all schemes</button>
      </div>
    }
  `,
  styles: `
    .notice {
      display: flex; align-items: center; gap: var(--s-2); margin-bottom: var(--s-4); padding: var(--s-2) var(--s-3);
      font-size: var(--fs-sm); color: var(--c-text-2); background: var(--c-accent-soft); border-radius: var(--r);
    }
    ion-icon { color: var(--c-accent-strong); }
    button { margin-left: auto; padding: 0; font-weight: var(--fw-medium); color: var(--c-primary-text); background: none; border: 0; cursor: pointer; }
  `,
})
export class ScopeNotice {
  protected readonly scope = inject(ScopeService);
}
