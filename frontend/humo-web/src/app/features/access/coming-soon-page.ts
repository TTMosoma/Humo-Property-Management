import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NAV } from '../../core/navigation/nav.config';
import { isGroup } from '../../core/navigation/nav.model';
import { SessionService } from '../../core/session/session.service';
import { EmptyState } from '../../ui/states/empty-state';

/** A screen that isn't on Humo's API yet (core/availability): said plainly, not as an error. */
@Component({
  selector: 'app-coming-soon-page',
  imports: [EmptyState, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="surface">
      <ui-empty-state
        illustration="coming-soon"
        [title]="(name() || 'This page') + ' is coming to Humo Property Management'"
        message="It isn’t switched on in Humo Property Management yet. Everything else carries on as normal, and it will appear in the menu as soon as it’s ready."
      >
        <a class="btn btn-primary" [routerLink]="session.homeRoute()">Go to home</a>
      </ui-empty-state>
    </div>
  `,
})
export class ComingSoonPage {
  protected readonly session = inject(SessionService);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);

  /** The menu's name for it, e.g. "Payables". */
  protected readonly name = computed(() => {
    const from = (this.params()?.get('from') ?? '').split(/[?#]/)[0];
    const links = NAV.flatMap((s) => s.nodes.flatMap((n) => (isGroup(n) ? n.children : [n])));
    return links.filter((l) => from === l.route || from.startsWith(l.route + '/')).sort((a, b) => b.route.length - a.route.length)[0]?.label ?? '';
  });
}
