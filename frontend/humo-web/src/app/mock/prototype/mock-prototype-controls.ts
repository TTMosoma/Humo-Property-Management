import { Injectable, inject } from '@angular/core';
import { PrototypeControls } from '../../core/prototype/prototype-controls';
import { activeAssignments } from '../../domain';
import { AccessStore } from '../db/access-store';
import { PlatformStore } from '../db/platform-store';
import { simulationStorage } from '../simulation/simulation-storage';

@Injectable()
export class MockPrototypeControls extends PrototypeControls {
  private readonly platform = inject(PlatformStore);
  private readonly access = inject(AccessStore);

  resetNudges(): void {
    this.platform.resetNudges();
  }

  lastSaved(): string | null {
    return simulationStorage.lastSaved();
  }

  acceptInvite(identityId: string): void {
    const who = this.access.identity(identityId);
    if (!who || who.status !== 'invited') return;
    this.access.changeIdentity(identityId, (i) => ({ ...i, status: 'active' }));
    this.access.record({
      category: 'security', actor: { identityId, name: who.name }, role: activeAssignments(who)[0]?.role ?? 'tenant',
      organisationId: who.memberships[0]?.organisationId ?? null, action: 'Accepted the invitation and set up a passkey', resource: 'Identity', resourceId: identityId,
      result: 'success', stepUp: { method: 'passkey' }, session: { ip: '41.13.200.7', device: 'Chrome on Android', sessionId: 's-invite' },
    });
  }

  resetSimulation(): void {
    simulationStorage.reset();
    location.assign('/');
  }
}
