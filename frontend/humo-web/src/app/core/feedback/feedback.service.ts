import { Injectable, inject } from '@angular/core';
import { ToastController } from '@ionic/angular/standalone';
import { PolicyNotices } from '../security/policy-notices';

/** How long a failure stays: long enough to read, longer for a longer message. */
export function failureTimeout(message: string): number {
  return Math.min(30_000, Math.max(8_000, 4_000 + message.length * 60));
}

const TICK = 100;

/**
 * Confirmations after an action, with an optional Undo, and failures.
 * - A confirmation goes by itself.
 * - A failure counts down, with a bar and the seconds left, and pauses while the pointer is on it, while it has
 *   keyboard focus, or while the page is in the background, so there's time to read it (WCAG 2.2.1). The × closes it.
 * Uses Ionic toasts so they behave natively on phones.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackService {
  private readonly toasts = inject(ToastController);
  private readonly policy = inject(PolicyNotices);

  async success(message: string, undo?: () => void): Promise<void> {
    await this.show(message, 'success', undo);
  }

  /** If the API refused on policy grounds, its reason replaces the generic message. */
  async error(message: string): Promise<void> {
    await this.show(this.policy.consume() ?? message, 'danger');
  }

  async info(message: string): Promise<void> {
    await this.show(message, 'neutral');
  }

  /** A problem shown somewhere on the page the person can't see, with a button that takes them to it. */
  async offscreen(message: string, show: () => void): Promise<void> {
    await this.show(message, 'danger', undefined, { text: 'Show', handler: show });
  }

  private async show(message: string, tone: 'success' | 'danger' | 'neutral', undo?: () => void, action?: { text: string; handler: () => void }): Promise<void> {
    await this.toasts.getTop().then((t) => t?.dismiss());
    const failure = tone === 'danger';
    const total = failure ? failureTimeout(message) : 0;
    const toast = await this.toasts.create({
      message,
      header: failure ? this.left(total) : undefined,
      // A failure's own timer closes it, so it can pause.
      duration: failure ? 0 : undo ? 6000 : 3000,
      position: 'bottom',
      cssClass: `humo-toast humo-toast-${tone}`,
      buttons: undo
        ? [{ text: 'Undo', role: 'cancel', handler: undo }]
        : failure
          ? [
              ...(action ? [{ text: action.text, role: 'cancel', handler: action.handler }] : []),
              { icon: 'close-outline', side: 'end' as const, role: 'cancel', htmlAttributes: { 'aria-label': 'Close' } },
            ]
          : [],
    });
    // Ionic mounts overlays inside <ion-app>, whose stacking context sits below the
    // CDK overlay layer (drawers, palette). Moving the toast to <body> keeps it on top.
    document.body.appendChild(toast);
    if (failure) this.countDown(toast, total);
    await toast.present();
  }

  private left(ms: number, paused = false): string {
    return paused ? 'Paused while you read' : `Closes in ${Math.ceil(ms / 1000)}s`;
  }

  /** Counts down on the toast itself; paused by hover, focus or a hidden page; closes it at zero. */
  private countDown(toast: HTMLIonToastElement, total: number): void {
    let remaining = total;
    let hovered = false;
    let focused = false;
    const paused = () => hovered || focused || document.hidden;
    const draw = () => {
      const left = Math.max(0, remaining);
      toast.header = this.left(left, paused());
      toast.style.setProperty('--progress', `${(left / total) * 100}%`);
    };
    const on = (event: string, apply: () => void) => toast.addEventListener(event, () => (apply(), draw()));
    on('mouseenter', () => (hovered = true));
    on('mouseleave', () => (hovered = false));
    on('focusin', () => (focused = true));
    on('focusout', () => (focused = false));
    const timer = setInterval(() => {
      if (!toast.isConnected) return clearInterval(timer);
      if (!paused()) remaining -= TICK;
      draw();
      if (remaining <= 0) {
        clearInterval(timer);
        void toast.dismiss();
      }
    }, TICK);
    draw();
  }
}
