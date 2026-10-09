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
        { id: 'home', label: 'Home', icon: 'grid-outline', route: '/dashboard' },
        { id: 'approvals', label: 'Approvals', icon: 'shield-checkmark-outline', route: '/approvals', badge: 'approvals' },
        { id: 'scheme', label: 'Scheme', icon: 'business-outline', route: `/schemes/${this.session.assignment().scope.schemeIds[0]}` },
        { id: 'search', label: 'Search', icon: 'search-outline', route: null },
        more,
      ];
    }
    // Field mode: staff who log jobs get "Report", which opens the request form photo-first.
    const report: Tab = { id: 'report', label: 'Report', icon: 'camera-outline', route: '/maintenance/new?capture=1' };
    const canReport = this.session.can('Maintenance.Log') && this.session.hasFeature('maintenance-basic') && role !== 'finance';
    if (role === 'operations') {
      return [
        { id: 'home', label: 'Home', icon: 'grid-outline', route: '/dashboard' },
        { id: 'jobs', label: 'Jobs', icon: 'construct-outline', route: '/maintenance', badge: 'jobs' },
        ...(canReport ? [report] : []),
        { id: 'search', label: 'Search', icon: 'search-outline', route: null },
        more,
      ];
    }
    if (role === 'supplier') {
      return [{ id: 'orders', label: 'Work orders', icon: 'hammer-outline', route: '/supplier' }, more];
    }
    // Staff who log jobs trade Home (one tap away in More) for Report; search stays, as the top bar hides it on phones.
    return [
      canReport ? { id: 'tasks', label: 'Tasks', icon: 'checkmark-done-outline', route: '/tasks', badge: 'tasks' } : { id: 'home', label: 'Home', icon: 'grid-outline', route: '/dashboard' },
      canReport ? { id: 'approvals', label: 'Approvals', icon: 'shield-checkmark-outline', route: '/approvals', badge: 'approvals' } : { id: 'tasks', label: 'Tasks', icon: 'checkmark-done-outline', route: '/tasks', badge: 'tasks' },
      canReport ? report : { id: 'approvals', label: 'Approvals', icon: 'shield-checkmark-outline', route: '/approvals', badge: 'approvals' },
      { id: 'search', label: 'Search', icon: 'search-outline', route: null },
      more,
    ];
  });

  protected readonly selected = computed(() => {
    const path = this.nav.url().split(/[?#]/)[0];
    // The most specific match wins ("/maintenance/new" is Report, not Jobs).
    const matches = this.tabs()
      .map((t) => ({ t, route: t.route?.split('?')[0] ?? '' }))
      .filter((x) => x.route && (path === x.route || path.startsWith(x.route + '/')))
      .sort((a, b) => b.route.length - a.route.length);
    return matches[0]?.t.id ?? 'more';
  });

  protected open(tab: Tab): void {
    if (tab.route) this.router.navigateByUrl(tab.route);
    else if (tab.id === 'search') this.search.emit();
    else this.more.emit();
  }
}
