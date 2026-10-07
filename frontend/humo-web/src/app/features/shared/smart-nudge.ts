import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { catchError, of, switchMap } from 'rxjs';
import { NudgeDataSource, NudgePlacement } from '../../domain';

/**
 * A Smart Nudge: one quiet, contextual suggestion grounded in the customer's
 * own usage. Never a modal, never stacked, and it says why it's showing.
 * The server decides whether there's anything to show here at all.
 */
@Component({
  selector: 'app-smart-nudge',
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (nudge(); as n) {
      @if (!gone()) {
        <aside class="nudge" [attr.aria-label]="n.definition.eyebrow">
          <span class="spark" aria-hidden="true"><ion-icon name="sparkles-outline" /></span>
          <div class="body">
            <div class="eyebrow">{{ n.definition.eyebrow }}</div>
            <p class="usage">{{ n.usageLine }}</p>
            <p class="suggest">{{ n.definition.suggestion }}</p>
            <div class="actions">
              <button type="button" class="btn btn-secondary btn-sm" (click)="learnMore(n.definition.id, n.definition.destination)">{{ n.definition.cta }}</button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="act(n.definition.id, 'not-interested')">Not interested</button>
              <button type="button" class="why-btn" (click)="why.set(!why())" [attr.aria-expanded]="why()">Why am I seeing this?</button>
            </div>
            @if (why()) {
              <p class="why">{{ n.why }}</p>
            }
          </div>
          <button type="button" class="btn btn-ghost btn-icon btn-sm close" (click)="act(n.definition.id, 'dismissed')" aria-label="Dismiss for now">
            <ion-icon name="close-outline" aria-hidden="true" />
          </button>
        </aside>
      }
    }
  `,
  styles: `
    :host { display: block; }
    .nudge {
      position: relative;
      display: flex;
      gap: var(--s-3);
      margin-bottom: var(--s-5);
      padding: var(--s-4) var(--s-5);
      background: linear-gradient(120deg, var(--c-accent-soft), var(--c-surface) 60%);
      border: 1px solid color-mix(in srgb, var(--c-accent) 30%, var(--c-border));
      border-radius: var(--r-lg);
      animation: in var(--dur) var(--ease);
    }
    @keyframes in { from { opacity: 0; transform: translateY(-4px); } }
    @media (prefers-reduced-motion: reduce) { .nudge { animation: none; } }
    .spark { display: grid; flex: none; place-items: center; width: 32px; height: 32px; font-size: 17px; color: var(--c-accent-strong); background: var(--c-surface); border-radius: 50%; }
    .body { flex: 1; min-width: 0; padding-right: var(--s-6); }
    .eyebrow { font-size: var(--fs-xs); font-weight: var(--fw-semibold); color: var(--c-accent-strong); }
    .usage { margin: 4px 0 0; font-size: var(--fs-md); font-weight: var(--fw-medium); color: var(--c-text); }
    .suggest { margin: 4px 0 var(--s-3); font-size: var(--fs-sm); color: var(--c-text-2); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--s-2); align-items: center; }
    .why-btn { padding: 0; font: inherit; font-size: var(--fs-xs); color: var(--c-text-muted); text-decoration: underline; background: none; border: 0; cursor: pointer; }
    .why { margin: var(--s-2) 0 0; font-size: var(--fs-xs); color: var(--c-text-muted); }
    .close { position: absolute; top: var(--s-2); right: var(--s-2); }
  `,
})
export class SmartNudge {
  private readonly data = inject(NudgeDataSource);
  private readonly router = inject(Router);

  readonly placement = input.required<NudgePlacement>();
  protected readonly nudge = toSignal(toObservable(this.placement).pipe(switchMap((p) => this.data.next(p).pipe(catchError(() => of(null))))));
  protected readonly why = signal(false);
  protected readonly gone = signal(false);

  protected act(id: string, event: 'dismissed' | 'not-interested'): void {
    this.gone.set(true);
    this.data.record(id, event).subscribe();
  }

  protected learnMore(id: string, destination: string): void {
    this.data.record(id, 'learn-more').subscribe();
    this.router.navigateByUrl(destination);
  }
}
