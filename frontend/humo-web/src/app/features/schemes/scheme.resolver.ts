import { inject } from '@angular/core';
import { RedirectCommand, ResolveFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { Scheme, SchemeDataSource } from '../../domain';
import { SessionService } from '../../core/session/session.service';

/**
 * Loads the scheme for /schemes/:schemeId. Unknown schemes, or schemes outside
 * the person's access, show the "not found" page in place (the URL is kept, so
 * the user can see what they asked for). Not revealing whether a scheme exists
 * avoids leaking other bodies corporate's names.
 */
export const schemeResolver: ResolveFn<Scheme | RedirectCommand> = (route) => {
  const router = inject(Router);
  const membership = inject(SessionService).membership();
  const id = route.paramMap.get('schemeId')!;
  const notFound = () =>
    new RedirectCommand(router.parseUrl('/not-found?what=scheme'), { skipLocationChange: true });

  return inject(SchemeDataSource)
    .get(id)
    .pipe(
      map((scheme) => {
        if (!scheme || scheme.agencyId !== membership.agencyId) return notFound();
        const unrestricted = membership.schemeIds.length === 0 || membership.role === 'portfolio-manager';
        return unrestricted || membership.schemeIds.includes(id) ? scheme : notFound();
      }),
      catchError(() => of(notFound())),
    );
};
