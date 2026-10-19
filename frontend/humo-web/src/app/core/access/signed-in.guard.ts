import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { SessionService } from '../session/session.service';

/** The app needs a Humo session. Signed out → the sign-in, then back to where they were going. Waits for /me first. */
export const signedInGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session.loaded().pipe(
    map(() => {
      if (session.signedIn()) return true;
      const returnUrl = state.url === '/' || state.url.startsWith('/dashboard') ? undefined : state.url;
      return router.createUrlTree(['/sign-in'], { queryParams: { returnUrl } });
    }),
  );
};

/** The sign-in pages only make sense when signed out. */
export const signedOutGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session.loaded().pipe(map(() => (session.signedIn() ? router.parseUrl(session.homeRoute()) : true)));
};
