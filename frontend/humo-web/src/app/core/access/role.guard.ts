import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { ToastController } from '@ionic/angular/standalone';
import { Role } from '../../domain';
import { SessionService } from '../session/session.service';

/**
 * Checks each route's own `data.roles` (not inherited) against the current role.
 * Runs for every level of the route tree under the shell.
 *
 * Prototype note: this is UX gating only. Real authorisation will be enforced by the .NET API.
 */
export const roleGuard: CanActivateChildFn = (child) => {
  const session = inject(SessionService);
  const roles = child.routeConfig?.data?.['roles'] as Role[] | undefined;
  if (session.hasRole(roles)) return true;

  inject(ToastController)
    .create({ message: 'That page isn’t available for your role.', duration: 2500, position: 'top' })
    .then((t) => t.present());
  return inject(Router).parseUrl(session.homeRoute());
};
