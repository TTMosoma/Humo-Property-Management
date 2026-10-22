import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { IonIcon } from '@ionic/angular/standalone';
import { LimitUsage, PackageLimitsDataSource } from '../../domain';
import { FeedbackService } from '../feedback/feedback.service';

/**
 * Warns the agency when it's at 80% of a package limit (docs/18 D16): units under management or people with a sign-in.
 * At 80% an Essentials agency is offered the Professional trial, which it starts itself (D17). Nothing shows when all
 * is well. Shown in the staff app, not the owner and resident portal.
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
        @if (offerTrial()) {
          <button type="button" class="btn btn-primary btn-sm" (click)="startTrial()">Try Humo Professional free for 30 days</button>
        }
      </div>
    }
  `,
  styles: `
    .limits-banner {
      display: flex;
      flex-wrap: wrap;
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
    .limits-banner span {
      flex: 1 1 auto;
    }
  `,
})
export class LimitsBanner {
  private readonly data = inject(PackageLimitsDataSource);
  private readonly feedback = inject(FeedbackService);
  private readonly started = signal(false);
  private readonly limits = toSignal(this.data.usage(), { initialValue: undefined });

  protected readonly offerTrial = computed(() => this.limits()?.trial.status === 'available' && !this.started());

  protected readonly message = computed(() => {
    const l = this.limits();
    if (!l) return null;
    if (l.trial.status === 'active' || this.started()) {
      const ends = l.trial.endsAt ? new Date(l.trial.endsAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' }) : '';
      return `You’re trying Humo Professional until ${ends}. Everything you create stays; automated features stop when the trial ends.`;
    }
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
      : `You’ve used ${count} on ${l.package}.`;
  });

  protected startTrial(): void {
    this.data.startProfessionalTrial().subscribe({
      next: () => this.started.set(true),
      error: () => this.feedback.error('The trial didn’t start. Try again, or ask Humo.'),
    });
  }
}

function ratio(u: LimitUsage): number {
  return u.included ? u.used / u.included : 0;
}
