import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../session/session.service';

/** Every product shell needs a Humo session. Signed out → the Humo sign-in, then back to where they were going. */
export const signedInGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionService);
  if (session.signedIn()) return true;
  const product = state.url.startsWith('/contractor') ? 'contractor' : 'property-management';
  const returnUrl = state.url === '/' || state.url.startsWith('/dashboard') ? undefined : state.url;
  return inject(Router).createUrlTree(['/sign-in'], { queryParams: { product, returnUrl } });
};

/** The sign-in pages only make sense when signed out. */
export const signedOutGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  return session.signedIn() ? inject(Router).parseUrl(session.homeRoute()) : true;
};
