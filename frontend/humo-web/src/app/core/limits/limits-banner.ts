import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonIcon } from '@ionic/angular/standalone';
import { LimitUsage, PackageLimitsDataSource } from '../../domain';

/**
 * Warns the agency when it's at 80% of a package limit (docs/18 D16): units under management or people with a sign-in.
 * Shows the limit that's closest to its ceiling, and what happens at the ceiling. Nothing shows when all is well.
 */
@Component({
  selector: 'app-limits-banner',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (message(); as m) {
      <div class="limits-banner" role="status">
        <ion-icon name="alert-circle-outline" aria-hidden="true" />
        <span>{{ m }}</span>
      </div>
    }
  `,
  styles: `
    .limits-banner {
      display: flex;
      align-items: center;
      gap: var(--s-2);
      margin: var(--s-2) var(--s-4) 0;
      padding: var(--s-2) var(--s-3);
      font-size: var(--fs-sm);
      color: var(--c-text);
      background: var(--c-warning-soft);
      border: 1px solid var(--c-warning);
      border-radius: var(--r-sm);
    }
    .limits-banner ion-icon {
      flex: none;
      font-size: 1.1rem;
      color: var(--c-warning);
    }
  `,
})
export class LimitsBanner {
  private readonly data = inject(PackageLimitsDataSource);
  private readonly limits = toSignal(this.data.usage(), { initialValue: undefined });

  protected readonly message = computed(() => {
    const l = this.limits();
    if (!l) return null;
    const closest = [
      { label: 'units', usage: l.units },
      { label: 'people with a sign-in', usage: l.users },
    ]
      .filter((x) => x.usage.included !== null && x.usage.state !== 'ok')
      .sort((a, b) => ratio(b.usage) - ratio(a.usage))[0];
    if (!closest) return null;
    const { used, included } = closest.usage;
    const count = `${used.toLocaleString('en-ZA')} of ${included!.toLocaleString('en-ZA')} ${closest.label}`;
    return closest.usage.state === 'reached'
      ? `You’ve reached the ${count} your ${l.package} package includes. Upgrade to add more.`
      : `You’ve used ${count} on ${l.package}. Upgrade before you reach the limit.`;
  });
}

function ratio(u: LimitUsage): number {
  return u.included ? u.used / u.included : 0;
}
