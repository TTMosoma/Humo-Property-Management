import { ApplicationConfig, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular/standalone';

import { routes } from './app.routes';
import { HumoTitleStrategy } from './core/title.strategy';
import { provideMockData } from './mock/provide-mock-data';
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
    // Data layer: in-memory for the prototype. Swap for the HTTP implementation later.
    // PRODUCTION: HTTP adapters only, no mocks or prototype controls (docs/18 R-6, P1-2).
    provideMockData(),
  ],
};
