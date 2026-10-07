import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { Router } from '@angular/router';
import { IonBadge, IonIcon, IonLabel, IonTabBar, IonTabButton } from '@ionic/angular/standalone';
import { AttentionKey, AttentionService } from '../../attention/attention.service';
import { NavService } from '../../navigation/nav.service';
import { SessionService } from '../../session/session.service';

interface Tab {
  id: string;
  label: string;
  icon: string;
  /** Null: a command rather than a page ("More", "Search"). */
  route: string | null;
  badge?: AttentionKey;
}

/**
 * Phones get a native-feeling bottom tab bar (Ionic):
 * - Owners & tenants: their portal.
 * - Staff & trustees: "field mode" — the queues they act on away from a desk.
 * "More" opens the full menu for everything else.
 */
@Component({
  selector: 'app-mobile-tab-bar',
  imports: [IonTabBar, IonTabButton, IonIcon, IonLabel, IonBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ion-tab-bar [selectedTab]="selected()">
      @for (t of tabs(); track t.id) {
        <ion-tab-button [tab]="t.id" (click)="open(t)">
          <ion-icon [name]="t.icon" aria-hidden="true" />
          <ion-label>{{ t.label }}</ion-label>
          @if (t.badge && counts()[t.badge]) {
            <ion-badge>{{ counts()[t.badge] }}</ion-badge>
          }
        </ion-tab-button>
      }
    </ion-tab-bar>
  `,
  styles: `
    :host { display: block; flex: none; }
    ion-tab-bar { --border: 1px solid var(--c-border); height: 60px; padding-bottom: env(safe-area-inset-bottom); }
    ion-label { font-size: 11px; font-weight: 500; }
    ion-badge { --background: var(--c-accent); --color: var(--brand-navy-900); font-size: 10px; }
  `,
})
export class MobileTabBar {
  private readonly session = inject(SessionService);
  private readonly nav = inject(NavService);
  private readonly attention = inject(AttentionService);
  private readonly router = inject(Router);

  readonly more = output<void>();
  readonly search = output<void>();

  protected readonly counts = this.attention.counts;

  protected readonly tabs = computed<Tab[]>(() => {
    const role = this.session.role();
    const more: Tab = { id: 'more', label: 'More', icon: 'menu-outline', route: null };

    if (role === 'owner' || role === 'tenant') {
      return [
        { id: 'home', label: 'Home', icon: 'home-outline', route: '/my/home' },
        role === 'owner'
          ? { id: 'account', label: 'Account', icon: 'wallet-outline', route: '/my/account' }
          : { id: 'notices', label: 'Notices', icon: 'megaphone-outline', route: '/my/notices' },
        { id: 'requests', label: 'Requests', icon: 'construct-outline', route: '/my/requests' },
        { id: 'documents', label: 'Documents', icon: 'folder-open-outline', route: '/my/documents' },
        more,
      ];
    }
    if (role === 'trustee') {
      return [
        { id: 'approvals', label: 'Approvals', icon: 'shield-checkmark-outline', route: '/approvals', badge: 'approvals' },
        { id: 'tasks', label: 'Tasks', icon: 'checkmark-done-outline', route: '/tasks', badge: 'tasks' },
        { id: 'scheme', label: 'Scheme', icon: 'business-outline', route: `/schemes/${this.session.membership().schemeIds[0]}` },
        { id: 'search', label: 'Search', icon: 'search-outline', route: null },
        more,
      ];
    }
    return [
      { id: 'tasks', label: 'Tasks', icon: 'checkmark-done-outline', route: '/tasks', badge: 'tasks' },
      { id: 'approvals', label: 'Approvals', icon: 'shield-checkmark-outline', route: '/approvals', badge: 'approvals' },
      { id: 'search', label: 'Search', icon: 'search-outline', route: null },
      { id: 'inbox', label: 'Inbox', icon: 'mail-outline', route: '/inbox', badge: 'inbox' },
      more,
    ];
  });

  protected readonly selected = computed(() => {
    const path = this.nav.url().split(/[?#]/)[0];
    return this.tabs().find((t) => t.route && (path === t.route || path.startsWith(t.route + '/')))?.id ?? 'more';
  });

  protected open(tab: Tab): void {
    if (tab.route) this.router.navigateByUrl(tab.route);
    else if (tab.id === 'search') this.search.emit();
    else this.more.emit();
  }
}
