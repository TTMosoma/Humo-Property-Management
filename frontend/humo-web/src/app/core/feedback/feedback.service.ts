import { Injectable, inject } from '@angular/core';
import { ToastController } from '@ionic/angular/standalone';

/**
 * Brief confirmations after an action, with an optional Undo.
 * Uses Ionic toasts so they behave natively on phones.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackService {
  private readonly toasts = inject(ToastController);

  async success(message: string, undo?: () => void): Promise<void> {
    await this.show(message, 'success', undo);
  }

  async error(message: string): Promise<void> {
    await this.show(message, 'danger');
  }

  async info(message: string): Promise<void> {
    await this.show(message, 'neutral');
  }

  private async show(message: string, tone: 'success' | 'danger' | 'neutral', undo?: () => void): Promise<void> {
    await this.toasts.getTop().then((t) => t?.dismiss());
    const toast = await this.toasts.create({
      message,
      duration: undo ? 6000 : 3000,
      position: 'bottom',
      cssClass: `humo-toast humo-toast-${tone}`,
      buttons: undo ? [{ text: 'Undo', role: 'cancel', handler: undo }] : [],
    });
    // Ionic mounts overlays inside <ion-app>, whose stacking context sits below the
    // CDK overlay layer (drawers, palette). Moving the toast to <body> keeps it on top.
    document.body.appendChild(toast);
    await toast.present();
  }
}
