import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { IonApp } from '@ionic/angular/standalone';

@Component({
  selector: 'app-root',
  imports: [IonApp, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ion-app><router-outlet /></ion-app>`,
})
export class App {}
