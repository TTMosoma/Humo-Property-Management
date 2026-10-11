import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Humo Contractor: a standalone Humo product. Only a foundation so far. */
@Component({
  selector: 'hc-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet />`,
})
export class App {}
