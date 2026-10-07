import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CdkMenu, CdkMenuGroup, CdkMenuItem, CdkMenuItemRadio, CdkMenuTrigger } from '@angular/cdk/menu';
import { IonIcon } from '@ionic/angular/standalone';
import { AppNotification, NotificationKind, ROLE_LABELS, Role } from '../../../domain';
import { NOTIFICATIONS } from '../../../mock/fixtures/notifications';
import { relativeTime } from '../../../ui/format/relative-time';
import { PrototypeStateService, ThemePref } from '../../prototype/prototype-state.service';
import { ScopeService } from '../../scope/scope.service';
import { SessionService } from '../../session/session.service';

interface QuickAction {
  label: string;
  icon: string;
  route: string;
  roles: Role[];
}

const STAFF: Role[] = ['agency-admin', 'portfolio-manager', 'finance'];

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Log maintenance request', icon: 'construct-outline', route: '/maintenance/new', roles: STAFF },
  { label: 'Allocate receipts', icon: 'cash-outline', route: '/finance/receipts', roles: ['agency-admin', 'finance'] },
  { label: 'Start billing run', icon: 'receipt-outline', route: '/finance/billing/new', roles: ['agency-admin', 'finance'] },
  { label: 'Send a notice', icon: 'megaphone-outline', route: '/communications/compose', roles: STAFF },
  { label: 'Upload document', icon: 'cloud-upload-outline', route: '/documents', roles: STAFF },
  { label: 'Schedule meeting', icon: 'calendar-outline', route: '/governance/meetings/new', roles: ['agency-admin', 'portfolio-manager'] },
  { label: 'Add person', icon: 'person-add-outline', route: '/people/new', roles: ['agency-admin', 'portfolio-manager'] },
];

const KIND_ICON: Record<NotificationKind, string> = {
  maintenance: 'construct-outline',
  finance: 'wallet-outline',
  compliance: 'shield-checkmark-outline',
  communication: 'chatbubbles-outline',
  governance: 'library-outline',
};

@Component({
  selector: 'app-topbar',
  imports: [IonIcon, CdkMenu, CdkMenuItem, CdkMenuItemRadio, CdkMenuGroup, CdkMenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './topbar.html',
  styleUrl: './topbar.scss',
})
export class Topbar {
  protected readonly session = inject(SessionService);
  protected readonly scope = inject(ScopeService);
  protected readonly proto = inject(PrototypeStateService);
  private readonly router = inject(Router);

  readonly showMenuButton = input(false);
  readonly openMenu = output<void>();
  readonly openPalette = output<void>();

  protected readonly roleLabels = ROLE_LABELS;
  protected readonly kindIcon = KIND_ICON;
  protected readonly relativeTime = relativeTime;

  protected readonly quickActions = computed(() =>
    QUICK_ACTIONS.filter((a) => a.roles.includes(this.session.role())),
  );

  /** The scheme an owner, tenant or trustee belongs to. */
  protected readonly ownScheme = computed(() => this.scope.findScheme(this.session.membership().schemeIds[0]));

  /** Schemes for the scope menu: pinned first, then the rest. */
  protected readonly scopeOptions = computed(() => {
    const pinned = this.scope.pinned();
    const pinnedIds = new Set(pinned.map((s) => s.id));
    return { pinned, others: this.scope.accessible().filter((s) => !pinnedIds.has(s.id)) };
  });

  // Notifications are filtered by audience, scheme access and (for residents) unit.
  private readonly readIds = signal<Set<string>>(new Set());
  protected readonly notifications = computed<AppNotification[]>(() => {
    const m = this.session.membership();
    const schemes = new Set(this.scope.accessible().map((s) => s.id));
    const read = this.readIds();
    return NOTIFICATIONS.filter((n) => n.audience.includes(m.role))
      .filter((n) => n.schemeId === null || schemes.has(n.schemeId))
      .filter((n) => !n.unitLabel || n.unitLabel === m.unitLabel)
      .map((n) => (read.has(n.id) ? { ...n, read: true } : n));
  });
  protected readonly unread = computed(() => this.notifications().filter((n) => !n.read).length);

  protected readonly themes: { value: ThemePref; label: string; icon: string }[] = [
    { value: 'system', label: 'System', icon: 'desktop-outline' },
    { value: 'light', label: 'Light', icon: 'sunny-outline' },
    { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  ];

  protected go(route: string): void {
    this.router.navigateByUrl(route);
  }

  protected openNotification(n: AppNotification): void {
    this.readIds.update((s) => new Set(s).add(n.id));
    this.router.navigateByUrl(n.link);
  }

  protected markAllRead(): void {
    this.readIds.set(new Set(this.notifications().map((n) => n.id)));
  }

  protected switchContext(id: string): void {
    this.session.switchMembership(id);
    this.router.navigateByUrl(this.session.homeRoute());
  }
}
