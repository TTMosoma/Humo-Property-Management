import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AccessDataSource } from '../../domain';
import { HumoProductId, HUMO_PRODUCTS } from '../product/product';
import { SessionService } from './session.service';

/**
 * Sign out of Humo. It's an identity action, not a product action: one Humo
 * session covers Humo Property Management and Humo Contractor, so signing out
 * of either ends both (and ends any impersonation). The API records it; the
 * browser forgets the session even if that call fails.
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
      this.router.navigate(['/signed-out'], { queryParams: { product: from, name: name.split(' ')[0] } });
    };
    this.access.signOut(HUMO_PRODUCTS[from].name).subscribe({ next: done, error: done });
  }
}
