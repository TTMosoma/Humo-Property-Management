import { Injectable, inject } from '@angular/core';
import { PrototypeControls } from '../../core/prototype/prototype-controls';
import { PlatformStore } from '../db/platform-store';

@Injectable()
export class MockPrototypeControls extends PrototypeControls {
  private readonly platform = inject(PlatformStore);

  resetNudges(): void {
    this.platform.resetNudges();
  }
}
