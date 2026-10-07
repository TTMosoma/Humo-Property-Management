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
import { PrototypeToolbar } from '../prototype/prototype-toolbar';
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
  imports: [RouterOutlet, IonSplitPane, IonMenu, IonIcon, Sidebar, Topbar, Breadcrumbs, MobileTabBar, PrototypeToolbar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
})
export class Shell {
  protected readonly session = inject(SessionService);
  private readonly menu = inject(MenuController);
  private readonly dialog = inject(Dialog);
  private readonly overlay = inject(Overlay);
  private readonly router = inject(Router);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  protected readonly isDesktop = signal(matchMedia(DESKTOP_QUERY).matches);
  protected readonly collapsed = signal(safeStorage.get('humo.sidebar') === 'collapsed');
  /** The icon rail only exists on desktop; the mobile menu always shows full labels. */
  protected readonly railCollapsed = computed(() => this.collapsed() && this.isDesktop());
  protected readonly showTabBar = computed(() => !this.isDesktop() && this.session.role() !== 'system-admin');
  /** System Administrator viewing an agency: make it unmistakable. */
  protected readonly supportAgency = computed(() =>
    this.session.role() === 'system-admin' && this.session.supportAgencyId() ? this.session.agency() : undefined,
  );

  constructor() {
    const mq = matchMedia(DESKTOP_QUERY);
    const onChange = (e: MediaQueryListEvent) => this.isDesktop.set(e.matches);
    mq.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', onChange));

    effect(() => safeStorage.set('humo.sidebar', this.collapsed() ? 'collapsed' : 'expanded'));

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
