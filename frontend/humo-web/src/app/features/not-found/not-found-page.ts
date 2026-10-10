import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { SessionService } from '../../core/session/session.service';
import { EmptyState } from '../../ui/states/empty-state';

const COPY: Record<string, { title: string; message: string; back: string; link: string }> = {
  scheme: {
    title: 'We couldn’t find that scheme',
    message: 'It may have been removed, renamed, or it isn’t one you have access to. Search (Ctrl K) or browse your schemes.',
    back: 'Browse schemes',
    link: '/schemes',
  },
  page: {
    title: 'We couldn’t find that page',
    message: 'The link may be out of date, or the page may have moved. Use search (Ctrl K) or go back to your home page.',
    back: 'Go to home',
    link: '',
  },
};

@Component({
  selector: 'app-not-found-page',
  imports: [EmptyState, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="surface">
      <ui-empty-state illustration="not-found" [title]="copy().title" [message]="copy().message">
        <a class="btn btn-primary" [routerLink]="link()">{{ copy().back }}</a>
      </ui-empty-state>
    </div>
  `,
})
export class NotFoundPage {
  private readonly session = inject(SessionService);
  private readonly what = toSignal(inject(ActivatedRoute).queryParamMap.pipe(map((p) => p.get('what') ?? 'page')), {
    initialValue: 'page',
  });

  protected readonly copy = computed(() => {
    const c = COPY[this.what()] ?? COPY['page'];
    return c.link === '/schemes' && !this.session.isStaff() ? COPY['page'] : c;
  });
  protected readonly link = computed(() => this.copy().link || this.session.homeRoute());
}
