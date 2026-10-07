import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Dialog } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import { IonIcon, IonMenu, IonSplitPane, MenuController } from '@ionic/angular/standalone';
import { filter } from 'rxjs';
import { ROLE_LABELS, ROLE_META } from '../../domain';
import { PrototypeToolbar } from '../prototype/prototype-toolbar';
import { ImpersonationBanner } from '../security/impersonation-banner';
import { RoleSwitcher } from '../session/role-switcher';
import { safeStorage } from '../prototype/safe-storage';
import { SessionService } from '../session/session.service';
import { Breadcrumbs } from './breadcrumbs/breadcrumbs';
import { CommandPalette } from './command-palette/command-palette';
import { MobileTabBar } from './mobile-tab-bar/mobile-tab-bar';
import { Sidebar } from './sidebar/sidebar';
import { Topbar } from './topbar/topbar';

/** Matches Ionic's "lg" split-pane breakpoint: sidebar is docked at 992px and wider. */
const DESKTOP_QUERY = '(min-width: 992px)';

/**
 * The one application shell shared by every role.
 * Desktop: docked sidebar (collapsible to an icon rail).
 * Mobile:  Ionic slide-out menu, plus a bottom tab bar for owners and tenants.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, IonSplitPane, IonMenu, IonIcon, Sidebar, Topbar, Breadcrumbs, MobileTabBar, PrototypeToolbar, ImpersonationBanner],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  host: {
    '(document:keydown)': 'onKeydown($event)',
    '[class.impersonating]': 'session.isImpersonating()',
  },
})
export class Shell {
  protected readonly session = inject(SessionService);
  protected readonly switcher = inject(RoleSwitcher);
  private readonly menu = inject(MenuController);
  private readonly dialog = inject(Dialog);
  private readonly overlay = inject(Overlay);
  private readonly router = inject(Router);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly isDesktop = signal(matchMedia(DESKTOP_QUERY).matches);
  protected readonly collapsed = signal(safeStorage.get('humo.sidebar') === 'collapsed');
  /** The icon rail only exists on desktop; the mobile menu always shows full labels. */
  protected readonly railCollapsed = computed(() => this.collapsed() && this.isDesktop());
  protected readonly showTabBar = computed(() => !this.isDesktop() && !this.session.isHumo());
  /** Humo staff viewing an agency's setup: make it unmistakable. */
  protected readonly supportAgency = computed(() =>
    this.session.isHumo() && this.session.supportAgencyId() ? this.session.agency() : undefined,
  );

  /** Acknowledges a role switch for a few seconds — calm, in the role's accent, never the impersonation colour. */
  protected readonly roleAck = computed(() => {
    const change = this.switcher.lastChange();
    if (!change) return null;
    const a = change.assignment;
    const agency = this.session.agency()?.shortName;
    const scope = a.schemeIds.length === 0 && agency ? `All schemes in ${agency}` : a.label;
    return { role: ROLE_LABELS[a.role], scope, icon: ROLE_META[a.role].icon, color: `var(--role-${ROLE_META[a.role].family})` };
  });

  constructor() {
    const mq = matchMedia(DESKTOP_QUERY);
    const onChange = (e: MediaQueryListEvent) => this.isDesktop.set(e.matches);
    mq.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', onChange));

    effect(() => safeStorage.set('humo.sidebar', this.collapsed() ? 'collapsed' : 'expanded'));

    effect((onCleanup) => {
      if (!this.switcher.lastChange()) return;
      const t = setTimeout(() => this.switcher.dismiss(), 7000);
      onCleanup(() => clearTimeout(t));
    });

    // The content area (not the window) scrolls, so reset it on every page change.
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.scroller()?.nativeElement.scrollTo({ top: 0 }));
  }

  protected openMenu(): void {
    this.menu.open('main');
  }

  protected closeMenu(): void {
    if (!this.isDesktop()) this.menu.close('main');
  }

  protected toggleCollapse(): void {
    this.collapsed.update((c) => !c);
  }

  protected openPalette(): void {
    if (this.dialog.openDialogs.some((d) => d.componentInstance instanceof CommandPalette)) return;
    this.dialog.open(CommandPalette, {
      ariaLabel: 'Search or jump to',
      backdropClass: 'cdk-overlay-dark-backdrop',
      positionStrategy: this.overlay.position().global().centerHorizontally().top('12vh'),
    });
  }

  protected onKeydown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.openPalette();
    }
  }
}
