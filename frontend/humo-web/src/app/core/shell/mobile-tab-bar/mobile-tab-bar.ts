import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon, IonLabel, IonTabBar, IonTabButton } from '@ionic/angular/standalone';
import { NavService } from '../../navigation/nav.service';
import { SessionService } from '../../session/session.service';

interface Tab {
  id: string;
  label: string;
  icon: string;
  route: string | null;
}

/**
 * Owners and tenants on phones get a native-feeling bottom tab bar (Ionic).
 * "More" opens the full menu for everything else.
 */
@Component({
  selector: 'app-mobile-tab-bar',
  imports: [IonTabBar, IonTabButton, IonIcon, IonLabel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-tab-bar [selectedTab]="selected()">
      @for (t of tabs(); track t.id) {
        <ion-tab-button [tab]="t.id" (click)="open(t)">
          <ion-icon [name]="t.icon" aria-hidden="true" />
          <ion-label>{{ t.label }}</ion-label>
        </ion-tab-button>
      }
    </ion-tab-bar>
  `,
  styles: `
    :host { display: block; flex: none; }
    ion-tab-bar { --border: 1px solid var(--c-border); height: 58px; }
    ion-label { font-size: 11px; font-weight: 500; }
  `,
})
export class MobileTabBar {
  private readonly session = inject(SessionService);
  private readonly nav = inject(NavService);
  private readonly router = inject(Router);

  readonly more = output<void>();

  protected readonly tabs = computed<Tab[]>(() => {
    const owner = this.session.role() === 'owner';
    return [
      { id: 'home', label: 'Home', icon: 'home-outline', route: '/my/home' },
      owner
        ? { id: 'account', label: 'Account', icon: 'wallet-outline', route: '/my/account' }
        : { id: 'notices', label: 'Notices', icon: 'megaphone-outline', route: '/my/notices' },
      { id: 'requests', label: 'Requests', icon: 'construct-outline', route: '/my/requests' },
      { id: 'documents', label: 'Documents', icon: 'folder-open-outline', route: '/my/documents' },
      { id: 'more', label: 'More', icon: 'menu-outline', route: null },
    ];
  });

  protected readonly selected = computed(() => {
    const path = this.nav.url().split(/[?#]/)[0];
    return this.tabs().find((t) => t.route && (path === t.route || path.startsWith(t.route + '/')))?.id ?? 'more';
  });

  protected open(tab: Tab): void {
    if (tab.route) {
      this.router.navigateByUrl(tab.route);
    } else {
      this.more.emit();
    }
  }
}
