import { inject } from '@angular/core';
import { RedirectCommand, ResolveFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { Scheme, SchemeDataSource, coversAllSchemes } from '../../domain';
import { SessionService } from '../../core/session/session.service';

/**
 * Loads the scheme for /schemes/:schemeId: one the assignment covers, or any
 * scheme in the agency for someone granted Portfolio.BrowseAgency (read-only, D1). Unknown schemes, or schemes outside
 * the person's access, show the "not found" page in place (the URL is kept, so
 * the user can see what they asked for). Not revealing whether a scheme exists
 * avoids leaking other bodies corporate's names.
 */
export const schemeResolver: ResolveFn<Scheme | RedirectCommand> = (route) => {
  const router = inject(Router);
  const session = inject(SessionService);
  const membership = session.assignment();
  const id = route.paramMap.get('schemeId')!;
  const notFound = () =>
    new RedirectCommand(router.parseUrl('/not-found?what=scheme'), { skipLocationChange: true });

  return inject(SchemeDataSource)
    .get(id)
    .pipe(
      map((scheme) => {
        if (!scheme || scheme.organisationId !== membership.scope.organisationId) return notFound();
        // D1: the assignment decides; browsing the rest of the agency (read-only) is an individual grant.
        const unrestricted = coversAllSchemes(membership) || session.can('Portfolio.BrowseAgency');
        return unrestricted || membership.scope.schemeIds.includes(id) ? scheme : notFound();
      }),
      catchError(() => of(notFound())),
    );
};
