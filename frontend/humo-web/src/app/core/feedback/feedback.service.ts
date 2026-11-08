import { Injectable, inject } from '@angular/core';
import { ToastController } from '@ionic/angular/standalone';
import { PolicyNotices } from '../security/policy-notices';

/**
 * Confirmations after an action, with an optional Undo, and failures. A confirmation goes by itself; a failure
 * stays, in full, until it's closed, so there's time to read what went wrong and what to do (D30).
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

  private async show(message: string, tone: 'success' | 'danger' | 'neutral', undo?: () => void): Promise<void> {
    await this.toasts.getTop().then((t) => t?.dismiss());
    const failure = tone === 'danger';
    const toast = await this.toasts.create({
      message,
      duration: failure ? 0 : undo ? 6000 : 3000,
      position: 'bottom',
      cssClass: `humo-toast humo-toast-${tone}`,
      buttons: undo ? [{ text: 'Undo', role: 'cancel', handler: undo }] : failure ? [{ text: 'Close', role: 'cancel' }] : [],
    });
    // Ionic mounts overlays inside <ion-app>, whose stacking context sits below the
    // CDK overlay layer (drawers, palette). Moving the toast to <body> keeps it on top.
    document.body.appendChild(toast);
    await toast.present();
  }
}
