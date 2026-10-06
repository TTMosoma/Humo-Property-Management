import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CdkMenu, CdkMenuItem, CdkMenuItemRadio, CdkMenuGroup, CdkMenuTrigger } from '@angular/cdk/menu';
import { IonIcon } from '@ionic/angular/standalone';
import { AppNotification, NotificationKind, ROLE_LABELS, Role } from '../../../domain';
import { NOTIFICATIONS } from '../../../mock/fixtures/notifications';
import { findScheme } from '../../../mock/fixtures/schemes';
import { relativeTime } from '../../../ui/format/relative-time';
import { PrototypeStateService, ThemePref } from '../../prototype/prototype-state.service';
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
  { label: 'Allocate a receipt', icon: 'cash-outline', route: '/finance/receipts', roles: ['agency-admin', 'finance'] },
  { label: 'Start billing run', icon: 'receipt-outline', route: '/finance/billing/new', roles: ['agency-admin', 'finance'] },
  { label: 'Send announcement', icon: 'megaphone-outline', route: '/communications/compose', roles: STAFF },
  { label: 'Upload document', icon: 'cloud-upload-outline', route: '/documents', roles: STAFF },
  { label: 'Schedule meeting', icon: 'calendar-outline', route: '/governance/meetings/new', roles: ['agency-admin', 'portfolio-manager'] },
  { label: 'Add person', icon: 'person-outline', route: '/people/new', roles: ['agency-admin', 'portfolio-manager'] },
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
  protected readonly residentScheme = computed(() => findScheme(this.session.persona().schemeIds[0]));

  // Notifications are local to the prototype; residents see none yet.
  protected readonly notifications = signal<AppNotification[]>(NOTIFICATIONS);
  protected readonly visibleNotifications = computed(() =>
    this.session.isResident() || this.session.role() === 'system-admin' ? [] : this.notifications(),
  );
  protected readonly unread = computed(() => this.visibleNotifications().filter((n) => !n.read).length);

  protected readonly themes: { value: ThemePref; label: string; icon: string }[] = [
    { value: 'system', label: 'System', icon: 'desktop-outline' },
    { value: 'light', label: 'Light', icon: 'sunny-outline' },
    { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  ];

  protected go(route: string): void {
    this.router.navigateByUrl(route);
  }

  protected openNotification(n: AppNotification): void {
    this.notifications.update((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    this.router.navigateByUrl(n.link);
  }

  protected markAllRead(): void {
    this.notifications.update((list) => list.map((x) => ({ ...x, read: true })));
  }
}
