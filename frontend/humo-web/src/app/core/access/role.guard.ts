import { inject } from '@angular/core';
import { CanActivateChildFn, RedirectCommand, Router } from '@angular/router';
import { Role } from '../../domain';
import { SessionService } from '../session/session.service';

/**
 * Checks each route's own `data.roles` (not inherited) against the current role.
 * Runs for every level of the route tree under the shell.
 *
 * Denied pages render "You don't have access" in place: the URL stays as typed,
 * so the user knows what they asked for and can share it with someone who can help.
 *
 * Prototype note: this is UX gating only. Real authorisation will be enforced by the .NET API.
 */
export const roleGuard: CanActivateChildFn = (child, state) => {
  const session = inject(SessionService);
  const roles = child.routeConfig?.data?.['roles'] as Role[] | undefined;
  if (session.hasRole(roles)) return true;

  const router = inject(Router);
  const target = router.createUrlTree(['/no-access'], { queryParams: { from: state.url } });
  return new RedirectCommand(target, { skipLocationChange: true });
};
