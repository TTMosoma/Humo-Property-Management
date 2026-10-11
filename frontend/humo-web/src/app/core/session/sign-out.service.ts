import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AccessDataSource } from '../../domain';
import { HumoProductId, HUMO_PRODUCTS } from '../product/product';
import { SessionService } from './session.service';

/**
 * Sign out of Humo. It's an identity action, not a product action: the Humo
 * session is shared by every Humo product (D5), so signing out ends it
 * everywhere (and ends any impersonation). The API records it; the browser
 * forgets the session even if that call fails.
 */
@Injectable({ providedIn: 'root' })
export class SignOutService {
  private readonly session = inject(SessionService);
  private readonly access = inject(AccessDataSource);
  private readonly router = inject(Router);

  readonly busy = signal(false);

  signOut(from: HumoProductId): void {
    if (this.busy()) return;
    this.busy.set(true);
    const name = this.session.actor().name;
    const done = () => {
      this.busy.set(false);
      this.session.signedOutLocally();
      this.router.navigate(['/signed-out'], { queryParams: { name: name.split(' ')[0] } });
    };
    this.access.signOut(HUMO_PRODUCTS[from].name).subscribe({ next: done, error: done });
  }
}
