import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '../session/session.service';

/** Every product shell needs a Humo session. Signed out → the shared signed-out page. */
export const signedInGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionService);
  if (session.signedIn()) return true;
  const product = state.url.startsWith('/contractor') ? 'contractor' : 'property-management';
  return inject(Router).createUrlTree(['/signed-out'], { queryParams: { product } });
};

/** The signed-out page only makes sense when signed out. */
export const signedOutGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  return session.signedIn() ? inject(Router).parseUrl(session.homeRoute()) : true;
};
