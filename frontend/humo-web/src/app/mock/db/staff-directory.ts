import { Injectable, inject } from '@angular/core';
import { StaffRef } from '../../domain';
import { personName, portfolioManagerOf } from '../fixtures/staff';
import { AccessStore } from './access-store';

/**
 * DEVELOPMENT / SIMULATION ONLY. Names and portfolio managers from the live
 * identities and role assignments (the join the API does), so a reassignment
 * in Users & access routes new work at once (P0-5). Seed generation uses the
 * seed personas; everything at runtime uses this.
 */
@Injectable({ providedIn: 'root' })
export class StaffDirectory {
  private readonly access = inject(AccessStore);

  managerOf(schemeId: string): StaffRef | null {
    return portfolioManagerOf(schemeId, this.access.identities());
  }

  name(id: string | null | undefined): string {
    return personName(id, this.access.identities());
  }
}
