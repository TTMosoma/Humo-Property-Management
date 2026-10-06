import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionService } from '../../core/session/session.service';
import { EmptyState } from '../../ui/states/empty-state';

@Component({
  selector: 'app-not-found-page',
  imports: [EmptyState, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-empty-state
      icon="alert-circle-outline"
      title="We couldn’t find that page"
      message="The link may be out of date, or the page may have moved. Use search (Ctrl K) or go back to your home page."
    >
      <a class="btn btn-primary" [routerLink]="session.homeRoute()">Go to home</a>
    </ui-empty-state>
  `,
})
export class NotFoundPage {
  protected readonly session = inject(SessionService);
}
