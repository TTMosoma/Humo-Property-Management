import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CdkMenu, CdkMenuItemRadio, CdkMenuTrigger } from '@angular/cdk/menu';
import { IonIcon } from '@ionic/angular/standalone';
import { ROLE_LABELS, ROLE_META, RoleAssignment, coversAllSchemes } from '../../../domain';
import { ScopeService } from '../../scope/scope.service';
import { RoleSwitcher } from '../../session/role-switcher';
import { SessionService } from '../../session/session.service';

/**
 * "Where am I working?" in one glance: role · organisation · scope.
 * Sits at the top of the navigation (desktop sidebar and phone menu), and
 * doubles as the role switcher — the same list as the top-bar menu.
 */
@Component({
  selector: 'app-context-card',
  imports: [IonIcon, CdkMenu, CdkMenuItemRadio, CdkMenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let m = session.assignment();
    <button
      type="button"
      class="card"
      [class.imp]="session.isImpersonating()"
      [cdkMenuTriggerFor]="canSwitch() ? menu : null"
      [disabled]="!canSwitch()"
      [attr.aria-label]="'Working as ' + roleLabels[m.role] + ', ' + organisation() + ', ' + scopeText() + (canSwitch() ? '. Switch role' : '')"
    >
      <span class="k">{{ session.isImpersonating() ? 'Impersonating as' : 'Working as' }}</span>
      <span class="role">
        <ion-icon [name]="roleMeta[m.role].icon" aria-hidden="true" />
        {{ roleLabels[m.role] }}
        @if (canSwitch()) {
          <ion-icon class="chev" name="swap-vertical-outline" aria-hidden="true" />
        }
      </span>
      <span class="org">{{ organisation() }}</span>
      <span class="scope"><ion-icon [name]="scope.scheme() ? 'business-outline' : 'layers-outline'" aria-hidden="true" />{{ scopeText() }}</span>
    </button>

    <ng-template #menu>
      <div class="menu-panel ctx-menu" cdkMenu>
        <div class="menu-section-label label-caps">Switch role · {{ session.identity().name }}</div>
        @for (a of session.assignments(); track a.id) {
          <button type="button" class="menu-item" cdkMenuItemRadio [cdkMenuItemChecked]="a.id === m.id" (cdkMenuItemTriggered)="switcher.switchTo(a.id)">
            <span class="mi">
              <span class="mi-role">{{ roleLabels[a.role] }}</span>
              <span class="mi-label">{{ a.label }}</span>
            </span>
            @if (a.id === m.id) {
              <ion-icon class="menu-item-meta" name="checkmark-outline" aria-label="Current role" />
            }
          </button>
        }
      </div>
    </ng-template>
  `,
  styles: `
    :host { display: block; padding: 0 var(--s-3) var(--s-3); }
    .card {
      display: grid; width: 100%; gap: 2px; padding: 10px 12px; text-align: left;
      color: var(--c-nav-text); background: var(--c-nav-bg-2); border: 1px solid var(--c-nav-border); border-radius: var(--r-lg);
      cursor: pointer; font: inherit;
    }
    .card:disabled { cursor: default; }
    .card:not(:disabled):hover { border-color: var(--c-nav-accent); }
    .card.imp { border-color: var(--c-imp); box-shadow: inset 3px 0 0 var(--c-imp); }
    .k { font-size: 10px; font-weight: var(--fw-semibold); letter-spacing: 0.08em; text-transform: uppercase; color: var(--c-nav-muted); }
    .card.imp .k { color: var(--c-imp-strong); }
    .role { display: flex; gap: 6px; align-items: center; font-weight: var(--fw-semibold); color: var(--c-nav-text-strong); }
    .role ion-icon { color: var(--c-nav-accent); }
    .chev { margin-left: auto; font-size: 14px; color: var(--c-nav-muted) !important; }
    .org, .scope { overflow: hidden; font-size: var(--fs-xs); white-space: nowrap; text-overflow: ellipsis; }
    .scope { display: flex; gap: 5px; align-items: center; color: var(--c-nav-text); }
    .scope ion-icon { flex: none; font-size: 13px; }
    .mi { display: flex; flex-direction: column; line-height: 1.3; }
    .mi-label { font-size: var(--fs-xs); color: var(--c-text-muted); }
    .ctx-menu { width: 280px; }
  `,
})
export class ContextCard {
  protected readonly session = inject(SessionService);
  protected readonly scope = inject(ScopeService);
  protected readonly switcher = inject(RoleSwitcher);
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly roleMeta = ROLE_META;

  protected readonly canSwitch = computed(() => this.session.assignments().length > 1 && !this.session.isImpersonating());

  protected readonly organisation = computed(() => {
    if (this.session.isHumo()) return 'Humo platform';
    const m = this.session.assignment();
    return this.session.organisation()?.shortName ?? m.label;
  });

  /** Scheme in focus, or the extent of the assignment. */
  protected readonly scopeText = computed(() => {
    const m: RoleAssignment = this.session.assignment();
    if (this.session.isHumo()) return 'All customers';
    const s = this.scope.scheme();
    if (m.scope.type === 'unit') return m.label;
    if (s) return s.name;
    const n = this.scope.accessible().length;
    if (n === 0) return 'No schemes assigned';
    return coversAllSchemes(m) ? 'All schemes' : n === 1 ? this.scope.accessible()[0].name : `${n} schemes`;
  });
}
