import { ApplicationConfig, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';

import { routes } from './app.routes';
import { HumoTitleStrategy } from './core/title.strategy';
import { provideData } from './data/provide-data';
import { registerIcons } from './ui/icons';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      // Child pages (e.g. a scheme's tabs) can read the parent's resolved data.
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
    ),
    { provide: TitleStrategy, useClass: HumoTitleStrategy },
    provideIonicAngular({ mode: 'md' }),
    provideAppInitializer(registerIcons),
    // Data layer: the in-memory simulation in development and the demo; the Humo API in production builds (data/provide-data.ts).
    provideData(),
  ],
};
