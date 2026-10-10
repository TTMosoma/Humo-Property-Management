import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { CdkMenu, CdkMenuGroup, CdkMenuItem, CdkMenuItemRadio, CdkMenuTrigger } from '@angular/cdk/menu';
import { IonIcon } from '@ionic/angular/standalone';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { AppNotification, NotificationDataSource, NotificationKind, Permission, ROLE_LABELS, ROLE_META, RoleAssignment } from '../../../domain';
import { relativeTime } from '../../../ui/format/relative-time';
import { PrototypeStateService, ThemePref } from '../../prototype/prototype-state.service';
import { ScopeService } from '../../scope/scope.service';
import { ImpersonationService } from '../../security/impersonation.service';
import { RoleSwitcher } from '../../session/role-switcher';
import { SignOutService } from '../../session/sign-out.service';
import { visibleOrganisations } from '../../session/organisations';
import { SessionService } from '../../session/session.service';

interface QuickAction {
  label: string;
  icon: string;
  route: string;
  /** The permission the action needs (the same one its route checks). */
  permission: Permission;
}


const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Log maintenance request', icon: 'construct-outline', route: '/maintenance/new', permission: 'Maintenance.Log' },
  { label: 'Allocate receipts', icon: 'cash-outline', route: '/finance/receipts', permission: 'Receipts.Allocate' },
  { label: 'Start billing run', icon: 'receipt-outline', route: '/finance/billing/new', permission: 'Billing.Run' },
  { label: 'Send a notice', icon: 'megaphone-outline', route: '/communications/compose', permission: 'Messages.Reply' },
  { label: 'Upload document', icon: 'cloud-upload-outline', route: '/documents', permission: 'Documents.View' },
  { label: 'Schedule meeting', icon: 'calendar-outline', route: '/governance/meetings/new', permission: 'Meetings.Manage' },
  { label: 'Add person', icon: 'person-add-outline', route: '/people/new', permission: 'People.Manage' },
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
  host: { '[class.tab-search]': 'tabBarHasSearch()' },
})
export class Topbar {
  protected readonly session = inject(SessionService);
  protected readonly scope = inject(ScopeService);
  protected readonly proto = inject(PrototypeStateService);
  protected readonly switcher = inject(RoleSwitcher);
  protected readonly signOut = inject(SignOutService);
  protected readonly impersonation = inject(ImpersonationService);
  private readonly router = inject(Router);
  private readonly notificationSource = inject(NotificationDataSource);
  /** Humo staff's support-view picker. */
  protected readonly organisations = visibleOrganisations();

  readonly showMenuButton = input(false);
  readonly openMenu = output<void>();
  readonly openPalette = output<void>();

  protected readonly roleLabels = ROLE_LABELS;
  protected readonly roleMeta = ROLE_META;
  protected readonly kindIcon = KIND_ICON;
  protected readonly relativeTime = relativeTime;

  // Nothing to create in Observe impersonation: it's read-only.
  protected readonly quickActions = computed(() =>
    this.session.readOnly() ? [] : QUICK_ACTIONS.filter((a) => this.session.can(a.permission)),
  );

  /** The accent colour for a role family, e.g. var(--role-agency). */
  protected roleColor(a: RoleAssignment): string {
    return `var(--role-${ROLE_META[a.role].family})`;
  }

  /** Mirrors the mobile tab bar: staff and trustees have Search there. */
  protected readonly tabBarHasSearch = computed(() => this.session.isStaff() || this.session.role() === 'trustee');

  protected readonly firstName = computed(() => this.session.actor().name.split(' ')[0]);

  /** The scheme an owner, tenant or trustee belongs to. */
  protected readonly ownScheme = computed(() => this.scope.findScheme(this.session.assignment().scope.schemeIds[0]));

  /** Schemes for the scope menu: pinned first, then the rest. */
  protected readonly scopeOptions = computed(() => {
    const pinned = this.scope.pinned();
    const pinnedIds = new Set(pinned.map((s) => s.id));
    return { pinned, others: this.scope.accessible().filter((s) => !pinnedIds.has(s.id)) };
  });

  // The server picks the audience (role, scheme access and, for residents, unit) and re-sends on role change.
  protected readonly notifications = toSignal(this.notificationSource.list().pipe(catchError(() => of([] as AppNotification[]))), {
    initialValue: [] as AppNotification[],
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
    this.notificationSource.markRead([n.id]).subscribe();
    this.router.navigateByUrl(n.link);
  }

  protected markAllRead(): void {
    this.notificationSource.markRead(this.notifications().map((n) => n.id)).subscribe();
  }

  protected switchRole(id: string): void {
    this.switcher.switchTo(id);
  }
}
