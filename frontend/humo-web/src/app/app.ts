import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { IonApp } from '@ionic/angular/standalone';
import { OffscreenAlerts } from './core/feedback/offscreen-alerts';

@Component({
  selector: 'app-root',
  imports: [IonApp, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ion-app><router-outlet /></ion-app>`,
})
export class App {
  constructor() {
    // A problem shown off screen also comes up as a toast.
    inject(OffscreenAlerts).start();
  }
}
